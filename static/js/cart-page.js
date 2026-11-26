/* ==========================================================================
   cart-page.js — cart.html: list, change quantities, pay
   ========================================================================== */

(async () => {
    const $ = id => document.getElementById(id);
    const tbody = $("cart-lines");
    const form = $("pay-form");
    const payError = $("pay-error");
    let canPay = false;          // set once we know who is signed in

    async function render() {
        const { lines, total, count } = await Cart.get();
        $("cart-empty").hidden = lines.length > 0;
        $("cart-filled").hidden = lines.length === 0;
        $("cart-count-text").textContent = count === 1 ? "1 item" : `${count} items`;
        $("cart-subtotal").textContent = DB.formatPrice(total);
        $("cart-total").textContent = DB.formatPrice(total);
        $("due-today").textContent = DB.formatPrice(total);
        $("pay-button").disabled = lines.length === 0 || !canPay;

        tbody.innerHTML = lines.map((line, i) => {
            const p = line.product;
            const options = Object.entries(line.options || {}).map(([k, v]) => `${UI.esc(k)}: ${UI.esc(v)}`).join(" · ");
            return `
            <tr data-key="${UI.esc(line.key)}">
                <td>${UI.esc(p.image ? "" : p.icon)} ${UI.esc(p.name)}${options ? `<br><span class="hint">${options}</span>` : ""}
                    <label class="hint" for="term-${i}">Subscription term</label>
                    <select id="term-${i}" class="line-term">
                        ${DB.DURATIONS.map(m => `<option value="${m}"${m === (line.months ?? 1) ? " selected" : ""}>${m === 12 ? "1 year" : m + (m === 1 ? " month" : " months")}</option>`).join("")}
                    </select></td>
                <td>
                    <label class="visually-hidden" for="qty-${i}">${UI.esc(p.name)} quantity</label>
                    <input id="qty-${i}" class="line-qty" type="number" min="1" max="${Math.max(1, p.capacityByRegion?.[line.options?.["Data center"]] ?? p.stock)}" value="${line.qty}">
                </td>
                <td class="num">${DB.formatPrice(p.price)}<span class="hint">${UI.esc(p.unit)}</span></td>
                <td class="num">${DB.formatPrice(p.price * line.qty * (line.months ?? 1))}</td>
                <td><button class="btn small secondary remove-line" type="button" aria-label="Remove ${UI.esc(p.name)}">Remove</button></td>
            </tr>`;
        }).join("");
    }

    tbody.addEventListener("change", async (e) => {
        if (e.target.classList.contains("line-term")) {
            const key = e.target.closest("tr").dataset.key;
            e.target.disabled = true;
            $("pay-button").disabled = true;
            try { await Cart.setDuration(key, Number(e.target.value)); }
            catch (err) { UI.toast(err.message, "error"); }
            return render();
        }
        if (!e.target.classList.contains("line-qty")) return;
        const key = e.target.closest("tr").dataset.key;
        const wanted = Number(e.target.value);
        // An empty or invalid box puts the old quantity back instead of removing the line.
        if (e.target.value.trim() === "" || !Number.isFinite(wanted) || wanted < 0) return render();
        const vm = (await Cart.get()).lines.find(l => l.key === key)?.product.category === "vms";
        const kept = await Cart.setQty(key, wanted);
        if (kept > 0 && kept < wanted) UI.toast(vm ? `Only ${kept} available within capacity.` : `Only ${kept} available in stock.`, "error");
        if (kept === 0 && wanted > 0) UI.toast(vm ? "That product has no remaining capacity, so it was removed from your cart." : "That product is sold out, so it was removed from your cart.", "error");
        await render();
    });

    tbody.addEventListener("click", async (e) => {
        const button = e.target.closest(".remove-line");
        if (!button) return;
        await Cart.remove(button.closest("tr").dataset.key);
        UI.toast("Removed from your cart.");
        await render();
        $("cart-title").focus?.();
    });

    $("empty-cart").addEventListener("click", async () => {
        if (!confirm("Remove everything from your cart?")) return;
        await Cart.clear();
        await render();
    });

    // Small conveniences while typing card details.
    $("card-name").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });
    $("card-number").addEventListener("input", e => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 19);
        e.target.value = digits.replace(/(.{4})(?=.)/g, "$1 ");
    });
    $("card-expiration").addEventListener("input", e => {
        const d = e.target.value.replace(/\D/g, "").slice(0, 4);
        e.target.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        payError.hidden = true;
        const button = $("pay-button");
        button.disabled = true;
        button.textContent = "Processing…";
        try {
            const order = await Cart.checkout(Object.fromEntries(new FormData(form)));
            form.reset();
            $("cart-area").hidden = true;
            $("done-summary").textContent =
                `Order ${order.id}: ${order.items.length} item${order.items.length > 1 ? "s" : ""}, ` +
                `${DB.formatPrice(order.total)} charged to the card ending in ${order.cardLast4}.`;
            $("order-done").hidden = false;
            $("order-done").focus();
        } catch (err) {
            UI.showError(payError, err.message);
        } finally {
            button.disabled = false;
            button.textContent = "Pay and activate";
        }
    });

    // Who can pay? Visitors are asked to sign in, admins can't order.
    const user = await Auth.currentUser();
    canPay = user?.role === "customer";
    $("pay-signin").hidden = !!user;
    $("pay-admin").hidden = user?.role !== "admin";
    form.hidden = !canPay;

    document.addEventListener("cart:change", render);
    await render();
})();
