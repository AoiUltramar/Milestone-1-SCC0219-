/* ==========================================================================
   trial.js — the free-trial screen (/trial): our own feature, a free 14-day Standard VM
   --------------------------------------------------------------------------
   Rules (all enforced by the server): you must be signed in as a customer,
   each account gets one trial, and the trial reserves a real slot on a
   physical server of the chosen data center. Trials are shown on the account
   screen with the days left. This script only explains why the form can't be
   used when it can't, shows whether the chosen data center still has room,
   and sends the form.
   ========================================================================== */

Views.trial = async ({ signal }) => {
    const $ = id => document.getElementById(id);
    const form = $("trial-form");
    const errorBox = $("trial-error");
    const status = $("trial-status");
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    let capacityVersion = 0;
    let starting = false;
    let user = null;
    let allowed = false;     // becomes true once we know a customer without a trial is signed in

    // Attach the handler first, so a fast click never submits the form the
    // old-fashioned way (which would just reload the page).
    form.addEventListener("submit", e => { e.preventDefault(); start(); });

    user = await Auth.currentUser();
    const existing = user?.role === "customer" ? (await DB.list("trials"))[0] : null;   // the server returns only this customer's trial
    if (signal.aborted) return;

    // Explain why the form can't be used, if it can't.
    if (!user) {
        status.innerHTML = `You need to be signed in to start a trial. <a href="/login?next=/trial">Sign in or create an account</a>.`;
    } else if (user.role !== "customer") {
        status.innerHTML = `Administrator accounts can't start trials. Sign in with a customer account.`;
    } else if (existing) {
        status.innerHTML = `You already used your free trial (<strong>${UI.esc(existing.hostname)}</strong>). <a href="/account">See it on your account page</a>.`;
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

    // Does the chosen data center still have room for one more Standard VM?
    async function refreshCapacity() {
        if (!allowed || starting) return;
        const version = ++capacityVersion;
        submitButton.disabled = true;
        const region = form.elements.region.value;
        const capacity = (await DB.availability(region, { ignoreCart: true }))["standard-vm"] ?? 0;
        if (version !== capacityVersion || starting || signal.aborted) return;
        submitButton.disabled = capacity <= 0;
        status.textContent = `Signed in as ${user.name}. One trial per account.` +
            (capacity <= 0 ? ` No trial capacity in ${region}. Choose another data center.` : "");
    }

    form.addEventListener("change", event => {
        if (event.target.name === "region") refreshCapacity();
    });
    await refreshCapacity();

    async function start() {
        if (!allowed || submitButton.disabled || starting) return;
        starting = true;
        submitButton.disabled = true;
        errorBox.hidden = true;
        const d = Object.fromEntries(new FormData(form));
        try {
            // The server checks everything (name format, SSH key, policy, capacity, one trial per account).
            await DB.startTrial({ os: d.os, region: d.region, hostname: d.hostname, ssh: d.ssh, agree: !!d.agree });
            await Router.go("/account");
        } catch (err) {
            UI.showError(errorBox, err.message);
            starting = false;
            await refreshCapacity();
        }
    }
};
