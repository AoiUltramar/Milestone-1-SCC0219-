/* ==========================================================================
   account.js — the account screen (/account): profile, trial, subscriptions and orders (customers)
   ========================================================================== */

Views.account = async ({ signal }) => {
    const $ = id => document.getElementById(id);
    const form = $("profile-form");
    const errorBox = $("profile-error");
    // Block the browser's own submit until we know who is signed in.
    form.addEventListener("submit", e => e.preventDefault());

    const user = await Auth.requireRole("customer");
    if (!user) return;                        // redirected to login

    function fill(u) {
        $("account-title").textContent = `Hello, ${u.name.split(" ")[0]}!`;
        form.elements.name.value = u.name;
        form.elements.email.value = u.email;
        form.elements.phone.value = u.phone || "";
        form.elements.street.value = u.address?.street || "";
        form.elements.city.value = u.address?.city || "";
        form.elements.cep.value = u.address?.cep || "";
    }
    fill(user);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        const data = Object.fromEntries(new FormData(form));
        try {
            const changes = {
                name: data.name, email: data.email, phone: data.phone,
                address: { street: data.street, city: data.city, cep: data.cep },
            };
            if (data.password) {
                // The server checks the current password before accepting the new one.
                changes.password = data.password;
                changes.currentPassword = data.current;
            }
            const saved = await Auth.updateUser(user.id, changes);
            fill(saved);
            form.elements.current.value = form.elements.password.value = "";
            UI.toast(data.password ? "Details and password saved." : "Details saved.");
        } catch (err) {
            UI.showError(errorBox, err.message);
        }
    });

    /* ---------- Trial ---------- */
    const trial = (await DB.list("trials")).find(t => t.userId === user.id);   // the server returns only this customer's trial
    const box = $("trial-box");
    if (trial) {
        const left = Math.ceil((new Date(trial.endsAt) - new Date()) / 86400000);
        box.innerHTML = `
            <div class="notice">
                <strong>${UI.esc(trial.hostname)}</strong> · Standard VM · ${UI.esc(trial.os)} · ${UI.esc(trial.region)}<br>
                ${left > 0 ? `${left} day${left > 1 ? "s" : ""} left (ends ${UI.formatDate(trial.endsAt)}).`
                           : `Ended on ${UI.formatDate(trial.endsAt)}.`}
                <a href="/vms#standard-vm">Upgrade to a Standard VM</a>
            </div>`;
    } else {
        box.innerHTML = `<p>You haven't used your free trial yet. <a href="/trial">Start a 14-day Standard VM trial</a>.</p>`;
    }

    /* ---------- Subscriptions ---------- */
    const subscriptionsBox = $("subscriptions-box");
    async function renderSubscriptions() {
        const subscriptions = await Cart.subscriptionsFor();
        subscriptionsBox.innerHTML = subscriptions.map(s => `
            <div class="notice subscription-item">
                <strong>${s.qty} × ${UI.esc(s.name)}</strong> · ${s.status === "active" ? "Active" : s.status === "cancelled" ? "Cancelled" : "Expired"}<br>
                <span class="hint">${Object.entries(s.options || {}).map(([k, v]) => `${UI.esc(k)}: ${UI.esc(v)}`).join(" · ")}</span><br>
                ${s.months} month${s.months === 1 ? "" : "s"} · ${UI.formatDate(s.startsAt)} – ${UI.formatDate(s.endsAt)}<br>
                Paid: ${DB.formatPrice(s.paid)}${s.status === "cancelled" ? ` · Refunded: ${DB.formatPrice(s.refund)}<br>Cancelled on ${UI.formatDate(s.cancelledAt)}` : ""}
                ${s.status === "active" ? `<div class="actions"><button class="btn small secondary" type="button" data-cancel-sub="${UI.esc(s.id)}">Cancel subscription</button></div>` : ""}
            </div>`).join("") || `<p>No subscriptions yet. <a href="/">See plans</a>.</p>`;
    }
    subscriptionsBox.addEventListener("click", async e => {
        const button = e.target.closest("[data-cancel-sub]");
        if (!button || !confirm("Cancel all units in this subscription now? Service stops immediately and unused time is refunded (simulated).")) return;
        button.disabled = true;
        try {
            const s = await Cart.cancelSubscription(button.dataset.cancelSub);
            UI.toast(`Subscription cancelled. Refund: ${DB.formatPrice(s.refund)}.`);
        } catch (err) { UI.toast(err.message, "error"); }
        await renderSubscriptions();
    });
    await renderSubscriptions();

    /* ---------- Orders ---------- */
    const orders = await Cart.ordersFor();
    $("orders-empty").hidden = orders.length > 0;
    $("orders-table").hidden = orders.length === 0;
    $("orders-body").innerHTML = orders.map(o => `
        <tr>
            <td>${UI.esc(o.id)}</td>
            <td>${UI.formatDate(o.date)}</td>
            <td>${o.items.map(i => `${i.qty} × ${UI.esc(i.name)}`).join("<br>")}</td>
            <td class="num">${DB.formatPrice(o.total)}</td>
            <td>•••• ${UI.esc(o.cardLast4)}</td>
        </tr>`).join("");
};
