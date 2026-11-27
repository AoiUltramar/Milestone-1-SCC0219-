/* ==========================================================================
   routes/auth.js — /api/auth: register, sign in, sign out, who am I
   ========================================================================== */

const express = require("express");
const { wrap, unauthorized, HttpError } = require("../errors");
const { createUser, publicUser } = require("../services/users");
const { mergeGuestCart } = require("../services/cart");
const { verifyPassword } = require("../passwords");
const { startSession, endSession, ensureSession } = require("../sessions");

const sameText = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

// Slows down password guessing: after 8 failures for the same login within
// a minute, further attempts are refused for the rest of that minute.
const failures = new Map();
function checkThrottle(login) {
    const entry = failures.get(login);
    if (entry && entry.until > Date.now() && entry.count >= 8) throw new HttpError(429, "Too many attempts. Wait a minute and try again.");
}
function recordFailure(login) {
    const entry = failures.get(login);
    if (!entry || entry.until <= Date.now()) failures.set(login, { count: 1, until: Date.now() + 60000 });
    else entry.count++;
}

module.exports = store => {
    const router = express.Router();

    // The visitor's cart (kept under their anonymous session) moves into the
    // account they just signed in to, so nothing they added is lost.
    async function signedIn(req, res, user) {
        const guestCart = req.session && !req.session.userId ? "guest:" + req.session.id : null;
        await startSession(store, req, res, user.id);
        if (guestCart && user.role === "customer") await mergeGuestCart(store, guestCart, user.id);
    }

    // POST /api/auth/register   { name, email, phone, address: {street, city, cep}, password }
    router.post("/register", wrap(async (req, res) => {
        const user = await createUser(store, req.body ?? {}, "customer");
        await signedIn(req, res, user);
        res.status(201).json({ user });
    }));

    // POST /api/auth/login   { login: "email or username", password }
    router.post("/login", wrap(async (req, res) => {
        const { login, password } = req.body ?? {};
        // Only text is a login; an object or array (e.g. {"$ne": null}) is a bad request, not a crash.
        if (typeof login !== "string") throw new HttpError(400, "Enter your email or username.");
        const key = login.trim().toLowerCase();
        checkThrottle(key);
        const users = await store.list("users");
        const user = users.find(u => sameText(u.email, login) || (u.username && sameText(u.username, login)));
        // The same message for an unknown account and a wrong password, so the
        // form doesn't reveal which emails are registered.
        if (!user || !await verifyPassword(password, user)) {
            recordFailure(key);
            throw unauthorized("The email or password is incorrect. Check both fields and try again.");
        }
        failures.delete(key);
        await signedIn(req, res, user);
        res.json({ user: publicUser(user) });
    }));

    // POST /api/auth/logout
    router.post("/logout", wrap(async (req, res) => {
        await endSession(store, req, res);
        res.status(204).end();
    }));

    // GET /api/auth/me   ->  { user: {...} }  or  { user: null } for a visitor
    // A visitor also gets a session cookie here: the page asks "who am I?" as soon as
    // it loads, so the cookie exists before the first cart request. Without this,
    // several first requests sent at the same time would each create their own session.
    router.get("/me", wrap(async (req, res) => {
        await ensureSession(store, req, res);
        res.json({ user: req.user });
    }));

    return router;
};
