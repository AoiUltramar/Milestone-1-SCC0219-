/* ==========================================================================
   db.js — the "server" for Milestone 2
   --------------------------------------------------------------------------
   The assignment allows simulating the back end in the browser. This file
   is that simulation: every collection (products, users, carts, orders,
   trials) is a JSON array saved in localStorage, and every call waits
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

    // Runs once per browser (or again after VERSION changes).
    function seedIfNeeded() {
        if (readRaw("version") === VERSION) return;
        writeRaw("products", SEED_PRODUCTS);
        writeRaw("users", []);      // auth.js adds the admin/admin account
        writeRaw("carts", []);
        writeRaw("orders", []);
        writeRaw("trials", []);
        writeRaw("version", VERSION);
    }
    seedIfNeeded();

    // A trial VM stops at the end of its 14 days, so its unit of Standard VM
    // stock goes back on sale. Runs on every page load.
    function releaseEndedTrials() {
        const trials = readRaw("trials") ?? [];
        const now = Date.now();
        const ended = trials.filter(t => !t.released && new Date(t.endsAt).getTime() <= now);
        if (!ended.length) return;
        const products = readRaw("products") ?? [];
        ended.forEach(t => {
            const p = products.find(x => x.id === t.productId);
            if (p) p.stock += 1;
            t.released = true;
        });
        try {
            writeRaw("products", products);
            writeRaw("trials", trials);
        } catch { /* storage full: try again next load */ }
    }
    releaseEndedTrials();

    /* ---------- Generic CRUD ---------- */
    function newId(prefix) {
        return prefix + "-" + (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));
    }

    async function list(name) {
        await delay();
        return clone(readRaw(name) ?? []);
    }

    async function get(name, id) {
        await delay();
        return clone((readRaw(name) ?? []).find(item => item.id === id)) ?? null;
    }

    async function insert(name, data) {
        await delay();
        const items = readRaw(name) ?? [];
        const item = { ...clone(data), id: data.id || newId(name.slice(0, -1)) };
        if (items.some(i => i.id === item.id)) throw new Error(`An item with id "${item.id}" already exists.`);
        items.push(item);
        writeRaw(name, items);
        return clone(item);
    }

    async function update(name, id, changes) {
        await delay();
        const items = readRaw(name) ?? [];
        const index = items.findIndex(i => i.id === id);
        if (index === -1) throw new Error("Item not found.");
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
        const names = ["products", "users", "carts", "orders", "trials"];
        const tables = Object.fromEntries(names.map(n => [n, readRaw(n) ?? []]));
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
             CATEGORIES, formatAmount, formatPrice };
})();
