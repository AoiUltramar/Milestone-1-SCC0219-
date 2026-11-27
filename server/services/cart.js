/* ==========================================================================
   services/cart.js — the shopping cart
   --------------------------------------------------------------------------
   One cart document per owner:  { _id: <owner>, items: [...] }
   The owner is the user id, or "guest:<session id>" for a visitor. Each
   item is { key, productId, qty, options, months }; the same product with
   different options or terms is a separate line (that is what `key` is).

   Rules from the assignment:
     - you can't put more in the cart than there is in stock/capacity;
     - the cart is only emptied by paying or by the customer.
   ========================================================================== */

const { CATEGORIES, DURATIONS } = require("../../shared/config");
const { bad, conflict, notFound } = require("../errors");
const { exclusive } = require("../lock");
const { availableProducts, capacityFor, REGIONS } = require("../capacity");
const { loadTables } = require("./tables");
const { money } = require("../util");

/* ---------- Reading and writing the cart document ---------- */

async function readItems(store, owner) {
    return (await store.cols.carts.findOne({ _id: owner }))?.items ?? [];
}

async function writeItems(store, owner, items) {
    await store.cols.carts.updateOne({ _id: owner }, { $set: { items, updatedAt: new Date().toISOString() } }, { upsert: true });
}

// "standard-vm|Data center=São Paulo&OS=Debian 12|3mo"
const lineKey = (productId, options = {}, months = 1) =>
    productId + "|" + Object.entries(options).sort().map(([k, v]) => k + "=" + v).join("&") + (months === 1 ? "" : `|${months}mo`);

function duration(months) {
    if (!DURATIONS.includes(months)) throw bad("Choose 1, 3 or 12 months.");
    return months;
}

// Missing choices get the default (first value); choices that don't belong
// to the product's category are dropped; invalid values are rejected.
function normalizeOptions(product, options = {}) {
    const spec = CATEGORIES[product.category]?.options ?? {};
    const out = {};
    for (const [name, choices] of Object.entries(spec)) {
        const value = options?.[name];
        if (value === undefined || value === null || value === "") out[name] = choices[0];
        else if (choices.includes(value)) out[name] = value;
        else throw bad(`${name} must be one of: ${choices.join(", ")}.`);
    }
    return out;
}

/* ---------- Reading ---------- */

// Cart lines joined with their product, plus totals.
async function getCart(store, owner) {
    const tables = await loadTables(store);
    const products = availableProducts(tables);
    const items = await readItems(store, owner);
    const lines = items
        .map(item => ({ ...item, product: products.find(p => p.id === item.productId) }))
        .filter(line => line.product);          // product deleted by an admin
    const monthlyTotal = money(lines.reduce((sum, l) => sum + l.product.price * l.qty, 0));
    const total = money(lines.reduce((sum, l) => sum + l.product.price * l.qty * (l.months ?? 1), 0));
    const count = lines.reduce((sum, l) => sum + l.qty, 0);
    return { lines, total, monthlyTotal, count };
}

// For each product: how many MORE units this cart could take in `region`.
// The catalog uses it to show "Only 3 left" and to disable the Add button.
async function availability(store, owner, region, { ignoreCart = false } = {}) {
    const tables = await loadTables(store);
    const items = ignoreCart ? [] : await readItems(store, owner);
    const options = { "Data center": REGIONS.includes(region) ? region : REGIONS[0] };
    return Object.fromEntries(tables.products.map(p => [p.id, capacityFor(tables, p.id, options, items)]));
}

/* ---------- Changing (each one runs alone, see lock.js) ---------- */

// Returns { added, capped, product }; `capped` is true when stock limited the amount.
function addItem(store, owner, { productId, qty = 1, options = {}, months = 1 }) {
    return exclusive(async () => {
        duration(months);
        qty = Math.floor(Number(qty));
        if (!(qty >= 1)) throw bad("Choose a quantity of at least 1.");
        const tables = await loadTables(store);
        const raw = tables.products.find(p => p.id === productId);
        if (!raw) throw notFound("That product no longer exists.");
        options = normalizeOptions(raw, options);

        const items = await readItems(store, owner);
        const room = capacityFor(tables, productId, options, items);
        if (room <= 0) {
            if (raw.category === "vms") throw conflict(`${raw.name} has no remaining capacity in ${options["Data center"]} for this cart.`);
            throw conflict(raw.stock === 0
                ? `${raw.name} is sold out.`
                : `You already have all ${raw.stock} available ${raw.name} in your cart.`);
        }
        const added = Math.min(qty, room);
        const key = lineKey(productId, options, months);
        const line = items.find(i => i.key === key);
        if (line) line.qty += added;
        else items.push({ key, productId, qty: added, options, months });
        await writeItems(store, owner, items);
        const product = availableProducts(tables).find(p => p.id === productId);
        return { added, capped: added < qty, product };
    });
}

// Set a line's quantity (0 removes it). Returns the quantity kept.
function setQty(store, owner, key, qty) {
    return exclusive(async () => {
        qty = Math.max(0, Math.floor(Number(qty)) || 0);
        const items = await readItems(store, owner);
        const line = items.find(i => i.key === key);
        if (!line) return 0;
        const tables = await loadTables(store);
        const exists = tables.products.some(p => p.id === line.productId);
        const kept = exists ? Math.min(qty, capacityFor(tables, line.productId, line.options, items.filter(i => i !== line))) : 0;
        if (kept === 0) {
            await writeItems(store, owner, items.filter(i => i !== line));
            return 0;
        }
        line.qty = kept;
        await writeItems(store, owner, items);
        return kept;
    });
}

// Changing the term merges lines with the same product and choices.
function setDuration(store, owner, key, months) {
    return exclusive(async () => {
        duration(months);
        const items = await readItems(store, owner);
        const line = items.find(i => i.key === key);
        if (!line) return;
        const nextKey = lineKey(line.productId, line.options, months);
        if (nextKey === key) return;
        const other = items.find(i => i.key === nextKey);
        if (other) {
            other.qty += line.qty;
            await writeItems(store, owner, items.filter(i => i !== line));
        } else {
            line.key = nextKey;
            line.months = months;
            await writeItems(store, owner, items);
        }
    });
}

function removeItem(store, owner, key) {
    return exclusive(async () => {
        await writeItems(store, owner, (await readItems(store, owner)).filter(i => i.key !== key));
    });
}

function clearCart(store, owner) {
    return exclusive(() => writeItems(store, owner, []));
}

// After signing in, move what the visitor added into the user's cart. The
// same capacity rule as addItem applies: the merged cart can't hold more
// than exists.
function mergeGuestCart(store, guestOwner, userId) {
    return exclusive(async () => {
        const guestItems = await readItems(store, guestOwner);
        if (!guestItems.length) return;
        const tables = await loadTables(store);
        const items = await readItems(store, userId);
        for (const g of guestItems) {
            if (!tables.products.some(p => p.id === g.productId)) continue;
            const add = Math.min(g.qty, capacityFor(tables, g.productId, g.options, items));
            if (add <= 0) continue;
            const line = items.find(i => i.key === g.key);
            if (line) line.qty += add; else items.push({ ...g, qty: add });
        }
        await writeItems(store, userId, items);
        await store.cols.carts.deleteOne({ _id: guestOwner });
    });
}

module.exports = { getCart, availability, addItem, setQty, setDuration, removeItem, clearCart, mergeGuestCart, normalizeOptions, duration };
