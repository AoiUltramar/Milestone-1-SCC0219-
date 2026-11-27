/* ==========================================================================
   seed.js — prepares the database:   npm run seed
   --------------------------------------------------------------------------
       npm run seed              creates what is missing (safe to repeat)
       npm run seed -- --reset   ERASES everything and starts again
   The server does the first form by itself when it starts, so running this
   is only needed to wipe the data or to prepare the database ahead of time.
   ========================================================================== */

const config = require("./config");
const store = require("./store");

(async () => {
    const wipe = process.argv.includes("--reset");
    const db = await store.connect();            // connect() already seeds what is missing
    if (wipe) await store.reset(db);
    const [products, servers, users] = await Promise.all(["products", "servers", "users"].map(n => db.cols[n].countDocuments()));
    console.log(`${wipe ? "Database reset" : "Database ready"} ("${config.DB_NAME}"): ${products} products, ${servers} servers, ${users} user(s). Admin sign-in: admin / admin`);
    await db.close();
})().catch(err => {
    console.error("Seeding failed:", err.message);
    process.exit(1);
});
