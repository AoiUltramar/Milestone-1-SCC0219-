// Integration checks for the storage, checkout and WebMCP handlers without a browser.
// Run with: node tests/subscriptions-check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const path = require("node:path");
const storage = new Map();
const tools = {};
const nodes = new Map();
const context = vm.createContext({
    console, structuredClone, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout,
    localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
    },
    document: {
        querySelector: () => null, dispatchEvent: () => {},
        getElementById: id => {
            if (!nodes.has(id)) nodes.set(id, { innerHTML: "", textContent: "", addEventListener() {} });
            return nodes.get(id);
        },
        modelContext: { registerTool: async tool => { tools[tool.name] = tool; } },
    },
    navigator: {}, window: { addEventListener() {} }, CustomEvent: class {},
    location: { pathname: "/html/admin-dashboard.html", search: "", replace() {} },
});
const load = name => vm.runInContext(fs.readFileSync(path.join(__dirname, "../static/js", name + ".js"), "utf8"), context);
const run = code => vm.runInContext(code, context);

(async () => {
    load("db"); load("auth"); load("cart");
    run('const UI = { toast() {}, esc: String, stockText: p => String(p.stock) };');
    await load("webmcp");
    assert.equal(Object.keys(tools).length, 6);
    await run('Auth.login("admin", "admin")');
    await run('DB.update("products", "standard-vm", { monthlyCost: 20 })');
    await run('Auth.logout()');
    const user = await run('Auth.register({name:"Ana", email:"ana@example.com", password:"password123"})');
    const added = await tools.add_to_cart.execute({ productId: "standard-vm", quantity: 2, dataCenter: "Fortaleza", operatingSystem: "Ubuntu 24.04 LTS", months: 3 });
    assert.match(added, /3 months/);
    assert.match(await tools.add_to_cart.execute({ productId: "standard-vm", months: 2 }), /Invalid input/);
    assert.match(await tools.add_to_cart.execute({ productId: "standard-vm", extra: 1 }), /Invalid input/);
    const view = JSON.parse(await tools.view_cart.execute());
    assert.equal(view.dueToday, "R$ 299,40");
    assert.equal(view.items[0].options["Data center"], "Fortaleza");
    assert.equal(view.items[0].options.OS, "Ubuntu 24.04 LTS");
    const key = view.items[0].lineKey;
    await run(`Cart.setDuration(${JSON.stringify(key)}, 12)`);
    assert.equal((await run('Cart.get()')).total, 1197.6);
    const annualKey = (await run('Cart.get()')).lines[0].key;
    await run(`Cart.setDuration(${JSON.stringify(annualKey)}, 3)`);
    assert.equal((await run('Cart.get()')).total, 299.4);
    assert.equal(run('DB.subscriptionEnd("2028-01-31T12:00:00.000Z", 1)'), "2028-02-29T12:00:00.000Z");
    console.log("PASS: WebMCP handlers, term selection and calendar dates");

    const card = '{name:"Ana",number:"1234567890123456",expiry:"12/39",cvv:"123"}';
    const order = await run(`Cart.checkout(${card})`);
    assert.equal(order.total, 299.4);
    const sub = (await run('Cart.subscriptionsFor()'))[0];
    assert.equal(sub.monthlyCost, 20);
    assert.equal(sub.status, "active");
    assert.equal((await run('DB.get("products", "standard-vm")')).stock, 46);
    assert.equal((await run('Cart.get()')).count, 0);
    await run('Auth.logout()');
    await run('Auth.login("admin", "admin")');
    await load("admin-dashboard");
    assert.match(nodes.get("financial-metrics").innerHTML, /R\$ 179,40/);
    assert.match(nodes.get("financial-metrics").innerHTML, /R\$ 299,40/);
    await assert.rejects(run(`Auth.deleteUser(${JSON.stringify(user.id)})`), /active subscriptions/);
    console.log("PASS: checkout, cost snapshot, dashboard margin and customer protection");

    await run('Auth.logout()');
    await run('Auth.register({name:"Bob",email:"bob@example.com",password:"password123"})');
    await assert.rejects(run(`Cart.cancelSubscription(${JSON.stringify(sub.id)})`), /does not belong/);
    await run('Auth.logout()');
    await run('Auth.login("ana@example.com", "password123")');
    const cancelled = await run(`Cart.cancelSubscription(${JSON.stringify(sub.id)})`);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.refund > 0 && cancelled.refund <= order.total);
    await assert.rejects(run(`Cart.cancelSubscription(${JSON.stringify(sub.id)})`), /not active/);
    const product = await run('DB.get("products", "standard-vm")');
    assert.equal(product.stock, 48);
    assert.equal(product.sold, 514);
    await run('Cart.add("nano-vm")');
    await run(`Cart.checkout(${card})`);
    const nano = (await run('Cart.subscriptionsFor()')).find(s => s.productId === "nano-vm");
    await run(`DB.update("subscriptions", ${JSON.stringify(nano.id)}, {endsAt: new Date(Date.now()-1000).toISOString()})`);
    assert.equal((await run('DB.get("products", "nano-vm")')).stock, 96);
    assert.equal((await run('DB.get("products", "nano-vm")')).stock, 96);
    assert.equal((await run('Cart.subscriptionsFor()')).find(s => s.id === nano.id).status, "expired");
    console.log("PASS: ownership, cancellation, refund, expiration and stock release");
    await run('Auth.logout()');
    await run('Auth.login("admin", "admin")');
    await load("admin-dashboard");
    assert.match(nodes.get("financial-metrics").innerHTML, /R\$ 19,90/);
    console.log("PASS: dashboard net sales after cancellation");

    assert.equal((await run('DB.get("products", "gpu-vm")')).stock, 0);
    await assert.rejects(run('DB.update("products", "gpu-vm", {stock: 3})'), /derived from physical servers/);
    const host = await run('DB.addServer({region:"Fortaleza",cpu:32,ram:128,storage:2000,gpu:2})');
    assert.equal((await run('DB.get("products", "gpu-vm")')).capacityByRegion.Fortaleza, 2);
    assert.equal((await run('DB.get("products", "gpu-vm")')).capacityByRegion["São Paulo"], 0);
    assert.equal((await run('DB.get("products", "standard-vm")')).stock, 64);
    await run('Auth.logout()');
    await run('Auth.login("ana@example.com", "password123")');
    await assert.rejects(run('DB.addServer({region:"Fortaleza",cpu:32,ram:128,storage:2000,gpu:2})'), /Only administrators/);
    await run('Cart.add("performance-vm", 4, {"Data center":"São Paulo"})');
    await assert.rejects(run('Cart.add("standard-vm", 1, {"Data center":"São Paulo"})'), /no remaining capacity/);
    await run('Cart.add("standard-vm", 2, {"Data center":"Fortaleza"})');
    const before = await run('DB.infrastructure()');
    assert.equal(before.find(s => s.region === "São Paulo").free.cpu, 32);
    await run(`Cart.checkout(${card})`);
    let state = await run('DB.infrastructure()');
    assert.equal(state.find(s => s.region === "São Paulo").free.cpu, 0);
    assert.equal(state.find(s => s.region === "Rio de Janeiro").free.cpu, 32);
    const performance = (await run('Cart.subscriptionsFor()')).find(s => s.productId === "performance-vm");
    assert.equal(performance.allocations[0].resources.ram, 32);
    assert.equal((await run('DB.get("products", "standard-vm")')).capacityByRegion["São Paulo"], 0);
    await run(`Cart.cancelSubscription(${JSON.stringify(performance.id)})`);
    assert.equal((await run('DB.get("products", "standard-vm")')).capacityByRegion["São Paulo"], 16);
    await run('Cart.add("gpu-vm", 2, {"Data center":"Fortaleza"})');
    await run(`Cart.checkout(${card})`);
    state = await run('DB.infrastructure()');
    assert.equal(state.find(s => s.id === host.id).free.gpu, 0);
    assert.equal(state.find(s => s.id === host.id).free.cpu, 0);
    console.log("PASS: shared VM capacity, geographic isolation, GPU allocation, checkout and cancellation");

    await run('DB.transaction(({products,servers,subscriptions,trials}) => { const p=products.find(p=>p.id==="standard-vm"); trials.push({id:"trial-capacity",productId:p.id,region:"Rio de Janeiro",endsAt:new Date(Date.now()+86400000).toISOString(),allocations:DB.allocate(DB.infrastructureState({servers,subscriptions,trials}),p,"Rio de Janeiro",1)}); })');
    assert.equal((await run('DB.get("products", "standard-vm")')).capacityByRegion["Rio de Janeiro"], 15);
    await run('DB.update("trials", "trial-capacity", {endsAt:new Date(Date.now()-1000).toISOString()})');
    assert.equal((await run('DB.get("products", "standard-vm")')).capacityByRegion["Rio de Janeiro"], 16);
    assert.equal((await run('DB.get("trials", "trial-capacity")')).released, true);
    assert.equal((await run('DB.get("products", "standard-vm")')).capacityByRegion["Rio de Janeiro"], 16);
    await run('Cart.add("performance-vm", 4, {"Data center":"São Paulo"})');
    await run('DB.transaction(({products,servers,subscriptions,trials}) => { const p=products.find(p=>p.id==="standard-vm"); trials.push({id:"competing-trial",productId:p.id,region:"São Paulo",endsAt:new Date(Date.now()+86400000).toISOString(),allocations:DB.allocate(DB.infrastructureState({servers,subscriptions,trials}),p,"São Paulo",1)}); })');
    const orderCount = (await run('DB.list("orders")')).length;
    await assert.rejects(run(`Cart.checkout(${card})`), /Insufficient capacity/);
    assert.equal((await run('DB.list("orders")')).length, orderCount);
    assert.equal((await run('Cart.get()')).count, 4);
    console.log("PASS: trial resource release, stale cart checkout rollback and no overbooking");

    await run('Cart.clear()');
    await run('DB.update("products", "dedicated-ip", {stock:3})');
    assert.equal(await tools.add_to_cart.execute({productId:"dedicated-ip",quantity:5}), "Added 3 × Dedicated IP. Only 3 could be added because of stock.");
    const ipKey = (await run('Cart.get()')).lines[0].key;
    assert.equal(await tools.update_cart_item.execute({lineKey:ipKey,quantity:5}), "Quantity is now 3. Only 3 are in stock.");
    await run('Cart.clear()');
    await run('Auth.logout()');
    await run('Auth.login("admin", "admin")');
    await run('DB.update("products", "dedicated-ip", {category:"vpn",stock:3})');
    assert.equal((await run('DB.get("products", "dedicated-ip")')).category,"vpn");
    await run('DB.update("products", "dedicated-ip", {category:"addons",stock:64})');
    await assert.rejects(run('DB.update("products", "gpu-vm", {category:"vpn",stock:2})'), /active services/);
    console.log("PASS: original non-VM stock messages and category editing for inactive services");
})().catch(err => { console.error(err); process.exitCode = 1; });
