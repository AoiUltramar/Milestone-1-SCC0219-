/* ==========================================================================
   services/products.js — the catalog and the administrator's CRUD
   --------------------------------------------------------------------------
   VM plans have no stock of their own (capacity.js derives it from the
   physical servers), so an administrator cannot type a stock for them.
   ========================================================================== */

const { CATEGORIES } = require("../../shared/config");
const { bad, notFound, conflict } = require("../errors");
const { exclusive } = require("../lock");
const { requirements, availableProducts } = require("../capacity");
const { loadTables } = require("./tables");
const { text } = require("../util");

// The catalog as customers see it (VM stock derived, capacityByRegion added).
async function listProducts(store, { category, q } = {}) {
    let products = availableProducts(await loadTables(store));
    if (category) products = products.filter(p => p.category === category);
    if (q) {
        const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
        products = products.filter(p => words.every(w => (p.name + " " + p.description).toLowerCase().includes(w)));
    }
    return products;
}

async function getProduct(store, id) {
    const product = (await listProducts(store)).find(p => p.id === id);
    if (!product) throw notFound("Item not found.");
    return product;
}

const isCount = n => Number.isInteger(n) && n >= 0;

// Checks the fields that are present; `full` also requires the mandatory ones.
function validateFields(data, { full }) {
    const has = key => data[key] !== undefined;
    if (full || has("name")) if (!text(data.name)) throw bad("Give the product a name.");
    if (full || has("category")) if (!CATEGORIES[data.category]) throw bad("Choose a valid category.");
    if (full || has("price")) if (typeof data.price !== "number" || !(data.price >= 0)) throw bad("Enter a price of zero or more.");
    if (has("stock")) if (!isCount(data.stock)) throw bad("Stock must be a whole number of zero or more.");
    if (has("sold")) if (!isCount(data.sold)) throw bad("Quantity sold must be a whole number of zero or more.");
    if (full || has("description")) if (!text(data.description)) throw bad("Write a short description.");
    if (has("monthlyCost") && data.monthlyCost !== null) {
        if (typeof data.monthlyCost !== "number" || !(data.monthlyCost >= 0)) throw bad("Enter a monthly cost of zero or more.");
    }
    if (has("specs")) {
        const ok = Array.isArray(data.specs) && data.specs.every(s => Array.isArray(s) && s.length === 2 && s.every(x => typeof x === "string" && x.trim()));
        if (!ok) throw bad("Each spec needs a label and a value, like CPU: 2 vCPU.");
    }
    if (has("image") && data.image !== null && typeof data.image !== "string") throw bad("The photo is not valid.");
}

// The fields an administrator may set (never `id`).
const EDITABLE = ["category", "name", "icon", "image", "price", "unit", "stock", "sold", "description", "specs", "trial", "monthlyCost"];
const pick = data => Object.fromEntries(EDITABLE.filter(k => data[k] !== undefined).map(k => [k, data[k]]));

const slug = value => String(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function createProduct(store, data) {
    return exclusive(async () => {
        validateFields(data, { full: true });
        const id = slug(text(data.id) || data.name);
        if (!/^[a-z0-9-]+$/.test(id)) throw bad("The ID can only use lowercase letters, numbers and dashes.");
        const product = {
            icon: "📦", unit: "", sold: 0, specs: [], trial: false, monthlyCost: null, image: null,
            ...pick(data), id,
        };
        if (product.category === "vms") {
            requirements(product);          // the specs must say how much CPU/RAM/disk a VM needs
            product.stock = 0;              // capacity comes from the servers
        } else if (!isCount(product.stock)) {
            throw bad("Stock must be a whole number of zero or more.");
        }
        await store.insert("products", product);
        return getProduct(store, id);
    });
}

// Partial update (PATCH) — only the fields sent are changed.
function updateProduct(store, id, changes) {
    return exclusive(async () => {
        const old = await store.get("products", id);
        if (!old) throw notFound("Item not found.");
        const fields = pick(changes);
        validateFields(fields, { full: false });
        const next = { ...old, ...fields };

        if (old.category !== next.category) {
            // Changing the category would change the resource model of services already sold.
            const tables = await loadTables(store);
            if (tables.subscriptions.some(s => s.productId === id) || tables.trials.some(t => t.productId === id)) {
                throw conflict("This product has active services and its category cannot be changed.");
            }
            if (next.category === "vms") { requirements(next); fields.stock = 0; }
            else if (!isCount(next.stock)) throw bad("Stock must be a whole number of zero or more.");
        } else if (next.category === "vms") {
            requirements(next);
            if (fields.stock !== undefined) throw bad("VM capacity is derived from physical servers. Manage infrastructure on the dashboard.");
        }
        await store.update("products", id, fields);
        return getProduct(store, id);
    });
}

function deleteProduct(store, id) {
    return exclusive(async () => {
        if (!await store.get("products", id)) throw notFound("Item not found.");
        const tables = await loadTables(store);
        if (tables.subscriptions.some(s => s.productId === id) || tables.trials.some(t => t.productId === id)) {
            throw conflict("This product has active services and cannot be deleted.");
        }
        await store.remove("products", id);
    });
}

module.exports = { listProducts, getProduct, createProduct, updateProduct, deleteProduct };
