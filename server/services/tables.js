/* ==========================================================================
   services/tables.js — loading the data the capacity rules need, and
   settling everything whose time has run out
   ========================================================================== */

// Subscriptions whose end date has passed become "expired" and give their
// units back to the stock of VPN/add-on plans (VM capacity needs no giving
// back: it is derived from the ACTIVE subscriptions). Trials are marked
// "released". Runs before every capacity calculation and once a minute.
async function settleExpired(store) {
    const now = new Date().toISOString();       // ISO strings sort like dates
    const due = await store.cols.subscriptions.find({ status: "active", endsAt: { $lte: now } }).toArray();
    for (const sub of due) {
        // The condition on `status` makes sure only ONE caller settles it.
        const result = await store.cols.subscriptions.updateOne({ _id: sub._id, status: "active" }, { $set: { status: "expired" } });
        if (result.modifiedCount === 1) await giveBackStock(store, sub);
    }
    await store.cols.trials.updateMany({ released: { $ne: true }, endsAt: { $lte: now } }, { $set: { released: true } });
}

// Returns the units of a subscription to the stock of a non-VM product.
async function giveBackStock(store, sub) {
    const product = await store.cols.products.findOne({ _id: sub.productId });
    if (product && product.category !== "vms") {
        await store.cols.products.updateOne({ _id: product._id }, { $inc: { stock: sub.qty } });
    }
}

// Everything the capacity functions need, with expired items already settled.
async function loadTables(store) {
    await settleExpired(store);
    const [products, servers, subscriptions, trials] = await Promise.all([
        store.list("products"),
        store.list("servers"),
        store.list("subscriptions", { status: "active" }),
        store.list("trials", { released: { $ne: true } }),
    ]);
    return { products, servers, subscriptions, trials };
}

module.exports = { settleExpired, giveBackStock, loadTables };
