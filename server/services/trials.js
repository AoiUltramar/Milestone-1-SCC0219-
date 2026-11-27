/* ==========================================================================
   services/trials.js — our own feature: a free 14-day Standard VM
   --------------------------------------------------------------------------
   Rules: a signed-in customer, one trial per account, no credit card. The
   trial reserves a real slot on a physical server (like a paid VM would),
   so it shows up in the capacity numbers and on the admin dashboard. When
   the 14 days end, settleExpired() marks it released and the slot is free.
   ========================================================================== */

const { CATEGORIES, TRIAL_DAYS, TRIAL_PRODUCT_ID } = require("../../shared/config");
const { bad, conflict } = require("../errors");
const { exclusive } = require("../lock");
const { infrastructureState, allocate, REGIONS } = require("../capacity");
const { loadTables } = require("./tables");
const { newId, text } = require("../util");

async function listTrials(store, user) {
    await loadTables(store);                                 // settles the ones that ended
    return store.list("trials", user.role === "admin" ? {} : { userId: user.id });
}

function createTrial(store, user, data = {}) {
    // Input checks first (they don't need the database).
    const hostname = text(data.hostname);
    const ssh = text(data.ssh);
    if (!/^[a-z0-9-]{3,30}$/.test(hostname)) throw bad("The server name needs 3 to 30 lowercase letters, numbers or dashes.");
    if (ssh && !/^(ssh-(ed25519|rsa)|ecdsa-sha2-\S+) \S+/.test(ssh)) {
        throw bad("That doesn't look like an SSH public key. It should start with ssh-ed25519 or ssh-rsa.");
    }
    if (!data.agree) throw bad("Please accept the fair use policy.");
    if (!CATEGORIES.vms.options.OS.includes(data.os)) throw bad(`The operating system must be one of: ${CATEGORIES.vms.options.OS.join(", ")}.`);
    if (!REGIONS.includes(data.region)) throw bad(`The data center must be one of: ${REGIONS.join(", ")}.`);

    return exclusive(async () => {
        if (await store.cols.trials.findOne({ userId: user.id })) throw conflict("You already used your free trial.");
        const tables = await loadTables(store);
        const vm = tables.products.find(p => p.id === TRIAL_PRODUCT_ID);
        if (!vm) throw conflict("Sorry, there are no Standard VMs free right now. Try again later.");
        const allocations = allocate(infrastructureState(tables), vm, data.region, 1);   // 409 when the region is full
        const startedAt = new Date();
        const trial = {
            id: newId("trial"), userId: user.id, productId: TRIAL_PRODUCT_ID, allocations,
            os: data.os, region: data.region, hostname, sshKey: ssh || null,
            startedAt: startedAt.toISOString(), endsAt: new Date(startedAt.getTime() + TRIAL_DAYS * 86400000).toISOString(),
        };
        await store.insert("trials", trial);
        return trial;
    });
}

module.exports = { listTrials, createTrial };
