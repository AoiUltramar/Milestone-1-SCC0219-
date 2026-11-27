/* ==========================================================================
   app.js — builds the Express application
   --------------------------------------------------------------------------
   Two jobs:
     1. the REST API under /api/...  (JSON in, JSON out);
     2. serving the single-page application: index.html plus /static and
        /shared. Any other address (like /cart or /admin/products) also gets
        index.html, and the router running in the browser draws the page.
   ========================================================================== */

const path = require("path");
const express = require("express");
const config = require("./config");
const { attachSession } = require("./sessions");
const { HttpError } = require("./errors");

const ROOT = path.join(__dirname, "..");

function createApp(store) {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "2mb" }));        // product photos arrive as small data: URLs

    // A few cheap, standard protections for every response.
    app.use((req, res, next) => {
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Referrer-Policy", "same-origin");
        res.set("X-Frame-Options", "DENY");
        next();
    });

    /* ---------- REST API ---------- */
    app.use("/api", attachSession(store));
    app.use("/api/auth", require("./routes/auth")(store));
    app.use("/api/users", require("./routes/users")(store));
    app.use("/api/products", require("./routes/products")(store));
    app.use("/api/cart", require("./routes/cart")(store));
    app.get("/api/availability", require("./routes/cart").availability(store));
    const { orders, trials, subscriptions, servers } = require("./routes/orders")(store);
    app.use("/api/orders", orders);
    app.use("/api/trials", trials);
    app.use("/api/subscriptions", subscriptions);
    app.use("/api/servers", servers);
    if (config.TEST_MODE) app.use("/api/test", require("./routes/test")(store));
    app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

    /* ---------- The single-page application ---------- */
    // no-cache: the browser always asks whether a file changed (cheap, gets a 304).
    const files = { setHeaders: res => res.set("Cache-Control", "no-cache") };
    app.use("/static", express.static(path.join(ROOT, "static"), files));
    app.use("/shared", express.static(path.join(ROOT, "shared"), files));
    // Every address without a file extension is a page of the SPA.
    app.get(/^\/(?!api\/|static\/|shared\/)[^.]*$/, (req, res) => {
        res.set("Cache-Control", "no-cache");
        res.sendFile(path.join(ROOT, "index.html"));
    });
    app.use((req, res) => res.status(404).type("text").send("Not found"));

    /* ---------- Errors ---------- */
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
        if (err.type === "entity.parse.failed") return res.status(400).json({ error: "The request body is not valid JSON." });
        if (err.type === "entity.too.large") return res.status(413).json({ error: "The request is too large." });
        // Other client errors raised by Express itself, such as a badly %-encoded
        // address (/api/products/%E0), keep their 4xx status instead of a 500.
        if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
            return res.status(err.status).json({ error: err.status === 400 ? "The request is not valid." : "The request could not be handled." });
        }
        console.error(err);
        res.status(500).json({ error: "Something went wrong on the server." });
    });

    return app;
}

module.exports = { createApp };
