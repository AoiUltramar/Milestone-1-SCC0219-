/* ==========================================================================
   webmcp.js — lets AI agents in the browser use the store through tools
   --------------------------------------------------------------------------
   WebMCP is an experimental web standard (Chrome origin trial in 2026).
   A page registers named tools with document.modelContext.registerTool()
   (navigator.modelContext in Chrome 146-148); an agent running in the
   browser can then call them directly instead of guessing which buttons to
   click. Each tool has:
       name, description   what the agent reads to decide when to use it
       inputSchema         JSON Schema of the arguments
       execute(args)       our code; returns a string for the agent
       annotations         hints: readOnlyHint (only reads data),
                           consequentialHint (has real-world effects, so
                           the browser should ask the user first)

   The browser does NOT check the arguments against inputSchema (tested in
   Chromium 148), so every tool checks them itself before running, and any
   error comes back as a sentence the agent can act on, never as a throw.

   The tools reuse the same DB / Cart / Auth functions as the buttons, so
   the agent follows exactly the same rules (stock limits, sign-in, ...).
   In browsers without WebMCP this file does nothing.

   Design choice: there is no "pay" tool. The agent can fill the cart and
   open the payment form, but a person types the card and clicks Pay.
   ========================================================================== */

(async () => {
    const mc = document.modelContext ?? navigator.modelContext;   // older builds used navigator
    if (!mc?.registerTool) return;

    const json = value => JSON.stringify(value, null, 2);
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const summary = p => ({
        id: p.id, name: p.name, category: DB.CATEGORIES[p.category]?.name ?? p.category,
        price: DB.formatPrice(p.price) + (p.unit || ""), inStock: p.stock, description: p.description,
        specs: Object.fromEntries(p.specs || []), freeTrial: !!p.trial,
        ...(Object.keys(DB.CATEGORIES[p.category]?.options ?? {}).length
            ? { options: DB.CATEGORIES[p.category].options } : {}),
    });

    /* ---------- Argument checking (the subset of JSON Schema we use) ---------- */
    const TYPES = {
        string:  [v => typeof v === "string", "must be text"],
        number:  [v => typeof v === "number" && Number.isFinite(v), "must be a number"],
        integer: [v => Number.isInteger(v), "must be a whole number"],
        boolean: [v => typeof v === "boolean", "must be true or false"],
    };
    // Returns a sentence describing the first problem, or null if the arguments are fine.
    function checkArgs(schema, args) {
        if (args === null || typeof args !== "object" || Array.isArray(args)) return "the arguments must be an object.";
        for (const name of schema.required ?? []) {
            if (args[name] === undefined || args[name] === null) return `"${name}" is required.`;
        }
        for (const [name, rule] of Object.entries(schema.properties ?? {})) {
            const value = args[name];
            if (value === undefined) continue;
            const [ok, message] = TYPES[rule.type] ?? [() => true];
            if (!ok(value)) return `"${name}" ${message}.`;
            if (rule.enum && !rule.enum.includes(value)) return `"${name}" must be one of: ${rule.enum.join(", ")}.`;
            if (rule.minimum !== undefined && value < rule.minimum) return `"${name}" must be at least ${rule.minimum}.`;
        }
        return null;
    }
    // Wraps a tool so bad arguments and unexpected errors become plain answers.
    function safe(tool) {
        const run = tool.execute;
        return {
            ...tool,
            async execute(args = {}) {
                const problem = checkArgs(tool.inputSchema, args ?? {});
                if (problem) return "Invalid input: " + problem;
                try {
                    return await run(args ?? {});
                } catch (err) {
                    console.error("WebMCP tool", tool.name, err);
                    return "Something went wrong: " + err.message;
                }
            },
        };
    }

    const OPTIONS = Object.fromEntries(Object.values(DB.CATEGORIES).flatMap(c => Object.entries(c.options ?? {})));

    const tools = [
        {
            name: "search_products",
            description: "Search the Cache & Carry catalog of virtual machines, VPN plans and add-ons. " +
                         "Returns matching products with id, monthly price, stock, specs and purchase options. " +
                         "Call with no arguments to list everything.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Words to look for in the name or description, e.g. 'gpu' or 'family'." },
                    category: { type: "string", enum: Object.keys(DB.CATEGORIES), description: "Limit to one category." },
                    maxPrice: { type: "number", description: "Highest monthly price in reais." },
                    inStockOnly: { type: "boolean", description: "Leave out sold-out products." },
                },
            },
            annotations: { readOnlyHint: true },
            async execute({ query = "", category, maxPrice, inStockOnly }) {
                const words = query.toLowerCase().split(/\s+/).filter(Boolean);
                const hits = (await DB.list("products")).filter(p =>
                    (!category || p.category === category) &&
                    (maxPrice === undefined || p.price <= maxPrice) &&
                    (!inStockOnly || p.stock > 0) &&
                    words.every(w => (p.name + " " + p.description).toLowerCase().includes(w)));
                return hits.length ? json(hits.map(summary)) : "No products match that search.";
            },
        },
        {
            name: "get_product",
            description: "Get full details of one product by its id (from search_products).",
            inputSchema: {
                type: "object",
                properties: { productId: { type: "string", description: "Product id, e.g. 'standard-vm'." } },
                required: ["productId"],
            },
            annotations: { readOnlyHint: true },
            async execute({ productId }) {
                const p = await DB.get("products", productId);
                return p ? json(summary(p)) : `There is no product with id "${productId}".`;
            },
        },
        {
            name: "add_to_cart",
            description: "Add a product to the shopping cart. The quantity is limited by stock. " +
                         "Virtual machines take a data center and operating system; VPN plans take an exit country. " +
                         "Options left out get the defaults (São Paulo, Ubuntu 24.04 LTS, Brazil); options that " +
                         "don't apply to the product are ignored.",
            inputSchema: {
                type: "object",
                properties: {
                    productId: { type: "string", description: "Product id, e.g. 'standard-vm'." },
                    quantity: { type: "integer", minimum: 1, default: 1 },
                    dataCenter: { type: "string", enum: OPTIONS["Data center"], description: "Virtual machines only." },
                    operatingSystem: { type: "string", enum: OPTIONS.OS, description: "Virtual machines only." },
                    exitCountry: { type: "string", enum: OPTIONS["Exit country"], description: "VPN plans only." },
                },
                required: ["productId"],
            },
            async execute({ productId, quantity = 1, dataCenter, operatingSystem, exitCountry }) {
                // Cart.add keeps only the options that belong to the product's category.
                const options = { "Data center": dataCenter, OS: operatingSystem, "Exit country": exitCountry };
                try {
                    const { added, capped, product } = await Cart.add(productId, quantity, options);
                    UI.toast(`An assistant added ${added} × ${product.name} to your cart.`);
                    return `Added ${added} × ${product.name}.` + (capped ? ` Only ${added} could be added because of stock.` : "");
                } catch (err) {
                    return "Could not add it: " + err.message;
                }
            },
        },
        {
            name: "view_cart",
            description: "Show what is in the shopping cart, with line keys, quantities, options and the monthly total.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true },
            async execute() {
                const { lines, total, count } = await Cart.get();
                if (!lines.length) return "The cart is empty.";
                return json({
                    items: lines.map(l => ({ lineKey: l.key, productId: l.productId, name: l.product.name,
                                             quantity: l.qty, options: l.options,
                                             lineTotal: DB.formatPrice(l.product.price * l.qty) })),
                    itemCount: count, monthlyTotal: DB.formatPrice(total),
                });
            },
        },
        {
            name: "update_cart_item",
            description: "Change the quantity of a cart line (use lineKey from view_cart). Quantity 0 removes it. " +
                         "The quantity is limited by stock.",
            inputSchema: {
                type: "object",
                properties: { lineKey: { type: "string" }, quantity: { type: "integer", minimum: 0 } },
                required: ["lineKey", "quantity"],
            },
            async execute({ lineKey, quantity }) {
                const { lines } = await Cart.get();
                if (!lines.some(l => l.key === lineKey)) {
                    return `There is no cart line with key "${lineKey}". Call view_cart to see the current keys.`;
                }
                const kept = await Cart.setQty(lineKey, quantity);
                if (quantity === 0) return "Removed from the cart.";
                if (kept === 0) return "That product is sold out, so the line was removed.";
                return `Quantity is now ${kept}.` + (kept < quantity ? ` Only ${kept} are in stock.` : "");
            },
        },
        {
            name: "go_to_checkout",
            description: "Open the payment page so the user can review the cart and pay. " +
                         "The user enters card details and confirms the purchase themselves; there is no tool to pay.",
            inputSchema: { type: "object", properties: {} },
            annotations: { consequentialHint: true },
            async execute() {
                const [{ count, total }, user] = await Promise.all([Cart.get(), Auth.currentUser()]);
                if (!count) return "The cart is empty, so there is nothing to pay for.";
                if (user?.role === "admin") {
                    return "Administrator accounts can't place orders. The user must sign in with a customer account to pay.";
                }
                setTimeout(() => { location.href = "cart.html#payment"; }, 0);
                const what = `Opening the payment page: ${plural(count, "item")}, ${DB.formatPrice(total)} per month.`;
                return user
                    ? `${what} The user will enter the card and confirm.`
                    : `${what} The user is not signed in: they must sign in or create an account on that page before paying. The cart is kept.`;
            },
        },
    ];

    // Admin-only tool, registered only when an administrator is signed in.
    const user = await Auth.currentUser();
    if (user?.role === "admin") {
        tools.push({
            name: "set_stock",
            description: "Administrators only: set the quantity in stock for a product.",
            inputSchema: {
                type: "object",
                properties: { productId: { type: "string" }, stock: { type: "integer", minimum: 0 } },
                required: ["productId", "stock"],
            },
            annotations: { consequentialHint: true },
            async execute({ productId, stock }) {
                // Checked again on every call: the admin may have signed out in another tab.
                const current = await Auth.currentUser();
                if (current?.role !== "admin") return "Only administrators can change stock.";
                if (!await DB.get("products", productId)) return `There is no product with id "${productId}".`;
                const p = await DB.update("products", productId, { stock });
                return `${p.name} now has ${p.stock} in stock.`;
            },
        });
    }

    let registered = 0;
    for (const tool of tools) {
        try {
            await mc.registerTool(safe(tool));
            registered++;
        } catch (err) {
            console.warn("WebMCP: could not register", tool.name, err);
        }
    }
    console.info(`WebMCP: registered ${registered} tools.`);
})();
