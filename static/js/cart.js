/* ==========================================================================
   cart.js — shopping cart and checkout, as seen from the browser
   --------------------------------------------------------------------------
   The cart lives on the server (a document per customer, or per visitor
   until they sign in). The rules from the assignment are enforced THERE:
     - you can't put more in the cart than there is in stock or capacity;
     - paying subtracts the quantity from stock and adds it to "sold";
     - the cart is only emptied by paying or by the customer.
   This file calls the cart endpoints, refreshes the number on the header's
   cart icon and announces every change with a "cart:change" event so the
   open screen can redraw itself.
       Cart.get()                       GET    /api/cart
       Cart.add(productId, qty, ...)    POST   /api/cart/items
       Cart.setQty / setDuration        PATCH  /api/cart/items/:key
       Cart.remove / clear              DELETE /api/cart/items/:key | /api/cart
       Cart.checkout(card)              POST   /api/orders
       Cart.subscriptionsFor / cancelSubscription   /api/subscriptions
   ========================================================================== */

const Cart = (() => {
    const itemUrl = key => `/api/cart/items/${encodeURIComponent(key)}`;

    // Header badge + event, after every change.
    function announce() {
        renderBadge();
        document.dispatchEvent(new CustomEvent("cart:change"));
    }

    /* ---------- Reading ---------- */

    // { lines: [{ key, productId, qty, options, months, product }], total, monthlyTotal, count }
    const get = () => DB.request("GET", "/api/cart");

    /* ---------- Changing ---------- */

    // Returns { added, capped, product }; `capped` is true when stock limited the amount.
    async function add(productId, qty = 1, options = {}, months = 1) {
        const result = await DB.request("POST", "/api/cart/items", { productId, qty, options, months });
        announce();
        return result;
    }

    // Set a line's quantity (0 removes it). Returns the quantity kept.
    async function setQty(key, qty) {
        const { kept } = await DB.request("PATCH", itemUrl(key), { qty });
        announce();
        return kept;
    }

    async function setDuration(key, months) {
        await DB.request("PATCH", itemUrl(key), { months });
        announce();
    }

    async function remove(key) {
        await DB.request("DELETE", itemUrl(key));
        announce();
    }

    async function clear() {
        await DB.request("DELETE", "/api/cart");
        announce();
    }

    /* ---------- Checkout and what was bought ---------- */

    // Pays for everything in the cart. card = { name, number, expiry, cvv }. Returns the saved order.
    async function checkout(card) {
        const order = await DB.request("POST", "/api/orders", { card });
        announce();
        return order;
    }

    // The server only returns the signed-in customer's own orders (administrators: all).
    const ordersFor = () => DB.request("GET", "/api/orders");
    const subscriptionsFor = () => DB.request("GET", "/api/subscriptions");

    // Cancelling ends the whole line and refunds the unused prepaid time.
    const cancelSubscription = id => DB.request("PATCH", `/api/subscriptions/${encodeURIComponent(id)}`, { status: "cancelled" });

    /* ---------- Header badge ---------- */
    async function renderBadge() {
        const badge = document.querySelector(".cart-count");
        if (!badge) return;
        let count = 0;
        try { ({ count } = await get()); } catch { /* server unreachable: show 0 */ }
        badge.textContent = count;
        badge.setAttribute("aria-label", count === 1 ? "1 item" : `${count} items`);
        badge.hidden = count === 0;
    }

    // Signing in or out changes whose cart this is.
    document.addEventListener("auth:change", renderBadge);

    return { get, add, setQty, setDuration, remove, clear, checkout, ordersFor, subscriptionsFor, cancelSubscription, renderBadge };
})();
