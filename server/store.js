/* ==========================================================================
   store.js — the MongoDB connection and a small repository layer
   --------------------------------------------------------------------------
   Collections (MongoDB's version of tables):
       products, users, sessions, carts, orders, trials, subscriptions,
       servers (physical hosts), meta (bookkeeping such as "already seeded")

   Every document uses a readable string as its MongoDB `_id` ("standard-vm",
   "u-admin", "user-<uuid>"). The rest of the code talks about `id`, so the
   repository converts between the two:  { _id: "x", a: 1 }  <->  { id: "x", a: 1 }.
   ========================================================================== */

const { MongoClient } = require("mongodb");
const config = require("./config");
const { hashPassword } = require("./passwords");
const { SEED_PRODUCTS, SEED_SERVERS } = require("./seed-data");
const { conflict } = require("./errors");

const COLLECTIONS = ["products", "users", "sessions", "carts", "orders", "trials", "subscriptions", "servers", "meta"];

// Product specs are [label, value] pairs in the API ("CPU", "2 vCPU"). They
// are saved as { label, value } objects: documents with arrays INSIDE arrays
// are awkward to query and some MongoDB-compatible servers refuse them.
const specsToDoc = specs => specs.map(([label, value]) => ({ label, value }));
const specsToApi = specs => specs.map(({ label, value }) => [label, value]);

// Document <-> API object (the id field is named differently, and specs are reshaped).
const toApi = doc => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    if (Array.isArray(rest.specs)) rest.specs = specsToApi(rest.specs);
    return { id: _id, ...rest };
};
// The fields of an item without its id (used for updates: the id never changes).
const fieldsToDoc = ({ id, ...rest }) => {
    if (Array.isArray(rest.specs)) rest.specs = specsToDoc(rest.specs);
    return rest;
};
const toDoc = item => ({ _id: item.id, ...fieldsToDoc(item) });

async function connect({ url = config.MONGO_URL, name = config.DB_NAME } = {}) {
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db(name);
    const cols = Object.fromEntries(COLLECTIONS.map(n => [n, db.collection(n)]));

    const store = {
        client, db, cols,
        close: () => client.close(),

        // ---- repository helpers: always return objects with `id` ----
        async list(name, filter = {}) {
            return (await cols[name].find(filter).toArray()).map(toApi);
        },
        async get(name, id) {
            return toApi(await cols[name].findOne({ _id: id }));
        },
        async insert(name, item) {
            try {
                await cols[name].insertOne(toDoc(item));
            } catch (err) {
                if (err.code === 11000) throw conflict(`An item with id "${item.id}" already exists.`);
                throw err;
            }
            return item;
        },
        // Merge `fields` into the document; returns the updated object or null.
        async update(name, id, fields) {
            const result = await cols[name].findOneAndUpdate({ _id: id }, { $set: fieldsToDoc(fields) }, { returnDocument: "after" });
            return toApi(result);
        },
        async remove(name, id) {
            return (await cols[name].deleteOne({ _id: id })).deletedCount === 1;
        },
    };

    await createIndexes(store);
    await seed(store);
    return store;
}

// Indexes make the common lookups fast. Failing to create one is not fatal
// (a MongoDB-compatible server may not support every index type).
async function createIndexes(store) {
    const tries = [
        () => store.cols.users.createIndex({ email: 1 }),
        () => store.cols.subscriptions.createIndex({ userId: 1 }),
        () => store.cols.orders.createIndex({ userId: 1 }),
        () => store.cols.trials.createIndex({ userId: 1 }),
        () => store.cols.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),   // old sessions clean themselves
    ];
    for (const create of tries) {
        try { await create(); } catch (err) { console.warn("Index not created:", err.message); }
    }
}

/* ---------- Initial data ---------- */

// Creates the products and servers once, and the admin/admin account if it
// does not exist. Safe to run on every start: it never overwrites anything.
async function seed(store) {
    const done = await store.cols.meta.findOne({ _id: "seeded" });
    if (!done) {
        await store.cols.products.insertMany(SEED_PRODUCTS.map(toDoc));
        await store.cols.servers.insertMany(SEED_SERVERS.map(toDoc));
        await store.cols.meta.insertOne({ _id: "seeded", at: new Date().toISOString() });
    }
    // The assignment requires an account "admin" with the password "admin".
    // It is found by id, because the admin may later rename their username.
    if (!await store.cols.users.findOne({ _id: "u-admin" })) {
        await store.cols.users.insertOne(toDoc({
            id: "u-admin", role: "admin", username: "admin",
            name: "Administrator", email: "admin@cacheandcarry.example", phone: "(11) 2222-1313",
            ...await hashPassword("admin"), createdAt: new Date().toISOString(),
        }));
    }
}

// Empties every collection and seeds again (npm run seed -- --reset, and the tests).
async function reset(store) {
    for (const name of COLLECTIONS) await store.cols[name].deleteMany({});
    await seed(store);
}

module.exports = { connect, seed, reset, toApi, toDoc };
