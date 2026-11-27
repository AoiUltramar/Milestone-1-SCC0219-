/* ==========================================================================
   routes/orders.js — /api/orders, /api/trials, /api/subscriptions, /api/servers
   --------------------------------------------------------------------------
       GET   /api/orders                 own orders (administrators: all)
       POST  /api/orders                 PAY for the cart   { card: { name, number, expiry, cvv } }
       GET   /api/trials                 own free trial (administrators: all)
       POST  /api/trials                 start the free trial
       GET   /api/subscriptions          own subscriptions (administrators: all)
       PATCH /api/subscriptions/:id      cancel it          { status: "cancelled" }
       GET   /api/servers                physical servers and free capacity (administrators)
       POST  /api/servers                add a physical server (administrators)
   ========================================================================== */

const express = require("express");
const { wrap, bad, unauthorized, forbidden } = require("../errors");
const { requireUser, requireRole } = require("../sessions");
const { checkout } = require("../services/orders");
const { listTrials, createTrial } = require("../services/trials");
const { listSubscriptions, cancelSubscription } = require("../services/subscriptions");
const { listServers, addServer } = require("../services/servers");

// Only customers buy things; explain it to administrators and visitors.
const customerOnly = action => (req, res, next) => {
    if (!req.user) return next(unauthorized(`Please sign in to ${action}.`));
    if (req.user.role !== "customer") return next(forbidden(`Administrator accounts can't ${action}. Sign in as a customer.`));
    next();
};

module.exports = store => {
    const orders = express.Router();
    orders.get("/", requireUser, wrap(async (req, res) => {
        const list = await store.list("orders", req.user.role === "admin" ? {} : { userId: req.user.id });
        res.json(list.sort((a, b) => b.date.localeCompare(a.date)));
    }));
    orders.post("/", customerOnly("pay"), wrap(async (req, res) => {
        res.status(201).json(await checkout(store, req.user, req.body?.card));
    }));

    const trials = express.Router();
    trials.get("/", requireUser, wrap(async (req, res) => res.json(await listTrials(store, req.user))));
    trials.post("/", customerOnly("start trials"), wrap(async (req, res) => {
        res.status(201).json(await createTrial(store, req.user, req.body ?? {}));
    }));

    const subscriptions = express.Router();
    subscriptions.get("/", requireUser, wrap(async (req, res) => res.json(await listSubscriptions(store, req.user))));
    subscriptions.patch("/:id", customerOnly("cancel subscriptions"), wrap(async (req, res) => {
        if (req.body?.status !== "cancelled") throw bad('The only change allowed is { "status": "cancelled" }.');
        res.json(await cancelSubscription(store, req.user, req.params.id));
    }));

    const servers = express.Router();
    servers.get("/", requireRole("admin"), wrap(async (req, res) => res.json(await listServers(store))));
    servers.post("/", requireRole("admin"), wrap(async (req, res) => {
        res.status(201).json(await addServer(store, req.body ?? {}));
    }));

    return { orders, trials, subscriptions, servers };
};
