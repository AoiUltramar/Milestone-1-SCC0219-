/* ==========================================================================
   sessions.js — who is signed in
   --------------------------------------------------------------------------
   A session is a document in the "sessions" collection with a random id.
   The browser keeps only that id, in an HttpOnly cookie (JavaScript on the
   page cannot read it, which limits what a script injected into the page
   could steal). Every API request looks the id up to find the user, so the
   role of the user is always decided HERE, by the server, never by the
   browser — editing the browser's storage can no longer make someone admin.

   Visitors get an anonymous session as soon as they add something to the
   cart, so the cart survives until they sign in (and is merged then).
   ========================================================================== */

const crypto = require("crypto");
const config = require("./config");
const { publicUser } = require("./services/users");
const { unauthorized, forbidden } = require("./errors");

const COOKIE = "cc_sid";
const MAX_AGE = config.SESSION_DAYS * 24 * 60 * 60;       // seconds

// A cookie that can't be decoded (e.g. "cc_sid=%E0") is ignored: the person is
// treated as a visitor instead of every request failing with a 500.
function parseCookies(header = "") {
    return Object.fromEntries(header.split(";").map(part => part.trim()).filter(part => part.includes("=")).map(part => {
        const i = part.indexOf("=");
        let value;
        try { value = decodeURIComponent(part.slice(i + 1)); } catch { value = ""; }
        return [part.slice(0, i), value];
    }));
}

function setCookie(req, res, value, maxAge) {
    const secure = config.COOKIE_SECURE || req.secure ? "; Secure" : "";
    res.append("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

// Express middleware: finds the session and the user for this request.
// Sets req.session ({ id, userId } or null) and req.user (public fields or null).
function attachSession(store) {
    return async (req, res, next) => {
        try {
            req.session = null;
            req.user = null;
            const sid = parseCookies(req.headers.cookie)[COOKIE];
            const doc = sid ? await store.cols.sessions.findOne({ _id: sid }) : null;
            if (doc && doc.expiresAt > new Date()) {
                req.session = { id: doc._id, userId: doc.userId ?? null };
                if (doc.userId) {
                    req.user = publicUser(await store.get("users", doc.userId));
                    if (!req.user) {                      // the account was deleted
                        await store.cols.sessions.deleteOne({ _id: doc._id });
                        req.session = null;
                    }
                }
            }
            next();
        } catch (err) { next(err); }
    };
}

// Creates a NEW session (a new id on every sign-in prevents "session
// fixation"), removing the previous one. userId = null for a visitor.
async function startSession(store, req, res, userId = null) {
    if (req.session) await store.cols.sessions.deleteOne({ _id: req.session.id });
    const id = crypto.randomBytes(32).toString("hex");
    await store.cols.sessions.insertOne({ _id: id, userId, createdAt: new Date(), expiresAt: new Date(Date.now() + MAX_AGE * 1000) });
    setCookie(req, res, id, MAX_AGE);
    req.session = { id, userId };
    return id;
}

async function endSession(store, req, res) {
    if (req.session) await store.cols.sessions.deleteOne({ _id: req.session.id });
    setCookie(req, res, "", 0);
    req.session = null;
    req.user = null;
}

// Makes sure there is a session (anonymous if nobody is signed in).
async function ensureSession(store, req, res) {
    if (!req.session) await startSession(store, req, res, null);
}

// The cart belongs to the user, or to the visitor's anonymous session.
const cartOwner = req => (req.user ? req.user.id : req.session ? "guest:" + req.session.id : null);

/* ---------- Route guards ---------- */

function requireUser(req, res, next) {
    next(req.user ? undefined : unauthorized());
}

// requireRole("admin") / requireRole("customer")
const requireRole = role => (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== role) return next(forbidden(role === "admin" ? "Only administrators can do that." : "Only customers can do that."));
    next();
};

module.exports = { attachSession, startSession, endSession, ensureSession, cartOwner, requireUser, requireRole };
