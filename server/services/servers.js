/* ==========================================================================
   services/servers.js — the physical infrastructure behind the VM plans
   ========================================================================== */

const { bad } = require("../errors");
const { exclusive } = require("../lock");
const { infrastructureState, RESOURCES, REGIONS } = require("../capacity");
const { loadTables } = require("./tables");
const { newId } = require("../util");

// Each server with its total resources and what is still `free`.
async function listServers(store) {
    return infrastructureState(await loadTables(store));
}

function addServer(store, data = {}) {
    return exclusive(async () => {
        const invalid = RESOURCES.some(k => !Number.isSafeInteger(data[k]) || data[k] < (k === "gpu" ? 0 : 1));
        if (!REGIONS.includes(data.region) || invalid) throw bad("Enter a valid data center and whole resource capacities.");
        const server = { id: newId("server"), region: data.region, ...Object.fromEntries(RESOURCES.map(k => [k, data[k]])) };
        await store.insert("servers", server);
        return server;
    });
}

module.exports = { listServers, addServer };
