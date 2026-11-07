/* ==========================================================================
   admin-users.js — admin-users.html: manage customers and administrators
   ========================================================================== */

(async () => {
    const admin = await Auth.requireRole("admin");
    if (!admin) return;

    const $ = id => document.getElementById(id);
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const dialog = $("user-dialog");
    const form = $("user-form");
    const errorBox = $("user-error");
    let role = "customer";       // which tab is open
    let editingId = null;

    const label = r => (r === "admin" ? "administrator" : "customer");

    async function render() {
        const text = $("user-filter").value.trim().toLowerCase();
        const users = (await Auth.listUsers(role))
            .filter(u => (u.name + " " + u.email + " " + (u.username || "")).toLowerCase().includes(text))
            .sort((a, b) => a.name.localeCompare(b.name));

        $("users-caption").textContent = role === "admin" ? "Administrators" : "Customers";
        $("new-user").textContent = `New ${label(role)}`;
        $("users-head").innerHTML = `<tr>
            <th scope="col">Name</th><th scope="col">ID</th><th scope="col">Email</th><th scope="col">Phone</th>
            ${role === "customer" ? `<th scope="col">Address</th>` : `<th scope="col">Username</th>`}
            <th scope="col"><span class="visually-hidden">Actions</span></th></tr>`;

        $("user-rows").innerHTML = users.map(u => `
            <tr data-id="${UI.esc(u.id)}">
                <td><strong>${UI.esc(u.name)}</strong>${u.id === admin.id ? ' <span class="pill">you</span>' : ""}</td>
                <td><span class="hint">${UI.esc(u.id.slice(0, 10))}</span></td>
                <td>${UI.esc(u.email)}</td>
                <td>${UI.esc(u.phone || "—")}</td>
                <td>${role === "customer"
                        ? UI.esc([u.address?.street, u.address?.city, u.address?.cep].filter(Boolean).join(", ") || "—")
                        : UI.esc(u.username || "—")}</td>
                <td><div class="row-actions">
                    <button class="btn small secondary" type="button" data-action="edit" aria-label="Edit ${UI.esc(u.name)}">Edit</button>
                    <button class="btn small secondary" type="button" data-action="delete" aria-label="Delete ${UI.esc(u.name)}"
                        ${u.id === "u-admin" || u.id === admin.id ? "disabled" : ""}>Delete</button>
                </div></td>
            </tr>`).join("") || `<tr><td colspan="6">No ${label(role)}s found.</td></tr>`;

        $("user-summary").textContent = `${users.length} ${label(role)}${users.length === 1 ? "" : "s"}.`;
    }

    /* ---------- Tabs (arrow keys move between them, like native tabs) ---------- */
    function selectTab(tab) {
        tabs.forEach(t => {
            const on = t === tab;
            t.setAttribute("aria-selected", on);
            t.tabIndex = on ? 0 : -1;
        });
        $("users-panel").setAttribute("aria-labelledby", tab.id);
        role = tab.dataset.role;
        render();
    }
    tabs.forEach((tab, i) => {
        tab.addEventListener("click", () => selectTab(tab));
        tab.addEventListener("keydown", e => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            next.focus();
            selectTab(next);
        });
    });

    /* ---------- Edit / delete ---------- */
    $("user-rows").addEventListener("click", async (e) => {
        const button = e.target.closest("[data-action]");
        if (!button) return;
        const id = button.closest("tr").dataset.id;
        const user = (await Auth.listUsers()).find(u => u.id === id);
        if (!user) {                       // deleted in another tab
            UI.toast("That account no longer exists.", "error");
            return render();
        }
        if (button.dataset.action === "edit") return openForm(user);
        if (!confirm(`Delete ${user.name}'s account? Their cart and free trial are removed too.`)) return;
        try {
            await Auth.deleteUser(id);     // also removes their cart and trial
            UI.toast(`${user.name} deleted.`);
            await render();
        } catch (err) {
            UI.toast(err.message, "error");
        }
    });

    function openForm(user = null) {
        editingId = user?.id ?? null;
        form.reset();
        errorBox.hidden = true;
        const r = user?.role ?? role;
        $("user-dialog-title").textContent = user ? `Edit ${user.name}` : `New ${label(r)}`;
        form.querySelectorAll("[data-for]").forEach(el => { el.hidden = el.dataset.for !== r; });
        const f = form.elements;
        f.password.required = !user;
        $("u-password-hint").textContent = user ? "Leave empty to keep the current password." : "At least 8 characters.";
        if (user) {
            f.name.value = user.name; f.email.value = user.email; f.phone.value = user.phone || "";
            f.username.value = user.username || "";
            f.street.value = user.address?.street || ""; f.city.value = user.address?.city || ""; f.cep.value = user.address?.cep || "";
        }
        dialog.showModal();
        f.name.focus();
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        const d = Object.fromEntries(new FormData(form));
        const data = { name: d.name, email: d.email, phone: d.phone };
        if (role === "admin") data.username = d.username || null;
        else data.address = { street: d.street, city: d.city, cep: d.cep };
        try {
            if (editingId) {
                if (d.password) data.password = d.password;
                await Auth.updateUser(editingId, data);
                UI.toast(`${d.name} saved.`);
            } else {
                await Auth.createUser({ ...data, password: d.password }, role);
                UI.toast(`${d.name} created.`);
            }
            dialog.close();
            await render();
        } catch (err) {
            UI.showError(errorBox, err.message);
        }
    });

    $("user-cancel").addEventListener("click", () => dialog.close());
    $("new-user").addEventListener("click", () => openForm());
    $("user-filter").addEventListener("input", render);
    await render();
})();
