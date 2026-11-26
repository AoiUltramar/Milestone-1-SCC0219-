/* ==========================================================================
   db.js — the "server" for Milestone 2
   --------------------------------------------------------------------------
   The assignment allows simulating the back end in the browser. This file
   is that simulation: every collection is a JSON array saved in localStorage, and every call waits
   100 ms like a network request would (the delay() trick from the spec).

   All functions are async and return copies, so page code can't change
   the stored data by accident. When the real Node.js server exists, only
   the bodies of these functions change, to fetch() calls such as:
       GET    /api/products        -> DB.list("products")
       GET    /api/products/:id    -> DB.get("products", id)
       POST   /api/products        -> DB.insert("products", data)
       PUT    /api/products/:id    -> DB.update("products", id, changes)
       DELETE /api/products/:id    -> DB.remove("products", id)

   Load first on every page:  <script src="../static/js/db.js" defer></script>
   ========================================================================== */

const DB = (() => {
    const PREFIX = "cc_";
    const VERSION = 2;          // bump to wipe old demo data and re-seed

    /* ---------- Simulated latency ---------- */
    function delay(ms = 100) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /* ---------- Raw storage ---------- */
    // In-memory fallback for when localStorage is blocked (private mode).
    // Once storage fails to open we use only memory, so reads and writes
    // always go to the same place.
    const memory = {};
    let storageOk = true;

    const isQuotaError = err =>
        err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        err?.code === 22 || err?.code === 1014;

    function readRaw(name) {
        if (storageOk) {
            let raw;
            try {
                raw = localStorage.getItem(PREFIX + name);
            } catch {
                storageOk = false;          // storage blocked: switch to memory
            }
            if (storageOk) {
                try { return raw === null ? null : JSON.parse(raw); } catch { return null; }   // corrupt value
            }
        }
        return name in memory ? structuredClone(memory[name]) : null;
    }
    function writeRaw(name, value) {
        if (storageOk) {
            try {
                localStorage.setItem(PREFIX + name, JSON.stringify(value));
                return;
            } catch (err) {
                // A full storage must not lose the write silently.
                if (isQuotaError(err)) throw new Error("Storage is full (quota exceeded). Nothing was saved.");
                storageOk = false;
            }
        }
        memory[name] = structuredClone(value);
    }
    const clone = value => (value === undefined ? undefined : structuredClone(value));

    /* ---------- Seed data (what a fresh database contains) ---------- */
    const SEED_PRODUCTS = [
        { id: "nano-vm", category: "vms", name: "Nano VM", icon: "🖥️", price: 19.9, unit: "/mo", stock: 120, sold: 341,
          description: "Small and cheap: a personal website, a Discord bot, a VPN endpoint or a first server to learn on.",
          specs: [["CPU", "1 vCPU"], ["Memory", "1 GB RAM"], ["Storage", "25 GB SSD"], ["Transfer", "500 GB per month"], ["Network", "1 public IPv4 + IPv6"]] },
        { id: "standard-vm", category: "vms", name: "Standard VM", icon: "🖥️", price: 49.9, unit: "/mo", stock: 42, sold: 512, trial: true,
          description: "A dependable everyday server: host a website, run a game server, a database or your side project's API.",
          specs: [["CPU", "2 vCPU"], ["Memory", "4 GB RAM"], ["Storage", "80 GB SSD"], ["Transfer", "1 TB per month"], ["Network", "1 public IPv4 + IPv6"]] },
        { id: "performance-vm", category: "vms", name: "Performance VM", icon: "🚀", price: 249.9, unit: "/mo", stock: 15, sold: 88,
          description: "Room for busy stores, CI runners and production databases that need steady CPU and lots of memory.",
          specs: [["CPU", "8 vCPU"], ["Memory", "32 GB RAM"], ["Storage", "320 GB SSD"], ["Transfer", "4 TB per month"], ["Network", "1 public IPv4 + IPv6"]] },
        { id: "gpu-vm", category: "vms", name: "GPU VM", icon: "🎛️", price: 1490, unit: "/mo", stock: 0, sold: 23,
          description: "A dedicated GPU for machine learning, rendering and video encoding.",
          specs: [["CPU", "16 vCPU"], ["Memory", "64 GB RAM"], ["GPU", "1 × 24 GB"], ["Storage", "500 GB NVMe"], ["Network", "1 public IPv4 + IPv6"]] },
        { id: "personal-vpn", category: "vpn", name: "Personal VPN", icon: "🔒", price: 14.9, unit: "/mo", stock: 999, sold: 1204,
          description: "For one person and their gadgets: safer public Wi-Fi and your own IP kept to yourself.",
          specs: [["Devices", "Up to 5"], ["Servers", "12 countries"], ["Logs", "No activity logs"], ["Apps", "Windows, macOS, Linux, Android, iOS"]] },
        { id: "family-vpn", category: "vpn", name: "Family VPN", icon: "👨‍👩‍👧", price: 24.9, unit: "/mo", stock: 999, sold: 430,
          description: "One plan for the whole house, with ads and trackers blocked before they load.",
          specs: [["Devices", "Up to 10"], ["Servers", "12 countries"], ["Blocking", "Ads and trackers"], ["Apps", "Windows, macOS, Linux, Android, iOS"]] },
        { id: "business-vpn", category: "vpn", name: "Business VPN", icon: "🏢", price: 29.9, unit: "/seat/mo", stock: 500, sold: 97,
          description: "Give each team member access and manage everyone from a single admin panel.",
          specs: [["Billing", "Per team member"], ["Admin", "Shared admin panel"], ["Sign-in", "Single sign-on"], ["Servers", "12 countries"]] },
        { id: "dedicated-ip", category: "addons", name: "Dedicated IP", icon: "🌐", price: 9.9, unit: "/mo", stock: 64, sold: 150,
          description: "A fixed IPv4 address that only you use, handy for allow-lists and remote access.",
          specs: [["Address", "1 dedicated IPv4"], ["Works with", "Any VM or VPN plan"], ["Reverse DNS", "Editable"]] },
        { id: "daily-backups", category: "addons", name: "Daily backups", icon: "💾", price: 7.9, unit: "/mo", stock: 999, sold: 276,
          description: "A full snapshot of your VM every night, restorable in a couple of clicks.",
          specs: [["Schedule", "Every night"], ["Kept for", "7 days"], ["Restore", "Whole VM or single files"]] },
        { id: "extra-storage", category: "addons", name: "Extra storage", icon: "📦", price: 12.9, unit: "/mo", stock: 200, sold: 181,
          description: "More disk for uploads, media and databases without moving to a bigger plan.",
          specs: [["Size", "+100 GB SSD volume"], ["Attach to", "Any VM"], ["Resize", "Anytime, no reboot"]] },
    ];

    // `options`: purchase choices each product of the category carries in the
    // cart (requirement 18). The first value is the default. The selects on
    // vms.html / vpn.html and the WebMCP schemas must use these same values.
    const CATEGORIES = {
        vms:    { name: "Virtual machines", meta: "Virtual machine",
                  options: { "Data center": ["São Paulo", "Rio de Janeiro", "Fortaleza"],
                             "OS": ["Ubuntu 24.04 LTS", "Debian 12", "Fedora 40", "Rocky Linux 9"] } },
        vpn:    { name: "VPN",              meta: "VPN",
                  options: { "Exit country": ["Brazil", "United States", "Portugal", "Germany", "Japan"] } },
        addons: { name: "Add-ons",          meta: "Add-on", options: {} },
    };

    /* ---------- Physical infrastructure ---------- */
    const RESOURCES = ["cpu", "ram", "storage", "gpu"];
    const regions = CATEGORIES.vms.options["Data center"];

    function seedServers() {
        return regions.map((region, i) => ({ id: `server-${i + 1}`, region, cpu: 32, ram: 128, storage: 2000, gpu: 0 }));
    }

    // VM requirements come from the same specifications shown in the catalog.
    function requirements(product) {
        const specs = Object.fromEntries(product.specs ?? []);
        const cpu = /^(\d+)\s+(?:shared\s+)?vCPUs?$/i.exec(specs.CPU ?? "");
        const ram = /^(\d+(?:\.\d+)?)\s+(GB|MB)(?:\s+RAM)?$/i.exec(specs.Memory ?? "");
        const storage = /^(\d+(?:\.\d+)?)\s+(GB|TB)(?:\s+(?:SSD|NVMe))?$/i.exec(specs.Storage ?? "");
        const gpu = specs.GPU ? /^(\d+)(?:\s*[×x]\s*24\s+GB)?$/i.exec(specs.GPU) : [null, "0"];
        if (!cpu || !ram || !storage || !gpu || +cpu[1] < 1 || +ram[1] <= 0 || +storage[1] <= 0) {
            throw new Error("VM specs need CPU (e.g. 2 vCPU), Memory (4 GB RAM), Storage (80 GB SSD), and optionally GPU (1 × 24 GB).");
        }
        return { cpu: +cpu[1], ram: +ram[1] / (ram[2].toUpperCase() === "MB" ? 1024 : 1),
                 storage: +storage[1] * (storage[2].toUpperCase() === "TB" ? 1000 : 1), gpu: +gpu[1] };
    }

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

    function slots(server, need) {
        return Math.max(0, Math.min(...RESOURCES.filter(k => need[k] > 0).map(k => Math.floor(server.free[k] / need[k]))));
    }

    // First fit: every VM must fit on one physical host in its chosen region.
    function allocate(servers, product, region, qty) {
        if (!regions.includes(region) || !Number.isSafeInteger(qty) || qty < 1) throw new Error("Invalid VM region or quantity.");
        const need = requirements(product);
        const candidates = servers.filter(s => s.region === region);
        if (candidates.reduce((n, s) => n + slots(s, need), 0) < qty) throw new Error(`Insufficient capacity for ${product.name} in ${region}.`);
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

    function infrastructureTables() {
        return Object.fromEntries(["products", "servers", "subscriptions", "trials"].map(n => [n, readRaw(n) ?? []]));
    }

    // Availability is derived, never decremented or restocked for a VM plan.
    function availableProducts() {
        const tables = infrastructureTables();
        const servers = infrastructureState(tables);
        return tables.products.map(p => {
            if (p.category !== "vms") return p;
            let need;
            try { need = requirements(p); } catch { return { ...p, stock: 0, capacityByRegion: Object.fromEntries(regions.map(r => [r, 0])) }; }
            const capacityByRegion = Object.fromEntries(regions.map(r => [r, servers.filter(s => s.region === r).reduce((n, s) => n + slots(s, need), 0)]));
            return { ...p, stock: Object.values(capacityByRegion).reduce((a, b) => a + b, 0), capacityByRegion };
        });
    }

    async function capacityFor(productId, options, items = []) {
        await delay();
        const tables = infrastructureTables();
        const product = tables.products.find(p => p.id === productId);
        if (!product) return 0;
        if (product.category !== "vms") return Math.max(0, product.stock - items.filter(i => i.productId === productId).reduce((n, i) => n + i.qty, 0));
        const servers = infrastructureState(tables);
        try {
            for (const i of items) {
                const p = tables.products.find(p => p.id === i.productId);
                if (p?.category === "vms") allocate(servers, p, i.options?.["Data center"] ?? regions[0], i.qty);
            }
            const need = requirements(product);
            return servers.filter(s => s.region === (options?.["Data center"] ?? regions[0])).reduce((n, s) => n + slots(s, need), 0);
        } catch { return 0; }
    }

    async function infrastructure() {
        await delay();
        return clone(infrastructureState(infrastructureTables()));
    }

    async function addServer(data) {
        if ((await Auth.currentUser())?.role !== "admin") throw new Error("Only administrators can add servers.");
        if (!regions.includes(data.region) || RESOURCES.some(k => !Number.isSafeInteger(data[k]) || data[k] < (k === "gpu" ? 0 : 1))) throw new Error("Enter a valid data center and whole resource capacities.");
        return transaction(({ servers }) => {
            const server = { id: newId("server"), region: data.region, ...Object.fromEntries(RESOURCES.map(k => [k, data[k]])) };
            servers.push(server);
            return server;
        });
    }

    // Keep existing active services when upgrading a browser from the previous version.
    function migrateServers() {
        const tables = infrastructureTables();
        tables.servers = seedServers();
        const servers = infrastructureState(tables);
        const records = [...tables.subscriptions.filter(s => s.status === "active" && Date.parse(s.endsAt) > Date.now()),
                         ...tables.trials.filter(t => !t.released && Date.parse(t.endsAt) > Date.now())];
        for (const record of records) {
            const product = tables.products.find(p => p.id === record.productId);
            if (product?.category !== "vms") continue;
            const oldRegion = record.options?.["Data center"] ?? record.region;
            const region = regions.includes(oldRegion) ? oldRegion : regions[0];
            const qty = record.qty ?? 1;
            try { record.allocations = allocate(servers, product, region, qty); }
            catch {
                let need;
                try { need = requirements(product); } catch { record.capacityMigrationPending = true; continue; }
                const server = { id: `legacy-${record.id}`, region, ...Object.fromEntries(RESOURCES.map(k => [k, need[k] * qty])) };
                tables.servers.push(server);
                servers.push({ ...server, free: Object.fromEntries(RESOURCES.map(k => [k, server[k]])) });
                record.allocations = allocate(servers, product, region, qty);
            }
        }
        writeRaw("products", tables.products.map(p => p.category === "vms" ? { ...p, stock: 0 } : p));
        writeRaw("subscriptions", tables.subscriptions);
        writeRaw("trials", tables.trials);
        writeRaw("servers", tables.servers);
    }

    // Runs once per browser (or again after VERSION changes).
    function seedIfNeeded() {
        if (readRaw("version") === VERSION) return;
        writeRaw("products", SEED_PRODUCTS.map(p => p.category === "vms" ? { ...p, stock: 0 } : p));
        writeRaw("users", []);      // auth.js adds the admin/admin account
        writeRaw("carts", []);
        writeRaw("orders", []);
        writeRaw("trials", []);
        writeRaw("subscriptions", []);
        writeRaw("servers", seedServers());
        writeRaw("version", VERSION);
    }
    seedIfNeeded();
    if (readRaw("servers") === null) migrateServers();

    function releaseEndedTrials() {
        const trials = readRaw("trials") ?? [];
        const now = Date.now();
        const ended = trials.filter(t => !t.released && new Date(t.endsAt).getTime() <= now);
        if (!ended.length) return;
        const products = readRaw("products") ?? [];
        ended.forEach(t => {
            const p = products.find(x => x.id === t.productId);
            if (p && p.category !== "vms") p.stock += 1;
            t.released = true;
        });
        try {
            writeRaw("products", products);
            writeRaw("trials", trials);
        } catch { /* storage full: try again next load */ }
    }
    releaseEndedTrials();

    /* ---------- Subscriptions ---------- */
    const DURATIONS = [1, 3, 12];
    const money = value => Math.round((value + Number.EPSILON) * 100) / 100;

    // Keep the same day of the month, clamping to the last day if needed.
    function subscriptionEnd(start, months) {
        const end = new Date(start);
        const day = end.getUTCDate();
        end.setUTCDate(1);
        end.setUTCMonth(end.getUTCMonth() + months);
        const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
        end.setUTCDate(Math.min(day, last));
        return end.toISOString();
    }

    function releaseSubscription(s, products) {
        const p = products.find(x => x.id === s.productId);
        if (p && p.category !== "vms") p.stock += s.qty;
    }

    function releaseEndedSubscriptions({ subscriptions, products }) {
        subscriptions.filter(s => s.status === "active" && Date.parse(s.endsAt) <= Date.now()).forEach(s => {
            releaseSubscription(s, products);
            s.status = "expired";
        });
    }

    async function refreshSubscriptions() {
        if ((readRaw("subscriptions") ?? []).some(s => s.status === "active" && Date.parse(s.endsAt) <= Date.now()) ||
            (readRaw("trials") ?? []).some(t => !t.released && Date.parse(t.endsAt) <= Date.now())) {
            await transaction(() => {});
        }
    }

    /* ---------- Generic CRUD ---------- */
    function newId(prefix) {
        return prefix + "-" + (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));
    }

    async function list(name) {
        await delay();
        if (["products", "subscriptions", "trials", "servers"].includes(name)) await refreshSubscriptions();
        return clone(name === "products" ? availableProducts() : readRaw(name) ?? []);
    }

    async function get(name, id) {
        await delay();
        if (["products", "subscriptions", "trials", "servers"].includes(name)) await refreshSubscriptions();
        return clone((name === "products" ? availableProducts() : readRaw(name) ?? []).find(item => item.id === id)) ?? null;
    }

    async function insert(name, data) {
        await delay();
        const items = readRaw(name) ?? [];
        const item = { ...clone(data), id: data.id || newId(name.slice(0, -1)) };
        if (name === "products" && item.category === "vms") { requirements(item); item.stock = 0; }
        if (items.some(i => i.id === item.id)) throw new Error(`An item with id "${item.id}" already exists.`);
        items.push(item);
        writeRaw(name, items);
        return clone(item);
    }

    async function update(name, id, changes) {
        await delay();
        if (name === "products") await refreshSubscriptions();
        const items = readRaw(name) ?? [];
        const index = items.findIndex(i => i.id === id);
        if (index === -1) throw new Error("Item not found.");
        if (name === "products") {
            const old = items[index];
            const next = { ...old, ...changes };
            if (old.category !== next.category) {
                // A category change must not alter the resource model of an active service.
                const now = Date.now();
                const active = (readRaw("subscriptions") ?? []).some(s => s.productId === id && s.status === "active" && Date.parse(s.endsAt) > now) ||
                    (readRaw("trials") ?? []).some(t => t.productId === id && !t.released && Date.parse(t.endsAt) > now);
                if (active) throw new Error("This product has active services and its category cannot be changed.");
                if (next.category === "vms") {
                    requirements(next);
                    changes = { ...changes, stock: 0 };
                } else if (!Number.isSafeInteger(next.stock) || next.stock < 0) {
                    throw new Error("Stock must be a whole number of zero or more.");
                }
            } else if (next.category === "vms") {
                requirements(next);
                if (Object.hasOwn(changes, "stock")) throw new Error("VM capacity is derived from physical servers. Manage infrastructure on the dashboard.");
            }
        }
        items[index] = { ...items[index], ...clone(changes), id };   // the id never changes
        writeRaw(name, items);
        return clone(items[index]);
    }

    async function remove(name, id) {
        await delay();
        const items = readRaw(name) ?? [];
        const next = items.filter(i => i.id !== id);
        if (next.length === items.length) throw new Error("Item not found.");
        writeRaw(name, next);
        return true;
    }

    // Several changes that must happen together (used by checkout so
    // stock, sales, the order and the cart change in one step).
    async function transaction(fn) {
        await delay();
        const names = ["products", "users", "carts", "orders", "trials", "subscriptions", "servers"];
        const tables = Object.fromEntries(names.map(n => [n, readRaw(n) ?? []]));
        releaseEndedSubscriptions(tables);
        tables.trials.filter(t => !t.released && Date.parse(t.endsAt) <= Date.now()).forEach(t => { t.released = true; });
        const result = fn(tables);             // throw inside fn to cancel everything
        // If a write fails halfway (storage full), put back the tables
        // already written so the change is all-or-nothing.
        const original = Object.fromEntries(names.map(n => [n, readRaw(n) ?? []]));
        const written = [];
        try {
            names.forEach(n => { writeRaw(n, tables[n]); written.push(n); });
        } catch (err) {
            written.forEach(n => { try { writeRaw(n, original[n]); } catch { /* best effort */ } });
            throw err;
        }
        return clone(result);
    }

    // Wipe everything back to the seed data (handy for testing).
    async function reset() {
        writeRaw("version", null);
        seedIfNeeded();
        await delay();
    }

    /* ---------- Formatting helpers shared by all pages ---------- */
    const amountFormat = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatAmount = value => amountFormat.format(value);          // 1490 -> "1.490,00"
    const formatPrice  = value => "R$ " + formatAmount(value);          // -> "R$ 1.490,00"

    return { delay, list, get, insert, update, remove, transaction, reset, newId,
             CATEGORIES, DURATIONS, money, subscriptionEnd, releaseSubscription, formatAmount, formatPrice,
             requirements, allocate, infrastructureState, capacityFor, infrastructure, addServer };
})();
