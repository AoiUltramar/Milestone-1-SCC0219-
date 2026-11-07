/* ==========================================================================
   account.js — account.html: profile, trial and order history (customers)
   ========================================================================== */

(async () => {
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
                if (!await Auth.checkPassword(user.id, data.current)) throw new Error("Your current password is incorrect.");
                changes.password = data.password;
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
    const trial = (await DB.list("trials")).find(t => t.userId === user.id);
    const box = $("trial-box");
    if (trial) {
        const left = Math.ceil((new Date(trial.endsAt) - new Date()) / 86400000);
        box.innerHTML = `
            <div class="notice">
                <strong>${UI.esc(trial.hostname)}</strong> · Standard VM · ${UI.esc(trial.os)} · ${UI.esc(trial.region)}<br>
                ${left > 0 ? `${left} day${left > 1 ? "s" : ""} left (ends ${UI.formatDate(trial.endsAt)}).`
                           : `Ended on ${UI.formatDate(trial.endsAt)}.`}
                <a href="vms.html#standard-vm">Upgrade to a Standard VM</a>
            </div>`;
    } else {
        box.innerHTML = `<p>You haven't used your free trial yet. <a href="trial.html">Start a 14-day Standard VM trial</a>.</p>`;
    }

    /* ---------- Orders ---------- */
    const orders = await Cart.ordersFor(user.id);
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
})();
