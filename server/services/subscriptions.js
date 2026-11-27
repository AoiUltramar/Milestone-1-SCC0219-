/* ==========================================================================
   services/subscriptions.js — what customers have bought, and cancelling it
   --------------------------------------------------------------------------
   Every order line becomes a subscription (see orders.js) with a start, an
   end, the amount paid and a status: active, cancelled or expired.
   ========================================================================== */

const { notFound, conflict } = require("../errors");
const { exclusive } = require("../lock");
const { loadTables, giveBackStock } = require("./tables");
const { money } = require("../util");

async function listSubscriptions(store, user) {
    await loadTables(store);                                  // settles the ones that ended
    const subs = await store.list("subscriptions", user.role === "admin" ? {} : { userId: user.id });
    return subs.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

// Cancelling ends the whole line now and refunds the unused prepaid time
// (simulated: no money actually moves).
function cancelSubscription(store, user, id) {
    return exclusive(async () => {
        await loadTables(store);
        const sub = await store.get("subscriptions", id);
        if (!sub || sub.userId !== user.id) throw notFound("That subscription does not exist or does not belong to you.");
        if (sub.status !== "active") throw conflict("That subscription is not active.");

        const now = Date.now();
        const remaining = Math.max(0, Math.min(1, (Date.parse(sub.endsAt) - now) / (Date.parse(sub.endsAt) - Date.parse(sub.startsAt))));
        const changes = { status: "cancelled", cancelledAt: new Date(now).toISOString(), refund: money(sub.paid * remaining) };
        // Conditional update: if it was settled meanwhile, nothing changes.
        const result = await store.cols.subscriptions.updateOne({ _id: id, status: "active" }, { $set: changes });
        if (result.modifiedCount !== 1) throw conflict("That subscription is not active.");
        await giveBackStock(store, sub);
        return { ...sub, ...changes };
    });
}

module.exports = { listSubscriptions, cancelSubscription };
