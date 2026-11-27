// API tests: talk to the REST API directly (no browser). They check what the
// SERVER guarantees on its own — sign-in and roles, stock and capacity rules,
// payment, the free trial, subscriptions — and that the browser cannot
// bypass them. Every test starts from a freshly seeded database (fixtures.js).
const { test, expect } = require("./fixtures");

let counter = 0;
const newCustomer = (overrides = {}) => ({
    name: "Ana Souza", email: `ana${Date.now()}${counter++}@example.com`, phone: "(11) 91234-5678",
    address: { street: "Rua das Flores, 100", city: "São Paulo", cep: "01000-000" }, password: "senha-segura-1",
    ...overrides,
});
const card = (overrides = {}) => ({ name: "ANA SOUZA", number: "4111 1111 1111 1111", expiry: "12/99", cvv: "123", ...overrides });

// A separate API client has its own cookies, like a separate browser.
async function client(playwright, baseURL) {
    return playwright.request.newContext({ baseURL });
}
async function asAdmin(playwright, baseURL) {
    const api = await client(playwright, baseURL);
    const res = await api.post("/api/auth/login", { data: { login: "admin", password: "admin" } });
    expect(res.status()).toBe(200);
    return api;
}
async function asCustomer(playwright, baseURL, overrides) {
    const api = await client(playwright, baseURL);
    const data = newCustomer(overrides);
    const res = await api.post("/api/auth/register", { data });
    expect(res.status()).toBe(201);
    return { api, data, user: (await res.json()).user };
}
const product = async (api, id) => (await api.get(`/api/products/${id}`)).json();
const addToCart = (api, productId, qty = 1, extra = {}) => api.post("/api/cart/items", { data: { productId, qty, ...extra } });

test.describe("A1 Catalog", () => {
    test("anyone can list products; VM capacity comes from the physical servers", async ({ request }) => {
        const res = await request.get("/api/products");
        expect(res.status()).toBe(200);
        const products = await res.json();
        expect(products).toHaveLength(10);
        const standard = products.find(p => p.id === "standard-vm");
        expect(standard.stock).toBe(48);                                   // 3 data centers x 16
        expect(standard.capacityByRegion).toEqual({ "São Paulo": 16, "Rio de Janeiro": 16, "Fortaleza": 16 });
        expect(products.find(p => p.id === "gpu-vm").stock).toBe(0);       // no server has a GPU
        expect(products.find(p => p.id === "dedicated-ip").stock).toBe(64);
    });

    test("filters by category and by words, and returns one product or 404", async ({ request }) => {
        expect((await (await request.get("/api/products?category=vpn")).json()).map(p => p.id).sort())
            .toEqual(["business-vpn", "family-vpn", "personal-vpn"]);
        expect((await (await request.get("/api/products?q=gpu")).json()).map(p => p.id)).toEqual(["gpu-vm"]);
        expect((await request.get("/api/products/nano-vm")).status()).toBe(200);
        expect((await request.get("/api/products/nope")).status()).toBe(404);
    });

    test("unknown API paths answer 404 as JSON, and app pages answer with index.html", async ({ request }) => {
        const missing = await request.get("/api/nothing-here");
        expect(missing.status()).toBe(404);
        expect((await missing.json()).error).toBeTruthy();
        const page = await request.get("/cart");
        expect(page.status()).toBe(200);
        expect(await page.text()).toContain('<main id="app"');
    });
});

test.describe("A2 Accounts and roles", () => {
    test("register signs the customer in; me, logout and wrong passwords behave", async ({ playwright, baseURL }) => {
        const { api, data, user } = await asCustomer(playwright, baseURL);
        expect(user.role).toBe("customer");
        expect(user.passwordHash).toBeUndefined();                          // the hash never leaves the server
        expect(user.salt).toBeUndefined();
        expect((await (await api.get("/api/auth/me")).json()).user.email).toBe(data.email);

        expect((await api.post("/api/auth/logout")).status()).toBe(204);
        expect((await (await api.get("/api/auth/me")).json()).user).toBeNull();

        const wrong = await api.post("/api/auth/login", { data: { login: data.email, password: "outra-senha-1" } });
        const unknown = await api.post("/api/auth/login", { data: { login: "ninguem@example.com", password: "outra-senha-1" } });
        expect(wrong.status()).toBe(401);
        expect((await wrong.json()).error).toBe((await unknown.json()).error);   // same message: no account guessing

        const ok = await api.post("/api/auth/login", { data: { login: data.email.toUpperCase(), password: data.password } });
        expect(ok.status()).toBe(200);
    });

    test("registration rules: duplicate email, short password, invalid email", async ({ playwright, baseURL }) => {
        const { data } = await asCustomer(playwright, baseURL);
        const api = await client(playwright, baseURL);
        expect((await api.post("/api/auth/register", { data: newCustomer({ email: data.email }) })).status()).toBe(409);
        expect((await api.post("/api/auth/register", { data: newCustomer({ password: "curta" }) })).status()).toBe(400);
        expect((await api.post("/api/auth/register", { data: newCustomer({ email: "sem-arroba" }) })).status()).toBe(400);
        expect((await api.post("/api/auth/register", { data: newCustomer({ name: "  " }) })).status()).toBe(400);
    });

    test("admin/admin works, by username and by email", async ({ playwright, baseURL }) => {
        const api = await client(playwright, baseURL);
        expect((await api.post("/api/auth/login", { data: { login: "admin", password: "admin" } })).status()).toBe(200);
        const other = await client(playwright, baseURL);
        expect((await other.post("/api/auth/login", { data: { login: "admin@cacheandcarry.example", password: "admin" } })).status()).toBe(200);
    });

    test("too many wrong passwords are throttled", async ({ playwright, baseURL }) => {
        const api = await client(playwright, baseURL);
        let last;
        for (let i = 0; i < 9; i++) last = await api.post("/api/auth/login", { data: { login: "alvo@example.com", password: "x" } });
        expect(last.status()).toBe(429);
    });

    test("the server, not the browser, decides who is an administrator", async ({ playwright, baseURL }) => {
        const visitor = await client(playwright, baseURL);
        expect((await visitor.get("/api/users")).status()).toBe(401);
        expect((await visitor.post("/api/products", { data: { name: "X" } })).status()).toBe(401);

        const { api, user } = await asCustomer(playwright, baseURL);
        expect((await api.get("/api/users")).status()).toBe(403);
        expect((await api.get("/api/servers")).status()).toBe(403);
        expect((await api.patch("/api/products/nano-vm", { data: { price: 1 } })).status()).toBe(403);
        expect((await api.delete("/api/products/nano-vm")).status()).toBe(403);
        // A customer can edit their own record but not turn themselves into an administrator.
        const self = await api.patch(`/api/users/${user.id}`, { data: { role: "admin", name: "Ana Maria" } });
        expect(self.status()).toBe(200);
        expect((await self.json()).role).toBe("customer");
        expect((await api.get("/api/users")).status()).toBe(403);
        // ...and cannot read another person's record.
        expect((await api.get("/api/users/u-admin")).status()).toBe(403);
    });

    test("changing your own password needs the current one", async ({ playwright, baseURL }) => {
        const { api, data, user } = await asCustomer(playwright, baseURL);
        const without = await api.patch(`/api/users/${user.id}`, { data: { password: "nova-senha-123" } });
        expect(without.status()).toBe(400);
        expect((await without.json()).error).toMatch(/current password/);
        expect((await api.patch(`/api/users/${user.id}`, { data: { password: "nova-senha-123", currentPassword: data.password } })).status()).toBe(200);
        const again = await client(playwright, baseURL);
        expect((await again.post("/api/auth/login", { data: { login: data.email, password: "nova-senha-123" } })).status()).toBe(200);
    });

    test("administrators manage users; the default admin and yourself are protected", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        const created = await admin.post("/api/users", { data: { ...newCustomer(), role: "customer" } });
        expect(created.status()).toBe(201);
        const customer = await created.json();
        const second = await admin.post("/api/users", { data: { role: "admin", name: "Bia", email: `bia${Date.now()}@example.com`, phone: "1", username: "bia", password: "senha-segura-1" } });
        expect(second.status()).toBe(201);
        expect((await second.json()).address).toBeUndefined();               // only customers have an address

        expect((await admin.get("/api/users?role=customer")).status()).toBe(200);
        expect((await admin.patch(`/api/users/${customer.id}`, { data: { name: "Ana Editada" } })).status()).toBe(200);
        expect((await (await admin.get(`/api/users/${customer.id}`)).json()).name).toBe("Ana Editada");
        expect((await admin.delete("/api/users/u-admin")).status()).toBe(403);
        expect((await admin.delete(`/api/users/${customer.id}`)).status()).toBe(204);
        expect((await admin.get(`/api/users/${customer.id}`)).status()).toBe(404);
        // The new administrator can sign in with the username.
        const bia = await client(playwright, baseURL);
        expect((await bia.post("/api/auth/login", { data: { login: "bia", password: "senha-segura-1" } })).status()).toBe(200);
    });

    test("renaming the default admin does not lock anyone out", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        expect((await admin.patch("/api/users/u-admin", { data: { username: "root" } })).status()).toBe(200);
        const again = await client(playwright, baseURL);
        expect((await again.post("/api/auth/login", { data: { login: "root", password: "admin" } })).status()).toBe(200);
    });
});

test.describe("A3 Cart", () => {
    test("quantity is limited by stock and sold-out products are refused", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        expect((await api.patch("/api/products/dedicated-ip", { data: { stock: 3 } })).status()).toBe(403);   // customers can't set stock
        const admin = await asAdmin(playwright, baseURL);
        expect((await admin.patch("/api/products/dedicated-ip", { data: { stock: 3 } })).status()).toBe(200);

        const first = await (await addToCart(api, "dedicated-ip", 5)).json();
        expect(first).toMatchObject({ added: 3, capped: true });
        const again = await addToCart(api, "dedicated-ip", 1);
        expect(again.status()).toBe(409);
        expect((await again.json()).error).toMatch(/already have all 3/);
        expect((await addToCart(api, "gpu-vm", 1)).status()).toBe(409);
        expect((await addToCart(api, "nope", 1)).status()).toBe(404);
        expect((await addToCart(api, "nano-vm", 0)).status()).toBe(400);
        expect((await addToCart(api, "nano-vm", 1, { months: 5 })).status()).toBe(400);
    });

    test("options and terms make separate lines; defaults fill what is missing", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "standard-vm", 1);
        await addToCart(api, "standard-vm", 1, { options: { "Data center": "Fortaleza", OS: "Debian 12" } });
        await addToCart(api, "standard-vm", 1, { months: 12 });
        await addToCart(api, "personal-vpn", 1, { options: { "Exit country": "Japan" } });
        const cart = await (await api.get("/api/cart")).json();
        expect(cart.lines).toHaveLength(4);
        expect(cart.lines[0].options).toEqual({ "Data center": "São Paulo", OS: "Ubuntu 24.04 LTS" });
        expect(cart.count).toBe(4);
        expect(cart.total).toBeCloseTo(49.9 * 2 + 49.9 * 12 + 14.9, 2);
        expect((await addToCart(api, "standard-vm", 1, { options: { "Data center": "Marte" } })).status()).toBe(400);
    });

    test("change quantity, change term, remove a line, empty the cart", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "daily-backups", 2);
        let cart = await (await api.get("/api/cart")).json();
        const key = cart.lines[0].key;
        const k = encodeURIComponent(key);
        expect((await (await api.patch(`/api/cart/items/${k}`, { data: { qty: 5 } })).json()).kept).toBe(5);
        expect((await api.patch(`/api/cart/items/${k}`, { data: { months: 3 } })).status()).toBe(200);
        cart = await (await api.get("/api/cart")).json();
        expect(cart.lines[0]).toMatchObject({ qty: 5, months: 3 });
        expect(cart.total).toBeCloseTo(7.9 * 5 * 3, 2);
        expect((await api.patch(`/api/cart/items/${k}`, { data: {} })).status()).toBe(400);
        expect((await api.delete(`/api/cart/items/${encodeURIComponent(cart.lines[0].key)}`)).status()).toBe(204);
        expect((await (await api.get("/api/cart")).json()).lines).toHaveLength(0);
        await addToCart(api, "nano-vm", 1);
        expect((await api.delete("/api/cart")).status()).toBe(204);
        expect((await (await api.get("/api/cart")).json()).count).toBe(0);
    });

    test("a visitor's cart moves into the account on sign-in, respecting the stock", async ({ playwright, baseURL }) => {
        const visitor = await client(playwright, baseURL);
        expect((await (await visitor.get("/api/cart")).json()).count).toBe(0);
        await addToCart(visitor, "extra-storage", 2);
        await addToCart(visitor, "dedicated-ip", 4);
        const admin = await asAdmin(playwright, baseURL);
        await admin.patch("/api/products/dedicated-ip", { data: { stock: 2 } });
        // The visitor registers: the cart comes along, capped by what exists now.
        const res = await visitor.post("/api/auth/register", { data: newCustomer() });
        expect(res.status()).toBe(201);
        const cart = await (await visitor.get("/api/cart")).json();
        expect(cart.lines.map(l => [l.productId, l.qty]).sort()).toEqual([["dedicated-ip", 2], ["extra-storage", 2]]);
        // Another visitor session starts empty.
        expect((await (await (await client(playwright, baseURL)).get("/api/cart")).json()).count).toBe(0);
    });

    test("a cart is private to its owner", async ({ playwright, baseURL }) => {
        const a = await asCustomer(playwright, baseURL);
        const b = await asCustomer(playwright, baseURL);
        await addToCart(a.api, "nano-vm", 1);
        expect((await (await b.api.get("/api/cart")).json()).count).toBe(0);
    });

    test("availability accounts for what the cart already holds", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "standard-vm", 3);
        const map = await (await api.get("/api/availability?dataCenter=" + encodeURIComponent("São Paulo"))).json();
        expect(map["standard-vm"]).toBe(13);
        expect(map["dedicated-ip"]).toBe(64);
        const trial = await (await api.get("/api/availability?dataCenter=" + encodeURIComponent("São Paulo") + "&ignoreCart=1")).json();
        expect(trial["standard-vm"]).toBe(16);
    });

    test("parallel additions are not lost and never exceed the stock", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        const admin = await asAdmin(playwright, baseURL);
        await admin.patch("/api/products/dedicated-ip", { data: { stock: 7 } });
        const results = await Promise.all(Array.from({ length: 10 }, () => addToCart(api, "dedicated-ip", 1)));
        expect(results.filter(r => r.status() === 201)).toHaveLength(7);
        expect(results.filter(r => r.status() === 409)).toHaveLength(3);
        expect((await (await api.get("/api/cart")).json()).count).toBe(7);
    });
});

test.describe("A4 Payment", () => {
    test("paying moves stock to sold, saves the order and a subscription, and empties the cart", async ({ playwright, baseURL }) => {
        const { api, user } = await asCustomer(playwright, baseURL);
        await addToCart(api, "dedicated-ip", 2);
        await addToCart(api, "personal-vpn", 1, { months: 3 });
        const res = await api.post("/api/orders", { data: { card: card() } });
        expect(res.status()).toBe(201);
        const order = await res.json();
        expect(order.cardLast4).toBe("1111");
        expect(JSON.stringify(order)).not.toContain("4111");                  // the card number is never stored
        expect(order.total).toBeCloseTo(9.9 * 2 + 14.9 * 3, 2);

        const ip = await product(api, "dedicated-ip");
        expect([ip.stock, ip.sold]).toEqual([62, 152]);
        expect((await (await api.get("/api/cart")).json()).count).toBe(0);
        expect(await (await api.get("/api/orders")).json()).toHaveLength(1);
        const subs = await (await api.get("/api/subscriptions")).json();
        expect(subs).toHaveLength(2);
        expect(subs.every(s => s.status === "active" && s.userId === user.id)).toBe(true);
    });

    test("bad cards, empty carts, visitors and administrators cannot pay", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        expect((await api.post("/api/orders", { data: { card: card() } })).status()).toBe(400);            // empty cart
        await addToCart(api, "dedicated-ip", 1);
        const expired = await api.post("/api/orders", { data: { card: card({ expiry: "01/20" }) } });
        expect(expired.status()).toBe(400);
        expect((await expired.json()).error).toMatch(/expired/);
        expect((await api.post("/api/orders", { data: { card: card({ number: "123" }) } })).status()).toBe(400);
        expect((await api.post("/api/orders", { data: { card: card({ cvv: "1" }) } })).status()).toBe(400);
        expect((await api.post("/api/orders", { data: { card: card({ expiry: "1299" }) } })).status()).toBe(400);
        expect((await product(api, "dedicated-ip")).stock).toBe(64);                                          // nothing changed
        expect((await (await api.get("/api/cart")).json()).count).toBe(1);

        expect((await (await client(playwright, baseURL)).post("/api/orders", { data: { card: card() } })).status()).toBe(401);
        expect((await (await asAdmin(playwright, baseURL)).post("/api/orders", { data: { card: card() } })).status()).toBe(403);
    });

    test("stock that ran out after adding to the cart blocks the payment, and nothing is charged", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "dedicated-ip", 3);
        await addToCart(api, "extra-storage", 1);
        const admin = await asAdmin(playwright, baseURL);
        await admin.patch("/api/products/dedicated-ip", { data: { stock: 1 } });
        const res = await api.post("/api/orders", { data: { card: card() } });
        expect(res.status()).toBe(409);
        expect((await res.json()).error).toMatch(/Only 1 Dedicated IP left/);
        expect((await product(api, "extra-storage")).stock).toBe(200);        // the other line was not touched
        expect(await (await api.get("/api/orders")).json()).toHaveLength(0);
        expect((await (await api.get("/api/cart")).json()).count).toBe(4);
    });

    test("two customers racing for the last unit: exactly one wins", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        await admin.patch("/api/products/dedicated-ip", { data: { stock: 1 } });
        const a = await asCustomer(playwright, baseURL);
        const b = await asCustomer(playwright, baseURL);
        expect((await addToCart(a.api, "dedicated-ip", 1)).status()).toBe(201);
        expect((await addToCart(b.api, "dedicated-ip", 1)).status()).toBe(201);   // the cart does not reserve stock
        const [ra, rb] = await Promise.all([
            a.api.post("/api/orders", { data: { card: card() } }),
            b.api.post("/api/orders", { data: { card: card() } }),
        ]);
        expect([ra.status(), rb.status()].sort()).toEqual([201, 409]);
        const ip = await product(admin, "dedicated-ip");
        expect([ip.stock, ip.sold]).toEqual([0, 151]);
    });

    test("a product deleted after it was added does not block the payment", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "dedicated-ip", 1);
        await addToCart(api, "daily-backups", 1);
        const admin = await asAdmin(playwright, baseURL);
        expect((await admin.delete("/api/products/dedicated-ip")).status()).toBe(204);
        const cart = await (await api.get("/api/cart")).json();
        expect(cart.lines.map(l => l.productId)).toEqual(["daily-backups"]);
        const res = await api.post("/api/orders", { data: { card: card() } });
        expect(res.status()).toBe(201);
        expect((await res.json()).items).toHaveLength(1);
        expect((await (await api.get("/api/cart")).json()).count).toBe(0);
    });

    test("administrators see every order, customers only their own", async ({ playwright, baseURL }) => {
        const a = await asCustomer(playwright, baseURL);
        const b = await asCustomer(playwright, baseURL);
        for (const who of [a, b]) { await addToCart(who.api, "daily-backups", 1); await who.api.post("/api/orders", { data: { card: card() } }); }
        expect(await (await a.api.get("/api/orders")).json()).toHaveLength(1);
        const admin = await asAdmin(playwright, baseURL);
        expect(await (await admin.get("/api/orders")).json()).toHaveLength(2);
        expect(await (await admin.get("/api/subscriptions")).json()).toHaveLength(2);
    });
});

test.describe("A5 Virtual machine capacity", () => {
    test("buying VMs uses the physical servers of the chosen data center", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "standard-vm", 3, { options: { "Data center": "Fortaleza" } });
        expect((await api.post("/api/orders", { data: { card: card() } })).status()).toBe(201);
        const standard = await product(api, "standard-vm");
        expect(standard.capacityByRegion).toEqual({ "São Paulo": 16, "Rio de Janeiro": 16, "Fortaleza": 13 });
        expect(standard.stock).toBe(45);
        // The same hardware serves the other plans: 3 x (2 vCPU, 4 GB, 80 GB) are gone from Fortaleza.
        const admin = await asAdmin(playwright, baseURL);
        const servers = await (await admin.get("/api/servers")).json();
        const fortaleza = servers.find(s => s.region === "Fortaleza");
        expect(fortaleza.free).toMatchObject({ cpu: 26, ram: 116, storage: 1760, gpu: 0 });
    });

    test("a full data center refuses more VMs (409), other data centers still work", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        expect((await addToCart(api, "performance-vm", 4, { options: { "Data center": "São Paulo" } })).status()).toBe(201);
        const more = await addToCart(api, "performance-vm", 1, { options: { "Data center": "São Paulo" } });
        expect(more.status()).toBe(409);
        expect((await more.json()).error).toMatch(/no remaining capacity in São Paulo/);
        expect((await addToCart(api, "performance-vm", 1, { options: { "Data center": "Rio de Janeiro" } })).status()).toBe(201);
    });

    test("capacity changes between adding and paying: the payment is refused", async ({ playwright, baseURL }) => {
        const a = await asCustomer(playwright, baseURL);
        const b = await asCustomer(playwright, baseURL);
        await addToCart(a.api, "performance-vm", 4);
        await addToCart(b.api, "performance-vm", 1);
        expect((await a.api.post("/api/orders", { data: { card: card() } })).status()).toBe(201);
        const late = await b.api.post("/api/orders", { data: { card: card() } });
        expect(late.status()).toBe(409);
        expect((await late.json()).error).toMatch(/Insufficient capacity/);
    });

    test("administrators add servers; VM stock cannot be typed", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        const before = (await product(admin, "performance-vm")).capacityByRegion["São Paulo"];
        const res = await admin.post("/api/servers", { data: { region: "São Paulo", cpu: 16, ram: 64, storage: 640, gpu: 0 } });
        expect(res.status()).toBe(201);
        expect((await product(admin, "performance-vm")).capacityByRegion["São Paulo"]).toBe(before + 2);
        expect((await admin.post("/api/servers", { data: { region: "Marte", cpu: 1, ram: 1, storage: 1, gpu: 0 } })).status()).toBe(400);
        expect((await admin.post("/api/servers", { data: { region: "Fortaleza", cpu: 0, ram: 1, storage: 1, gpu: 0 } })).status()).toBe(400);
        const edit = await admin.patch("/api/products/standard-vm", { data: { stock: 99 } });
        expect(edit.status()).toBe(400);
        expect((await edit.json()).error).toMatch(/derived from physical servers/);
    });

    test("a GPU server makes the GPU VM available", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        expect((await product(admin, "gpu-vm")).stock).toBe(0);
        await admin.post("/api/servers", { data: { region: "São Paulo", cpu: 64, ram: 256, storage: 4000, gpu: 2 } });
        const gpu = await product(admin, "gpu-vm");
        expect(gpu.capacityByRegion["São Paulo"]).toBe(2);
    });
});

test.describe("A6 Free trial (our feature)", () => {
    const trialData = (overrides = {}) => ({ os: "Debian 12", region: "São Paulo", hostname: "ana-trial", ssh: "", agree: true, ...overrides });

    test("a customer starts one trial; it reserves a VM and a second is refused", async ({ playwright, baseURL }) => {
        const { api, user } = await asCustomer(playwright, baseURL);
        const res = await api.post("/api/trials", { data: trialData() });
        expect(res.status()).toBe(201);
        const trial = await res.json();
        expect(trial).toMatchObject({ userId: user.id, hostname: "ana-trial", region: "São Paulo", productId: "standard-vm" });
        expect(Date.parse(trial.endsAt) - Date.parse(trial.startedAt)).toBe(14 * 86400000);
        expect((await product(api, "standard-vm")).capacityByRegion["São Paulo"]).toBe(15);
        expect(await (await api.get("/api/trials")).json()).toHaveLength(1);
        const again = await api.post("/api/trials", { data: trialData({ hostname: "outra-vm" }) });
        expect(again.status()).toBe(409);
        expect((await again.json()).error).toMatch(/already used/);
    });

    test("validation: name, SSH key, policy, system and data center", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        expect((await api.post("/api/trials", { data: trialData({ hostname: "AB" }) })).status()).toBe(400);
        expect((await api.post("/api/trials", { data: trialData({ ssh: "isto nao e uma chave" }) })).status()).toBe(400);
        expect((await api.post("/api/trials", { data: trialData({ agree: false }) })).status()).toBe(400);
        expect((await api.post("/api/trials", { data: trialData({ os: "Windows 95" }) })).status()).toBe(400);
        expect((await api.post("/api/trials", { data: trialData({ region: "Marte" }) })).status()).toBe(400);
        expect((await api.post("/api/trials", { data: trialData({ ssh: "ssh-ed25519 AAAAC3Nza ana@pc" }) })).status()).toBe(201);
    });

    test("visitors and administrators cannot start trials", async ({ playwright, baseURL }) => {
        expect((await (await client(playwright, baseURL)).post("/api/trials", { data: trialData() })).status()).toBe(401);
        const admin = await asAdmin(playwright, baseURL);
        const res = await admin.post("/api/trials", { data: trialData() });
        expect(res.status()).toBe(403);
        expect((await res.json()).error).toMatch(/Administrator accounts can't start trials/);
    });

    test("a data center without capacity refuses the trial", async ({ playwright, baseURL }) => {
        const a = await asCustomer(playwright, baseURL);
        await addToCart(a.api, "standard-vm", 16, { options: { "Data center": "Fortaleza" } });
        expect((await a.api.post("/api/orders", { data: { card: card() } })).status()).toBe(201);
        const b = await asCustomer(playwright, baseURL);
        const res = await b.api.post("/api/trials", { data: trialData({ region: "Fortaleza" }) });
        expect(res.status()).toBe(409);
        expect((await res.json()).error).toMatch(/Insufficient capacity/);
        expect((await b.api.post("/api/trials", { data: trialData({ region: "Rio de Janeiro" }) })).status()).toBe(201);
    });

    test("when the 14 days end, the VM returns to the capacity", async ({ playwright, baseURL }) => {
        const { api, user } = await asCustomer(playwright, baseURL);
        await api.post("/api/trials", { data: trialData() });
        expect((await product(api, "standard-vm")).stock).toBe(47);
        const ended = await api.post("/api/test/expire", { data: { collection: "trials", userId: user.id } });
        expect((await ended.json()).changed).toBe(1);
        expect((await product(api, "standard-vm")).stock).toBe(48);
        expect((await (await api.get("/api/trials")).json())[0].released).toBe(true);
    });

    test("deleting an account frees its trial", async ({ playwright, baseURL }) => {
        const { api, user } = await asCustomer(playwright, baseURL);
        await api.post("/api/trials", { data: trialData() });
        const admin = await asAdmin(playwright, baseURL);
        expect((await admin.delete(`/api/users/${user.id}`)).status()).toBe(204);
        expect((await product(admin, "standard-vm")).stock).toBe(48);
        expect(await (await admin.get("/api/trials")).json()).toHaveLength(0);
    });
});

test.describe("A7 Subscriptions", () => {
    test("cancelling refunds the unused time and returns add-on stock", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "dedicated-ip", 2, { months: 12 });
        await api.post("/api/orders", { data: { card: card() } });
        expect((await product(api, "dedicated-ip")).stock).toBe(62);
        const [sub] = await (await api.get("/api/subscriptions")).json();
        expect(sub.paid).toBeCloseTo(9.9 * 2 * 12, 2);

        const res = await api.patch(`/api/subscriptions/${sub.id}`, { data: { status: "cancelled" } });
        expect(res.status()).toBe(200);
        const cancelled = await res.json();
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.refund).toBeGreaterThan(sub.paid * 0.99);
        expect(cancelled.refund).toBeLessThanOrEqual(sub.paid);
        expect((await product(api, "dedicated-ip")).stock).toBe(64);
        expect((await api.patch(`/api/subscriptions/${sub.id}`, { data: { status: "cancelled" } })).status()).toBe(409);   // only once
        expect((await api.patch(`/api/subscriptions/${sub.id}`, { data: { status: "active" } })).status()).toBe(400);
    });

    test("cancelling a VM subscription frees its capacity; other customers' subscriptions are off limits", async ({ playwright, baseURL }) => {
        const a = await asCustomer(playwright, baseURL);
        const b = await asCustomer(playwright, baseURL);
        await addToCart(a.api, "performance-vm", 2);
        await a.api.post("/api/orders", { data: { card: card() } });
        expect((await product(a.api, "performance-vm")).capacityByRegion["São Paulo"]).toBe(2);
        const [sub] = await (await a.api.get("/api/subscriptions")).json();
        expect((await b.api.patch(`/api/subscriptions/${sub.id}`, { data: { status: "cancelled" } })).status()).toBe(404);
        expect((await a.api.patch(`/api/subscriptions/${sub.id}`, { data: { status: "cancelled" } })).status()).toBe(200);
        expect((await product(a.api, "performance-vm")).capacityByRegion["São Paulo"]).toBe(4);
    });

    test("an ended subscription expires on its own and gives its units back", async ({ playwright, baseURL }) => {
        const { api } = await asCustomer(playwright, baseURL);
        await addToCart(api, "daily-backups", 3);
        await addToCart(api, "nano-vm", 1);
        await api.post("/api/orders", { data: { card: card() } });
        expect((await product(api, "daily-backups")).stock).toBe(996);
        const nanoBefore = (await product(api, "nano-vm")).stock;
        await api.post("/api/test/expire", { data: { collection: "subscriptions" } });
        expect((await product(api, "daily-backups")).stock).toBe(999);
        expect((await product(api, "nano-vm")).stock).toBe(nanoBefore + 1);
        expect((await (await api.get("/api/subscriptions")).json()).every(s => s.status === "expired")).toBe(true);
        // Cancelling something that already ended is refused.
        const [sub] = await (await api.get("/api/subscriptions")).json();
        expect((await api.patch(`/api/subscriptions/${sub.id}`, { data: { status: "cancelled" } })).status()).toBe(409);
    });

    test("customers with active subscriptions cannot be deleted; products with active services either", async ({ playwright, baseURL }) => {
        const { api, user } = await asCustomer(playwright, baseURL);
        await addToCart(api, "daily-backups", 1);
        await api.post("/api/orders", { data: { card: card() } });
        const admin = await asAdmin(playwright, baseURL);
        expect((await admin.delete(`/api/users/${user.id}`)).status()).toBe(409);
        expect((await admin.delete("/api/products/daily-backups")).status()).toBe(409);
        expect((await admin.patch("/api/products/daily-backups", { data: { category: "vpn" } })).status()).toBe(409);
        const [sub] = await (await api.get("/api/subscriptions")).json();
        await api.patch(`/api/subscriptions/${sub.id}`, { data: { status: "cancelled" } });
        expect((await admin.delete("/api/products/daily-backups")).status()).toBe(204);
        expect((await admin.delete(`/api/users/${user.id}`)).status()).toBe(204);
    });
});

test.describe("A8 Product management", () => {
    test("create, read, edit, restock and delete a product", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        const created = await admin.post("/api/products", { data: {
            name: "Cold Storage", category: "addons", icon: "🧊", price: 5.5, unit: "/mo", stock: 10, sold: 0,
            description: "Cheap archive space.", specs: [["Size", "1 TB"]], monthlyCost: 2 } });
        expect(created.status()).toBe(201);
        const p = await created.json();
        expect(p).toMatchObject({ id: "cold-storage", stock: 10, specs: [["Size", "1 TB"]], monthlyCost: 2 });
        expect((await admin.post("/api/products", { data: { name: "Cold Storage", category: "addons", price: 1, stock: 1, description: "x" } })).status()).toBe(409);

        const edited = await admin.patch("/api/products/cold-storage", { data: { price: 6, stock: 0, name: "Cold Storage XL" } });
        expect(edited.status()).toBe(200);
        expect(await edited.json()).toMatchObject({ price: 6, stock: 0, name: "Cold Storage XL", description: "Cheap archive space." });
        const { api } = await asCustomer(playwright, baseURL);
        expect((await addToCart(api, "cold-storage", 1)).status()).toBe(409);               // sold out now

        expect((await admin.delete("/api/products/cold-storage")).status()).toBe(204);
        expect((await admin.get("/api/products/cold-storage")).status()).toBe(404);
        expect((await admin.delete("/api/products/cold-storage")).status()).toBe(404);
    });

    test("invalid product data is refused", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        const base = { name: "Teste", category: "addons", price: 1, stock: 1, description: "ok" };
        for (const bad of [
            { ...base, name: "" }, { ...base, price: -1 }, { ...base, price: "1" }, { ...base, stock: -1 }, { ...base, stock: 1.5 },
            { ...base, description: " " }, { ...base, category: "carros" }, { ...base, specs: [["so-label"]] }, { ...base, monthlyCost: -3 },
        ]) {
            expect((await admin.post("/api/products", { data: bad })).status(), JSON.stringify(bad)).toBe(400);
        }
        expect((await admin.patch("/api/products/nano-vm", { data: { price: -5 } })).status()).toBe(400);
        // A VM plan must describe its CPU, memory and storage: capacity is computed from them.
        expect((await admin.post("/api/products", { data: { ...base, category: "vms", specs: [["CPU", "muito"]] } })).status()).toBe(400);
        const vm = await admin.post("/api/products", { data: { ...base, name: "Mini VM", category: "vms", stock: 77,
            specs: [["CPU", "1 vCPU"], ["Memory", "512 MB"], ["Storage", "10 GB SSD"]] } });
        expect(vm.status()).toBe(201);
        // 1 vCPU, 0.5 GB, 10 GB: 32 fit on each of the 3 servers. The 77 that was sent is ignored.
        expect((await vm.json()).stock).toBe(96);
    });

    test("an administrator can upload a photo (data URL) with the product", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        const image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
        const res = await admin.patch("/api/products/dedicated-ip", { data: { image } });
        expect((await res.json()).image).toBe(image);
        expect((await admin.patch("/api/products/dedicated-ip", { data: { image: 5 } })).status()).toBe(400);
    });
});

test.describe("A9 Robustness", () => {
    test("malformed JSON answers 400, and the session cookie is HttpOnly", async ({ request, playwright, baseURL }) => {
        const res = await request.post("/api/auth/login", { headers: { "Content-Type": "application/json" }, data: "{nao-e-json" });
        expect(res.status()).toBe(400);
        const api = await client(playwright, baseURL);
        const login = await api.post("/api/auth/login", { data: { login: "admin", password: "admin" } });
        const cookie = login.headers()["set-cookie"];
        expect(cookie).toMatch(/cc_sid=[0-9a-f]{64}/);
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Lax/);
    });

    test("each sign-in gets a new session id, and a forged cookie is just a visitor", async ({ playwright, baseURL }) => {
        const a = await client(playwright, baseURL);
        const first = (await a.post("/api/auth/login", { data: { login: "admin", password: "admin" } })).headers()["set-cookie"];
        const second = (await a.post("/api/auth/login", { data: { login: "admin", password: "admin" } })).headers()["set-cookie"];
        expect(first.split(";")[0]).not.toBe(second.split(";")[0]);
        const forged = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: "cc_sid=" + "0".repeat(64) } });
        expect((await (await forged.get("/api/auth/me")).json()).user).toBeNull();
        expect((await forged.get("/api/users")).status()).toBe(401);
    });

    test("malformed cookie, address or login answer 4xx, never 500", async ({ request, playwright, baseURL }) => {
        // A cookie that can't be decoded is ignored: the person is just a visitor.
        const badCookie = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: "cc_sid=%E0%A4%A" } });
        const me = await badCookie.get("/api/auth/me");
        expect(me.status()).toBe(200);
        expect((await me.json()).user).toBeNull();
        expect((await badCookie.get("/api/products")).status()).toBe(200);
        // A badly %-encoded address is the client's mistake.
        const badUrl = await request.get("/api/products/%E0%A4%A");
        expect(badUrl.status()).toBe(400);
        expect(await badUrl.json()).toHaveProperty("error");
        // The login must be text; objects and arrays are refused without signing in.
        for (const login of [{ $ne: null }, ["admin"], 42, null]) {
            const res = await request.post("/api/auth/login", { data: { login, password: "admin" } });
            expect(res.status(), JSON.stringify(login)).toBe(400);
        }
    });

    test("signing out ends the session on the server", async ({ playwright, baseURL }) => {
        const admin = await asAdmin(playwright, baseURL);
        const cookie = (await admin.storageState()).cookies[0];
        await admin.post("/api/auth/logout");
        // Replaying the old cookie must not work any more.
        const replay = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `cc_sid=${cookie.value}` } });
        expect((await replay.get("/api/users")).status()).toBe(401);
    });
});
