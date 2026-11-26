/* ==========================================================================
   trial.js — trial.html: our own feature, a free 14-day Standard VM
   --------------------------------------------------------------------------
   Rules: you must be signed in as a customer, and each account gets one
   trial. Trials are saved in the "trials" collection and shown on the
   account page with the days left.
   ========================================================================== */

(async () => {
    const $ = id => document.getElementById(id);
    const form = $("trial-form");
    const errorBox = $("trial-error");
    const status = $("trial-status");
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    let capacityVersion = 0;
    let starting = false;
    const TRIAL_DAYS = 14;
    let user = null;
    let allowed = false;     // becomes true once we know a customer without a trial is signed in

    // Attach the handler first, so a fast click never submits the form the
    // old-fashioned way (which would just reload the page).
    form.addEventListener("submit", e => { e.preventDefault(); start(); });

    user = await Auth.currentUser();
    const existing = user ? (await DB.list("trials")).find(t => t.userId === user.id) : null;

    // Explain why the form can't be used, if it can't.
    if (!user) {
        status.innerHTML = `You need to be signed in to start a trial. <a href="login.html?next=trial.html">Sign in or create an account</a>.`;
    } else if (user.role !== "customer") {
        status.innerHTML = `Administrator accounts can't start trials. Sign in with a customer account.`;
    } else if (existing) {
        status.innerHTML = `You already used your free trial (<strong>${UI.esc(existing.hostname)}</strong>). <a href="account.html">See it on your account page</a>.`;
    } else {
        status.textContent = `Signed in as ${user.name}. One trial per account.`;
    }
    allowed = user?.role === "customer" && !existing;
    form.querySelectorAll("input, select, textarea, button").forEach(el => { el.disabled = !allowed || el === submitButton; });

    // Suggest a server name from the user's first name.
    if (allowed && !form.elements.hostname.value) {
        form.elements.hostname.value = (user.name.split(" ")[0] + "-trial").toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]/g, "");
    }

    async function refreshCapacity() {
        if (!allowed || starting) return;
        const version = ++capacityVersion;
        submitButton.disabled = true;
        const region = form.elements.region.value;
        const capacity = await DB.capacityFor("standard-vm", { "Data center": region });
        if (version !== capacityVersion || starting) return;
        submitButton.disabled = capacity <= 0;
        status.textContent = `Signed in as ${user.name}. One trial per account.` +
            (capacity <= 0 ? ` No trial capacity in ${region}. Choose another data center.` : "");
    }

    form.addEventListener("change", event => {
        if (event.target.name === "region") refreshCapacity();
    });
    window.addEventListener("storage", event => {
        if (event.key === null || ["cc_products", "cc_servers", "cc_subscriptions", "cc_trials"].includes(event.key)) refreshCapacity();
    });
    await refreshCapacity();

    async function start() {
        if (!allowed || submitButton.disabled || starting) return;
        starting = true;
        submitButton.disabled = true;
        errorBox.hidden = true;
        const d = Object.fromEntries(new FormData(form));
        try {
            if (!/^[a-z0-9-]{3,30}$/.test(d.hostname || "")) {
                throw new Error("The server name needs 3 to 30 lowercase letters, numbers or dashes.");
            }
            if (d.ssh && !/^(ssh-(ed25519|rsa)|ecdsa-sha2-\S+) \S+/.test(d.ssh.trim())) {
                throw new Error("That doesn't look like an SSH public key. It should start with ssh-ed25519 or ssh-rsa.");
            }
            if (!d.agree) throw new Error("Please accept the fair use policy.");
            const startsAt = new Date();
            const endsAt = new Date(startsAt.getTime() + TRIAL_DAYS * 86400000);
            await DB.transaction(({ products, trials, subscriptions, servers }) => {
                if (trials.some(t => t.userId === user.id)) throw new Error("You already used your free trial.");
                const vm = products.find(p => p.id === "standard-vm");
                if (!vm) throw new Error("Sorry, there are no Standard VMs free right now. Try again later.");
                const allocations = DB.allocate(DB.infrastructureState({ servers, subscriptions, trials }), vm, d.region, 1);
                trials.push({
                    id: DB.newId("trial"), userId: user.id, productId: "standard-vm",
                    allocations, os: d.os, region: d.region, hostname: d.hostname, sshKey: d.ssh?.trim() || null,
                    startedAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
                });
            });
            location.href = "account.html";
        } catch (err) {
            UI.showError(errorBox, err.message);
            starting = false;
            await refreshCapacity();
        }
    }
})();
