/* ==========================================================================
   cart.js — shopping cart and checkout
   --------------------------------------------------------------------------
   Each cart is a record in the "carts" collection:
       { id: <user id or "guest">, items: [{ key, productId, qty, options }] }
   `options` holds choices like { region: "São Paulo", os: "Ubuntu" } for VMs;
   the same product with different options is a separate line.

   Rules from the assignment:
   - you can't put more in the cart than there is in stock;
   - paying subtracts the quantity from stock and adds it to "sold";
   - the cart is only emptied by paying or by the customer.

   Needs db.js and auth.js loaded first.
   ========================================================================== */

const Cart = (() => {
    const GUEST = "guest";

    async function ownerId() {
        const user = await Auth.currentUser();
        return user ? user.id : GUEST;
    }

    async function readItems(owner) {
        return (await DB.get("carts", owner))?.items ?? [];
    }

    async function writeItems(owner, items) {
        if (await DB.get("carts", owner)) await DB.update("carts", owner, { items });
        else await DB.insert("carts", { id: owner, items });
        renderBadge();
        document.dispatchEvent(new CustomEvent("cart:change"));
    }

    const lineKey = (productId, options = {}) =>
        productId + "|" + Object.entries(options).sort().map(([k, v]) => k + "=" + v).join("&");

    /* ---------- Reading ---------- */

    // Cart lines joined with their product, plus totals.
    async function get() {
        const owner = await ownerId();
        const [items, products] = await Promise.all([readItems(owner), DB.list("products")]);
        const lines = items
            .map(item => ({ ...item, product: products.find(p => p.id === item.productId) }))
            .filter(line => line.product);       // product deleted by an admin
        const total = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);
        const count = lines.reduce((sum, l) => sum + l.qty, 0);
        return { owner, lines, total, count };
    }

    // How many of this product are already in the cart (all option variants).
    const qtyInCart = (items, productId) =>
        items.filter(i => i.productId === productId).reduce((s, i) => s + i.qty, 0);

    /* ---------- Changing ---------- */

    // Cart changes read the cart, wait for the "server", then write it back.
    // Two changes running at the same time (an AI agent often calls tools in
    // parallel) would overwrite each other, so they wait in a queue.
    let queue = Promise.resolve();
    const serial = fn => (...args) => {
        const run = queue.then(() => fn(...args));
        queue = run.catch(() => {});
        return run;
    };

    // The choices a product carries (data center, OS, exit country...).
    // Missing choices get the default (first value); choices that don't
    // belong to the product's category are dropped.
    function normalizeOptions(product, options = {}) {
        const spec = DB.CATEGORIES[product.category]?.options ?? {};
        const out = {};
        for (const [name, choices] of Object.entries(spec)) {
            const value = options?.[name];
            if (value === undefined || value === null || value === "") out[name] = choices[0];
            else if (choices.includes(value)) out[name] = value;
            else throw new Error(`${name} must be one of: ${choices.join(", ")}.`);
        }
        return out;
    }

    // Returns { added, capped }; `capped` is true when stock limited the amount.
    async function add(productId, qty = 1, options = {}) {
        qty = Math.floor(Number(qty));
        if (!(qty >= 1)) throw new Error("Choose a quantity of at least 1.");
        const product = await DB.get("products", productId);
        if (!product) throw new Error("That product no longer exists.");
        options = normalizeOptions(product, options);

        const owner = await ownerId();
        const items = await readItems(owner);
        const room = product.stock - qtyInCart(items, productId);
        if (room <= 0) {
            throw new Error(product.stock === 0
                ? `${product.name} is sold out.`
                : `You already have all ${product.stock} available ${product.name} in your cart.`);
        }
        const added = Math.min(qty, room);
        const key = lineKey(productId, options);
        const line = items.find(i => i.key === key);
        if (line) line.qty += added;
        else items.push({ key, productId, qty: added, options });
        await writeItems(owner, items);
        return { added, capped: added < qty, product };
    }

    // Set a line's quantity (0 removes it). Returns the quantity kept.
    async function setQty(key, qty) {
        qty = Math.max(0, Math.floor(Number(qty)) || 0);
        const owner = await ownerId();
        const items = await readItems(owner);
        const line = items.find(i => i.key === key);
        if (!line) return 0;
        const product = await DB.get("products", line.productId);
        const others = qtyInCart(items, line.productId) - line.qty;
        // Never more than the stock left after the other variants of this product.
        const kept = product ? Math.min(qty, Math.max(0, product.stock - others)) : 0;
        if (kept === 0) return remove(key).then(() => 0);
        line.qty = kept;
        await writeItems(owner, items);
        return line.qty;
    }

    async function remove(key) {
        const owner = await ownerId();
        await writeItems(owner, (await readItems(owner)).filter(i => i.key !== key));
    }

    async function clear() {
        await writeItems(await ownerId(), []);
    }

    // After signing in, move anything added as a visitor into the user's cart.
    async function mergeGuestInto(userId) {
        const guestItems = await readItems(GUEST);
        if (!guestItems.length) return;
        const [items, products] = await Promise.all([readItems(userId), DB.list("products")]);
        for (const g of guestItems) {
            // Same stock rule as add(): the merged cart can't hold more than exists.
            const product = products.find(p => p.id === g.productId);
            if (!product) continue;
            const add = Math.min(g.qty, product.stock - qtyInCart(items, g.productId));
            if (add <= 0) continue;
            const line = items.find(i => i.key === g.key);
            if (line) line.qty += add; else items.push({ ...g, qty: add });
        }
        await writeItems(userId, items);
        await writeItems(GUEST, []);
    }

    /* ---------- Checkout ---------- */

    function validateCard({ name, number, expiry, cvv }) {
        if (!name?.trim()) throw new Error("Enter the name printed on the card.");
        const digits = (number || "").replace(/\D/g, "");
        if (digits.length < 12 || digits.length > 19) throw new Error("The card number must have between 12 and 19 digits.");
        const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec((expiry || "").trim());
        if (!m) throw new Error("Write the expiration date as MM/YY.");
        const lastDay = new Date(2000 + Number(m[2]), Number(m[1]), 0, 23, 59);
        if (lastDay < new Date()) throw new Error("This card has expired.");
        if (!/^\d{3,4}$/.test((cvv || "").trim())) throw new Error("The CVV has 3 or 4 digits.");
        return digits.slice(-4);
    }

    // Pays for everything in the cart. Returns the saved order.
    async function checkout(card) {
        const user = await Auth.currentUser();
        if (!user) throw new Error("Please sign in to pay.");
        if (user.role !== "customer") throw new Error("Administrator accounts can't place orders. Sign in as a customer.");
        const last4 = validateCard(card);

        const order = await DB.transaction(({ products, carts, orders }) => {
            const cart = carts.find(c => c.id === user.id);
            // Skip lines whose product an admin deleted: the cart page doesn't
            // show them, so the customer couldn't remove them.
            const items = (cart?.items ?? []).filter(i => products.some(p => p.id === i.productId));
            if (!items.length) throw new Error("Your cart is empty.");

            // Check every line first, so nothing changes if one fails.
            const totals = {};
            items.forEach(i => { totals[i.productId] = (totals[i.productId] || 0) + i.qty; });
            for (const [id, qty] of Object.entries(totals)) {
                const p = products.find(x => x.id === id);
                if (!p) throw new Error("A product in your cart no longer exists. Remove it and try again.");
                if (p.stock < qty) throw new Error(`Only ${p.stock} ${p.name} left in stock. Lower the quantity and try again.`);
            }
            for (const [id, qty] of Object.entries(totals)) {
                const p = products.find(x => x.id === id);
                p.stock -= qty;
                p.sold += qty;
            }

            const lines = items.map(i => {
                const p = products.find(x => x.id === i.productId);
                return { productId: p.id, name: p.name, price: p.price, unit: p.unit, qty: i.qty, options: i.options };
            });
            const newOrder = {
                id: "o-" + Date.now().toString(36).toUpperCase(),
                userId: user.id,
                date: new Date().toISOString(),
                items: lines,
                total: lines.reduce((s, l) => s + l.price * l.qty, 0),
                cardLast4: last4,          // never store the full card number
            };
            orders.push(newOrder);
            cart.items = [];               // paying empties the cart
            return newOrder;
        });
        renderBadge();
        document.dispatchEvent(new CustomEvent("cart:change"));
        return order;
    }

    async function ordersFor(userId) {
        return (await DB.list("orders")).filter(o => o.userId === userId).sort((a, b) => b.date.localeCompare(a.date));
    }

    /* ---------- Header badge ---------- */
    async function renderBadge() {
        const badge = document.querySelector(".cart-count");
        if (!badge) return;
        const { count } = await get();
        badge.textContent = count;
        badge.setAttribute("aria-label", count === 1 ? "1 item" : `${count} items`);
        badge.hidden = count === 0;
    }
    renderBadge();

    // Public versions go through the queue; setQty uses the plain remove()
    // inside, so it never waits on itself.
    return { get, add: serial(add), setQty: serial(setQty), remove: serial(remove), clear: serial(clear),
             mergeGuestInto: serial(mergeGuestInto), checkout: serial(checkout), ordersFor, renderBadge };
})();
