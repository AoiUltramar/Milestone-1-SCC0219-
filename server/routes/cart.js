/* ==========================================================================
   routes/cart.js — /api/cart (the cart of whoever makes the request)
   --------------------------------------------------------------------------
       GET    /api/cart                  lines with their product, totals
       POST   /api/cart/items            add   { productId, qty, options, months }
       PATCH  /api/cart/items/:key       change { qty } or { months }
       DELETE /api/cart/items/:key       remove a line
       DELETE /api/cart                  empty the cart
       GET    /api/availability?dataCenter=São Paulo   how many more of each product fit
   The owner is the signed-in user or, for a visitor, an anonymous session.
   ========================================================================== */

const express = require("express");
const { wrap, bad } = require("../errors");
const { ensureSession, cartOwner } = require("../sessions");
const cart = require("../services/cart");

const EMPTY = { lines: [], total: 0, monthlyTotal: 0, count: 0 };

module.exports = store => {
    const router = express.Router();

    // Visitors get an anonymous session the first time they change the cart.
    const owner = async (req, res) => {
        await ensureSession(store, req, res);
        return cartOwner(req);
    };

    router.get("/", wrap(async (req, res) => {
        const who = cartOwner(req);
        res.json(who ? await cart.getCart(store, who) : EMPTY);
    }));

    router.post("/items", wrap(async (req, res) => {
        const result = await cart.addItem(store, await owner(req, res), req.body ?? {});
        res.status(201).json(result);
    }));

    router.patch("/items/:key", wrap(async (req, res) => {
        const who = await owner(req, res);
        const { qty, months } = req.body ?? {};
        if (qty === undefined && months === undefined) throw bad("Send the new qty or months.");
        if (months !== undefined) await cart.setDuration(store, who, req.params.key, months);
        if (qty !== undefined) return res.json({ kept: await cart.setQty(store, who, req.params.key, qty) });
        res.json({});
    }));

    router.delete("/items/:key", wrap(async (req, res) => {
        await cart.removeItem(store, await owner(req, res), req.params.key);
        res.status(204).end();
    }));

    router.delete("/", wrap(async (req, res) => {
        await cart.clearCart(store, await owner(req, res));
        res.status(204).end();
    }));

    return router;
};

// Mounted separately at /api/availability.
module.exports.availability = store => wrap(async (req, res) => {
    res.json(await cart.availability(store, cartOwner(req) ?? "guest:none", req.query.dataCenter, { ignoreCart: req.query.ignoreCart === "1" }));
});
