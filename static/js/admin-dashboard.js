/* ==========================================================================
   admin-dashboard.js — the dashboard screen (/admin/dashboard): sales, subscriptions and infrastructure
   ========================================================================== */

Views.adminDashboard = async ({ signal }) => {
    const admin = await Auth.requireRole("admin");
    if (!admin) return;

    const $ = id => document.getElementById(id);
    const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
    const metric = (label, value) => `<div class="dashboard-metric"><h3>${UI.esc(label)}</h3><strong>${UI.esc(value)}</strong></div>`;

    async function render() {
        const [products, users, orders, subscriptions, trials, servers] = await Promise.all([
            DB.list("products"), Auth.listUsers("customer"), DB.list("orders"), DB.list("subscriptions"), DB.list("trials"), DB.infrastructure(),
        ]);
        const active = subscriptions.filter(s => s.status === "active");
        const cancelled = subscriptions.filter(s => s.status === "cancelled");
        const gross = sum(orders, o => o.total);
        const refunds = sum(subscriptions, s => s.refund || 0);
        const net = gross - refunds;
        const known = subscriptions.filter(s => s.monthlyCost !== null && s.monthlyCost !== undefined);

        // Costs are fixed at checkout; cancellations reduce the estimated cost in proportion to time used.
        const estimatedCost = sum(known, s => {
            const fraction = s.status === "cancelled"
                ? Math.max(0, Math.min(1, (Date.parse(s.cancelledAt) - Date.parse(s.startsAt)) / (Date.parse(s.endsAt) - Date.parse(s.startsAt)))) : 1;
            return DB.money(s.monthlyCost * s.qty * s.months * fraction);
        });
        const knownNet = sum(known, s => s.paid - s.refund);
        $("financial-metrics").innerHTML = [
            metric("Gross sales", DB.formatPrice(gross)), metric("Refunds", DB.formatPrice(refunds)),
            metric("Net sales", DB.formatPrice(net)), metric("Estimated gross profit (known costs)", known.length ? DB.formatPrice(knownNet - estimatedCost) : "Not available"),
        ].join("");
        $("profit-note").textContent = `Cost coverage: ${DB.formatPrice(knownNet)} of ${DB.formatPrice(net)} net sales. ` +
            "Estimated contract margin, not accounting profit; excludes overhead, taxes and orders without recorded costs.";
        $("activity-metrics").innerHTML = [
            metric("Customers", users.length), metric("Orders", orders.length), metric("Active subscriptions", active.length),
            metric("Active paid units", sum(active, s => s.qty)), metric("Cancelled subscriptions", cancelled.length),
            metric("Expired subscriptions", subscriptions.filter(s => s.status === "expired").length),
            metric("Active free trials", trials.filter(t => !t.released && Date.parse(t.endsAt) > Date.now()).length),
            metric("Physical servers", servers.length),
        ].join("");

        const sales = new Map();
        const row = (id, name) => {
            if (!sales.has(id)) sales.set(id, { name, units: 0, active: 0, net: 0 });
            return sales.get(id);
        };
        orders.forEach(o => o.items.forEach(i => {
            const p = row(i.productId, i.name);
            p.units += i.qty;
            p.net += DB.money(i.price * i.qty * (i.months ?? 1));
        }));
        subscriptions.forEach(s => {
            const p = row(s.productId, s.name);
            p.net -= s.refund || 0;
            if (s.status === "active") p.active += s.qty;
        });
        $("sales-rows").innerHTML = [...sales.values()].sort((a, b) => b.net - a.net).map(p => `
            <tr><td>${UI.esc(p.name)}</td><td class="num">${p.units}</td><td class="num">${p.active}</td><td class="num">${DB.formatPrice(p.net)}</td></tr>`).join("") || `<tr><td colspan="4">No recorded sales yet.</td></tr>`;
        const keys = ["cpu", "ram", "storage", "gpu"];
        const labels = ["vCPU", "RAM", "Storage", "GPU"];
        const totals = (hosts, key) => [sum(hosts, s => s[key] - s.free[key]), sum(hosts, s => s[key])];
        const display = n => Number(n.toFixed(3));
        const cells = hosts => keys.map(k => { const [used, total] = totals(hosts, k); return `<td class="num">${display(used)} / ${display(total)}</td>`; }).join("");
        $("infrastructure-metrics").innerHTML = keys.map((k, i) => {
            const [used, total] = totals(servers, k);
            const percent = total ? Math.round(100 * used / total) : 0;
            return `<div class="dashboard-metric"><h3>${labels[i]} allocated</h3><strong>${total ? percent + "%" : "N/A"}</strong><p class="hint">${display(used)} / ${display(total)}</p><progress max="100" value="${percent}" aria-label="${labels[i]} allocation"></progress></div>`;
        }).join("");
        $("region-rows").innerHTML = DB.CATEGORIES.vms.options["Data center"].map(region => {
            const hosts = servers.filter(s => s.region === region);
            return `<tr><td>${UI.esc(region)}</td><td>${hosts.length}</td>${cells(hosts)}</tr>`;
        }).join("");
        $("server-rows").innerHTML = servers.map(s => `<tr><td>${UI.esc(s.id)}</td><td>${UI.esc(s.region)}</td>${cells([s])}</tr>`).join("");
        const low = products.flatMap(p => p.category === "vms"
            ? Object.entries(p.capacityByRegion).filter(([, n]) => n <= 2).map(([region, n]) => `${p.name} — ${region}: ${n} available`)
            : p.stock <= 10 ? [`${p.name}: ${p.stock} available`] : []);
        const pending = [...active, ...trials.filter(t => !t.released)].filter(s => s.capacityMigrationPending).length;
        if (pending) low.unshift(`${pending} legacy services have unknown VM requirements and are outside the modeled capacity.`);
        $("stock-alerts").innerHTML = low.map(label => `<p class="notice">${UI.esc(label)}</p>`).join("") || `<p>No capacity alerts.</p>`;
    }

    $("server-form").addEventListener("submit", async e => {
        e.preventDefault();
        const form = e.currentTarget;
        const error = $("server-error");
        const button = form.querySelector('button[type="submit"]');
        error.hidden = true;
        button.disabled = true;
        try {
            const f = form.elements;
            await DB.addServer({ region: f.region.value, cpu: Number(f.cpu.value), ram: Number(f.ram.value), storage: Number(f.storage.value), gpu: Number(f.gpu.value) });
            UI.toast("Physical server added.");
            await render();
        } catch (err) {
            UI.showError(error, err.message);
        } finally {
            button.disabled = false;
        }
    });
    $("refresh-dashboard").addEventListener("click", render);
    await render();
};
