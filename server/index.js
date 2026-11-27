/* ==========================================================================
   index.js — starts the server:   npm start
   --------------------------------------------------------------------------
   Connects to MongoDB, creates the initial data if the database is new
   (products, physical servers and the admin/admin account), then listens.
   ========================================================================== */

const config = require("./config");
const store = require("./store");
const { createApp } = require("./app");
const { settleExpired } = require("./services/tables");

async function main() {
    let db;
    try {
        db = await store.connect();
    } catch (err) {
        if (/Server|Network|ECONNREFUSED/.test(err.name + err.message)) {
            console.error(`\nCould not connect to MongoDB at ${config.MONGO_URL}\n  (${err.message})\n` +
                          "Start MongoDB first (see the Build Procedures in README.md), or set MONGO_URL.\n");
        } else {
            console.error("\nThe server could not start:", err);
        }
        process.exit(1);
    }
    if (config.TEST_MODE) console.warn("CC_TEST=1: the /api/test/* helpers are enabled. Do not use this mode in production.");

    // Expired subscriptions and trials are settled whenever capacity is
    // calculated; this timer also does it while the store is idle.
    const timer = setInterval(() => settleExpired(db).catch(err => console.error("settle:", err.message)), 60000);

    const server = createApp(db).listen(config.PORT, () => {
        console.log(`Cache & Carry running at http://localhost:${config.PORT}  (database "${config.DB_NAME}")`);
    });

    const stop = () => {
        clearInterval(timer);
        server.close(() => db.close().then(() => process.exit(0)));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
}

main();
