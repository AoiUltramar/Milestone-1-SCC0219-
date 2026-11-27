/* ==========================================================================
   services/orders.js — paying for the cart
   --------------------------------------------------------------------------
   Checkout is the most delicate operation: it must (1) check that everything
   is still available, (2) take the quantities out of stock and add them to
   "sold", (3) save the order and one subscription per line, (4) empty the
   cart — all or nothing. MongoDB only offers transactions on replica sets,
   so the work is done like this instead:
     - the whole function runs alone (lock.js);
     - each stock change is a conditional atomic update  (stock >= qty);
     - if any step fails, the steps already done are undone.
   ========================================================================== */

const { bad, conflict } = require("../errors");
const { exclusive } = require("../lock");
const { infrastructureState, allocate } = require("../capacity");
const { loadTables } = require("./tables");
const { normalizeOptions, duration } = require("./cart");
const { newId, money, subscriptionEnd } = require("../util");

// Returns the last 4 digits. Any card number is accepted (assignment rule),
// but the form fields must look right.
function validateCard({ name, number, expiry, cvv } = {}) {
    if (!String(name ?? "").trim()) throw bad("Enter the name printed on the card.");
    const digits = String(number ?? "").replace(/\D/g, "");
    if (digits.length < 12 || digits.length > 19) throw bad("The card number must have between 12 and 19 digits.");
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(String(expiry ?? "").trim());
    if (!m) throw bad("Write the expiration date as MM/YY.");
    const lastDay = new Date(2000 + Number(m[2]), Number(m[1]), 0, 23, 59);
    if (lastDay < new Date()) throw bad("This card has expired.");
    if (!/^\d{3,4}$/.test(String(cvv ?? "").trim())) throw bad("The CVV has 3 or 4 digits.");
    return digits.slice(-4);
}

async function checkout(store, user, card) {
    const last4 = validateCard(card);        // before queueing: bad input is rejected at once
    return exclusive(async () => {
        const tables = await loadTables(store);
        const cart = await store.cols.carts.findOne({ _id: user.id });
        // Skip lines whose product an admin deleted: the cart doesn't show them.
        const items = (cart?.items ?? []).filter(i => tables.products.some(p => p.id === i.productId));
        if (!items.length) throw bad("Your cart is empty.");

        // 1) Check every line first, so nothing changes if one fails.
        const totals = {};
        items.forEach(i => { totals[i.productId] = (totals[i.productId] || 0) + i.qty; });
        for (const [id, qty] of Object.entries(totals)) {
            const p = tables.products.find(x => x.id === id);
            if (p.category !== "vms" && p.stock < qty) throw conflict(`Only ${p.stock} ${p.name} left in stock. Lower the quantity and try again.`);
        }
        // VMs: reserve room on the physical servers, line after line.
        const hosts = infrastructureState(tables);
        const lines = items.map(i => {
            const p = tables.products.find(x => x.id === i.productId);
            const options = normalizeOptions(p, i.options);
            return { productId: p.id, name: p.name, price: p.price, unit: p.unit, qty: i.qty, options,
                     months: duration(i.months ?? 1), monthlyCost: p.monthlyCost ?? null,
                     ...(p.category === "vms" ? { allocations: allocate(hosts, p, options["Data center"], i.qty) } : {}) };
        });

        const order = {
            id: "o-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
            userId: user.id,
            date: new Date().toISOString(),
            items: lines,
            total: money(lines.reduce((s, l) => s + l.price * l.qty * l.months, 0)),
            cardLast4: last4,                 // never store the full card number
        };
        const subscriptions = lines.map(l => ({
            ...l, id: newId("sub"), userId: user.id, orderId: order.id,
            startsAt: order.date, endsAt: subscriptionEnd(order.date, l.months),
            status: "active", paid: money(l.price * l.qty * l.months), refund: 0,
        }));

        // 2) Apply. Stock first (conditional), then the records; undo on failure.
        const applied = [];
        try {
            for (const [id, qty] of Object.entries(totals)) {
                const vm = tables.products.find(x => x.id === id).category === "vms";
                const result = await store.cols.products.updateOne(
                    vm ? { _id: id } : { _id: id, stock: { $gte: qty } },
                    vm ? { $inc: { sold: qty } } : { $inc: { stock: -qty, sold: qty } });
                if (result.modifiedCount !== 1) throw conflict("Stock changed while paying. Review your cart and try again.");
                applied.push({ id, qty, vm });
            }
            await store.insert("orders", order);
            await store.cols.subscriptions.insertMany(subscriptions.map(({ id, ...rest }) => ({ _id: id, ...rest })));
            await store.cols.carts.updateOne({ _id: user.id }, { $set: { items: [] } });      // paying empties the cart
        } catch (err) {
            for (const a of applied) {
                await store.cols.products.updateOne({ _id: a.id }, { $inc: a.vm ? { sold: -a.qty } : { stock: a.qty, sold: -a.qty } });
            }
            await store.cols.orders.deleteOne({ _id: order.id });
            await store.cols.subscriptions.deleteMany({ orderId: order.id });
            throw err;
        }
        return order;
    });
}

module.exports = { checkout, validateCard };
