/* ==========================================================================
   routes/users.js — /api/users
   --------------------------------------------------------------------------
       GET    /api/users?role=customer     list (administrators)
       POST   /api/users                   create a customer or administrator (administrators)
       GET    /api/users/:id               one user (administrators, or the user themselves)
       PATCH  /api/users/:id               edit (administrators, or the user themselves)
       DELETE /api/users/:id               remove (administrators)
   ========================================================================== */

const express = require("express");
const { wrap, forbidden } = require("../errors");
const { requireUser, requireRole } = require("../sessions");
const users = require("../services/users");

module.exports = store => {
    const router = express.Router();

    // An administrator may touch any account; everyone else only their own.
    const ownOrAdmin = (req, res, next) =>
        next(req.user.role === "admin" || req.user.id === req.params.id ? undefined : forbidden());

    router.get("/", requireRole("admin"), wrap(async (req, res) => {
        res.json(await users.listUsers(store, req.query.role));
    }));

    router.post("/", requireRole("admin"), wrap(async (req, res) => {
        const body = req.body ?? {};
        res.status(201).json(await users.createUser(store, body, body.role ?? "customer"));
    }));

    router.get("/:id", requireUser, ownOrAdmin, wrap(async (req, res) => {
        res.json(await users.getUser(store, req.params.id));
    }));

    const update = wrap(async (req, res) => {
        res.json(await users.updateUser(store, req.params.id, req.body ?? {}, req.user));
    });
    router.patch("/:id", requireUser, ownOrAdmin, update);
    router.put("/:id", requireUser, ownOrAdmin, update);

    router.delete("/:id", requireRole("admin"), wrap(async (req, res) => {
        await users.deleteUser(store, req.params.id, req.user);
        res.status(204).end();
    }));

    return router;
};
