/* ==========================================================================
   db.js — how the browser talks to the server
   --------------------------------------------------------------------------
   In the earlier milestones this file WAS the server (data in localStorage).
   Now the data lives in MongoDB behind a REST API, and this file is only the
   client for that API: a small wrapper around fetch() with the same names the
   screens already used.

       DB.list("products")                 GET    /api/products
       DB.get("products", id)              GET    /api/products/:id
       DB.insert("products", data)         POST   /api/products
       DB.update("products", id, changes)  PATCH  /api/products/:id
       DB.remove("products", id)           DELETE /api/products/:id

   Errors: the server answers { "error": "message" } with a status code. The
   wrapper throws an Error carrying that message (and `status`), so screens
   just show err.message.

   Loaded after shared/config.js (which defines window.CCConfig).
   ========================================================================== */

const DB = (() => {
    /* ---------- The one function that calls the server ---------- */
    async function request(method, url, body) {
        let response;
        try {
            response = await fetch(url, {
                method,
                credentials: "same-origin",          // send the session cookie
                headers: body === undefined ? {} : { "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch {
            throw new Error("Can't reach the server. Check your connection and try again.");
        }
        if (response.status === 204) return null;      // success with no content
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            const error = new Error(data?.error ?? `The server answered ${response.status}.`);
            error.status = response.status;
            // A 401 on a page that needed a session means it ended (or was never there).
            if (response.status === 401) document.dispatchEvent(new CustomEvent("auth:expired"));
            throw error;
        }
        return data;
    }

    /* ---------- Generic CRUD (collection name = API path) ---------- */
    const list = name => request("GET", `/api/${name}`);
    const get = async (name, id) => {
        try { return await request("GET", `/api/${name}/${encodeURIComponent(id)}`); }
        catch (err) { if (err.status === 404) return null; throw err; }
    };
    const insert = (name, data) => request("POST", `/api/${name}`, data);
    const update = (name, id, changes) => request("PATCH", `/api/${name}/${encodeURIComponent(id)}`, changes);
    const remove = async (name, id) => { await request("DELETE", `/api/${name}/${encodeURIComponent(id)}`); return true; };

    /* ---------- Specific endpoints ---------- */
    // How many more of each product fit in a data center ({ productId: number }).
    // `ignoreCart: true` ignores what the cart holds (used by the free trial).
    const availability = (dataCenter, { ignoreCart = false } = {}) =>
        request("GET", `/api/availability?dataCenter=${encodeURIComponent(dataCenter)}${ignoreCart ? "&ignoreCart=1" : ""}`);
    // Physical servers with their free capacity (administrators).
    const infrastructure = () => request("GET", "/api/servers");
    const addServer = data => request("POST", "/api/servers", data);
    const startTrial = data => request("POST", "/api/trials", data);

    /* ---------- Formatting helpers shared by all screens ---------- */
    const amountFormat = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatAmount = value => amountFormat.format(value);          // 1490 -> "1.490,00"
    const formatPrice  = value => "R$ " + formatAmount(value);          // -> "R$ 1.490,00"
    const money = value => Math.round((value + Number.EPSILON) * 100) / 100;

    return { request, list, get, insert, update, remove, availability, infrastructure, addServer, startTrial,
             CATEGORIES: CCConfig.CATEGORIES, DURATIONS: CCConfig.DURATIONS,
             formatAmount, formatPrice, money };
})();
