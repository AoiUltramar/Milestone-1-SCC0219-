/* ==========================================================================
   routes/products.js — /api/products
   --------------------------------------------------------------------------
       GET    /api/products?category=vms&q=gpu   the catalog (anyone)
       GET    /api/products/:id                  one product (anyone)
       POST   /api/products                      create (administrators)
       PATCH  /api/products/:id                  change some fields (administrators)
       DELETE /api/products/:id                  delete (administrators)
   ========================================================================== */

const express = require("express");
const { wrap } = require("../errors");
const { requireRole } = require("../sessions");
const products = require("../services/products");

module.exports = store => {
    const router = express.Router();

    router.get("/", wrap(async (req, res) => {
        res.json(await products.listProducts(store, { category: req.query.category, q: req.query.q }));
    }));

    router.get("/:id", wrap(async (req, res) => {
        res.json(await products.getProduct(store, req.params.id));
    }));

    router.post("/", requireRole("admin"), wrap(async (req, res) => {
        res.status(201).json(await products.createProduct(store, req.body ?? {}));
    }));

    const update = wrap(async (req, res) => {
        res.json(await products.updateProduct(store, req.params.id, req.body ?? {}));
    });
    router.patch("/:id", requireRole("admin"), update);
    router.put("/:id", requireRole("admin"), update);

    router.delete("/:id", requireRole("admin"), wrap(async (req, res) => {
        await products.deleteProduct(store, req.params.id);
        res.status(204).end();
    }));

    return router;
};
