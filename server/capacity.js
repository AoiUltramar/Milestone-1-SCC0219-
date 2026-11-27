/* ==========================================================================
   capacity.js — how many virtual machines fit on the physical servers
   --------------------------------------------------------------------------
   A VM plan has no "stock" number. Instead the store owns physical servers
   (CPU cores, RAM, disk, GPUs per data center) and every active subscription
   or free trial reserves part of one server. What is left over is the
   capacity that can still be sold.

   This file holds only pure functions (no database access), so the rules are
   easy to read and to test. Objects use `id` (see store.js), not `_id`.
   ========================================================================== */

const { CATEGORIES } = require("../shared/config");
const { bad, conflict } = require("./errors");

const RESOURCES = ["cpu", "ram", "storage", "gpu"];
const REGIONS = CATEGORIES.vms.options["Data center"];

// What one VM of this plan needs, read from the specs shown in the catalog
// (e.g. "2 vCPU", "4 GB RAM", "80 GB SSD", "1 × 24 GB"). RAM and storage are
// converted to GB.
function requirements(product) {
    const specs = Object.fromEntries(product.specs ?? []);
    const cpu = /^(\d+)\s+(?:shared\s+)?vCPUs?$/i.exec(specs.CPU ?? "");
    const ram = /^(\d+(?:\.\d+)?)\s+(GB|MB)(?:\s+RAM)?$/i.exec(specs.Memory ?? "");
    const storage = /^(\d+(?:\.\d+)?)\s+(GB|TB)(?:\s+(?:SSD|NVMe))?$/i.exec(specs.Storage ?? "");
    const gpu = specs.GPU ? /^(\d+)(?:\s*[×x]\s*24\s+GB)?$/i.exec(specs.GPU) : [null, "0"];
    if (!cpu || !ram || !storage || !gpu || +cpu[1] < 1 || +ram[1] <= 0 || +storage[1] <= 0) {
        throw bad("VM specs need CPU (e.g. 2 vCPU), Memory (4 GB RAM), Storage (80 GB SSD), and optionally GPU (1 × 24 GB).");
    }
    return { cpu: +cpu[1], ram: +ram[1] / (ram[2].toUpperCase() === "MB" ? 1024 : 1),
             storage: +storage[1] * (storage[2].toUpperCase() === "TB" ? 1000 : 1), gpu: +gpu[1] };
}

// Servers with a `free` field: total resources minus everything reserved by
// active subscriptions and running trials. `tables` = { servers, subscriptions, trials }.
function infrastructureState(tables) {
    const now = Date.now();
    const servers = tables.servers.map(s => ({ ...s, free: Object.fromEntries(RESOURCES.map(k => [k, s[k]])) }));
    const active = [...tables.subscriptions.filter(s => s.status === "active" && Date.parse(s.endsAt) > now),
                    ...tables.trials.filter(t => !t.released && Date.parse(t.endsAt) > now)];
    active.forEach(record => (record.allocations ?? []).forEach(a => {
        const server = servers.find(s => s.id === a.serverId);
        if (server) RESOURCES.forEach(k => { server.free[k] -= a.resources[k] * a.qty; });
    }));
    return servers;
}

// How many VMs needing `need` still fit on this server (the scarcest resource decides).
function slots(server, need) {
    return Math.max(0, Math.min(...RESOURCES.filter(k => need[k] > 0).map(k => Math.floor(server.free[k] / need[k]))));
}

// First fit: every VM must fit on ONE physical host of the chosen data center.
// Reserves the resources on `servers` (so several cart lines can be allocated
// one after the other) and returns the list of reservations to store.
function allocate(servers, product, region, qty) {
    if (!REGIONS.includes(region) || !Number.isSafeInteger(qty) || qty < 1) throw bad("Invalid VM region or quantity.");
    const need = requirements(product);
    const candidates = servers.filter(s => s.region === region);
    if (candidates.reduce((n, s) => n + slots(s, need), 0) < qty) {
        throw conflict(`Insufficient capacity for ${product.name} in ${region}.`);
    }
    const allocations = [];
    for (const server of candidates) {
        const count = Math.min(qty, slots(server, need));
        if (!count) continue;
        allocations.push({ serverId: server.id, qty: count, resources: { ...need } });
        RESOURCES.forEach(k => { server.free[k] -= need[k] * count; });
        qty -= count;
        if (!qty) break;
    }
    return allocations;
}

// Products as the catalog shows them: for VMs, `stock` is derived (total
// capacity over all data centers) and `capacityByRegion` is added.
function availableProducts(tables) {
    const servers = infrastructureState(tables);
    return tables.products.map(p => {
        if (p.category !== "vms") return p;
        let need;
        try { need = requirements(p); } catch { return { ...p, stock: 0, capacityByRegion: Object.fromEntries(REGIONS.map(r => [r, 0])) }; }
        const capacityByRegion = Object.fromEntries(REGIONS.map(r => [r, servers.filter(s => s.region === r).reduce((n, s) => n + slots(s, need), 0)]));
        return { ...p, stock: Object.values(capacityByRegion).reduce((a, b) => a + b, 0), capacityByRegion };
    });
}

// How many more units of a product can still be put in a cart that already
// holds `items`. Non-VM: stock minus what the cart has. VM: simulate the
// cart's VMs on the servers first, then count what fits in the region.
// `tables` = { products, servers, subscriptions, trials } (raw products).
function capacityFor(tables, productId, options, items = []) {
    const product = tables.products.find(p => p.id === productId);
    if (!product) return 0;
    if (product.category !== "vms") {
        return Math.max(0, product.stock - items.filter(i => i.productId === productId).reduce((n, i) => n + i.qty, 0));
    }
    const servers = infrastructureState(tables);
    try {
        for (const i of items) {
            const p = tables.products.find(x => x.id === i.productId);
            if (p?.category === "vms") allocate(servers, p, i.options?.["Data center"] ?? REGIONS[0], i.qty);
        }
        const need = requirements(product);
        return servers.filter(s => s.region === (options?.["Data center"] ?? REGIONS[0])).reduce((n, s) => n + slots(s, need), 0);
    } catch { return 0; }
}

module.exports = { RESOURCES, REGIONS, requirements, infrastructureState, slots, allocate, availableProducts, capacityFor };
