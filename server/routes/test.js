/* ==========================================================================
   routes/test.js — helpers for the automatic tests (only with CC_TEST=1)
   --------------------------------------------------------------------------
       POST /api/test/reset     empty the database and seed it again
       POST /api/test/expire    make trials/subscriptions end in the past, to
                                test what happens when time runs out
   These routes are NOT registered in normal operation.
   ========================================================================== */

const express = require("express");
const { wrap, bad } = require("../errors");
const { reset } = require("../store");

module.exports = store => {
    const router = express.Router();

    router.post("/reset", wrap(async (req, res) => {
        await reset(store);
        res.status(204).end();
    }));

    // body: { collection: "trials" | "subscriptions", userId?: "..." }
    router.post("/expire", wrap(async (req, res) => {
        const { collection, userId } = req.body ?? {};
        if (!["trials", "subscriptions"].includes(collection)) throw bad("collection must be trials or subscriptions.");
        const past = new Date(Date.now() - 60000).toISOString();
        const result = await store.cols[collection].updateMany(userId ? { userId } : {}, { $set: { endsAt: past } });
        res.json({ changed: result.modifiedCount });
    }));

    return router;
};
