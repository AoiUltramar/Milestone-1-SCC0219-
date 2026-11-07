// WebMCP tests against the browser's REAL WebMCP implementation (not a mock).
// Runs in the "webmcp" Playwright project, which launches a Chromium that has
// WebMCP behind a feature flag (see playwright.config.js). Tools are listed
// and executed the way an agent's browser would: through
// navigator.modelContextTesting (Chrome 146-148) or
// document.modelContext.getTools()/executeTool() (newer builds).
//
// Important finding: the browser does NOT validate arguments against
// inputSchema, so every test with bad input checks that OUR code refuses it.
const { test, expect } = require("@playwright/test");
const { prepare, signIn, signInAsAdmin, registerCustomer, signOut, addToCart } = require("./helpers");

test.beforeEach(async ({ page }) => prepare(page));

const STORE_TOOLS = ["add_to_cart", "get_product", "go_to_checkout", "search_products", "update_cart_item", "view_cart"];

// Names (and schemas) of the tools the browser knows about on this page.
// Waits until at least `minimum` tools are registered (the page registers
// them after checking who is signed in).
async function listTools(page, minimum = STORE_TOOLS.length) {
    const read = () => page.evaluate(async () => {
        const mc = document.modelContext;
        const list = mc?.getTools ? await mc.getTools() : await navigator.modelContextTesting.listTools();
        return list.map(t => ({
            name: t.name, description: t.description,
            inputSchema: typeof t.inputSchema === "string" ? JSON.parse(t.inputSchema) : t.inputSchema,
        }));
    });
    let tools = [];
    await expect.poll(async () => (tools = await read()).length, { timeout: 5000 }).toBeGreaterThanOrEqual(minimum);
    return tools;
}

// Run a tool like an agent would. Returns { result } or { error }.
async function call(page, name, args = {}) {
    return page.evaluate(async ([name, args]) => {
        try {
            const mc = document.modelContext;
            if (mc?.executeTool) {
                const tool = (await mc.getTools()).find(t => t.name === name);
                return { result: await mc.executeTool(tool, args) };
            }
            return { result: await navigator.modelContextTesting.executeTool(name, JSON.stringify(args)) };
        } catch (err) {
            return { error: err.message };
        }
    }, [name, args]);
}
// Shortcut: the tool's text, failing the test if the browser threw.
async function text(page, name, args) {
    const r = await call(page, name, args);
    expect(r.error, `${name} threw`).toBeUndefined();
    return r.result;
}

async function ready(page, url = "index.html") {
    await page.goto(url);
    await listTools(page);
}

const stockOf = (page, id) => page.evaluate(async id => (await DB.get("products", id)).stock, id);
const cartLines = page => page.evaluate(async () => (await Cart.get()).lines.map(l => ({ key: l.key, qty: l.qty, options: l.options })));

/* ------------------------------------------------------------------ */
test.describe("W1 Registration", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("index.html");
        const supported = await page.evaluate(() => !!(document.modelContext?.getTools || navigator.modelContextTesting));
        test.skip(!supported, "This browser has no WebMCP testing API");
    });

    for (const file of ["index.html", "vms.html", "vpn.html", "addons.html", "cart.html", "about.html", "login.html", "trial.html"]) {
        test(`${file} registers exactly the store tools`, async ({ page }) => {
            await page.goto(file);
            const names = (await listTools(page)).map(t => t.name).sort();
            expect(names).toEqual(STORE_TOOLS);
        });
    }

    test("every tool has a description and a valid object schema", async ({ page }) => {
        for (const tool of await listTools(page)) {
            expect(tool.description.length, tool.name).toBeGreaterThan(20);
            expect(tool.inputSchema.type, tool.name).toBe("object");
            for (const req of tool.inputSchema.required ?? []) {
                expect(Object.keys(tool.inputSchema.properties), `${tool.name}.${req}`).toContain(req);
            }
        }
    });

    test("there is no tool that can pay", async ({ page }) => {
        const names = (await listTools(page)).map(t => t.name);
        expect(names.some(n => /pay|checkout_confirm|purchase|order/.test(n))).toBe(false);
    });

    test("customers don't get set_stock; admins do, also on admin pages", async ({ page }) => {
        await registerCustomer(page);
        await page.goto("account.html");
        expect((await listTools(page)).map(t => t.name)).not.toContain("set_stock");
        await signOut(page);
        await signInAsAdmin(page);
        expect((await listTools(page, 7)).map(t => t.name)).toContain("set_stock");
        await page.goto("admin-users.html");
        expect((await listTools(page, 7)).map(t => t.name)).toContain("set_stock");
    });

    test("schemas list the same choices as the page's selects", async ({ page }) => {
        const add = (await listTools(page)).find(t => t.name === "add_to_cart").inputSchema.properties;
        await page.goto("vms.html");
        const regions = await page.locator("#region option").allTextContents();
        const systems = await page.locator("#os option").allTextContents();
        expect(add.dataCenter.enum).toEqual(regions);
        expect(add.operatingSystem.enum).toEqual(systems);
        await page.goto("vpn.html");
        expect(add.exitCountry?.enum).toEqual(await page.locator("#exit option").allTextContents());
    });
});

/* ------------------------------------------------------------------ */
test.describe("W2 search_products and get_product", () => {
    test.beforeEach(async ({ page }) => ready(page));

    test("no arguments lists the whole catalog", async ({ page }) => {
        const all = JSON.parse(await text(page, "search_products", {}));
        expect(all).toHaveLength(10);
        expect(all[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), price: expect.stringMatching(/^R\$ /) });
    });

    test("filters combine: words, category, max price, in stock only", async ({ page }) => {
        const ids = async args => JSON.parse(await text(page, "search_products", args)).map(p => p.id);
        expect(await ids({ query: "GPU" })).toEqual(["gpu-vm"]);                         // case-insensitive
        expect(await ids({ query: "family vpn" })).toEqual(["family-vpn"]);             // every word must match
        expect(await ids({ category: "vpn" })).toHaveLength(3);
        expect(await ids({ category: "vms", maxPrice: 50 })).toEqual(["nano-vm", "standard-vm"]);
        expect(await ids({ category: "vms", inStockOnly: true })).not.toContain("gpu-vm");
    });

    test("nothing found gives a clear sentence, not an empty list", async ({ page }) => {
        expect(await text(page, "search_products", { query: "mainframe" })).toBe("No products match that search.");
    });

    test("wrong argument types are refused politely, never thrown", async ({ page }) => {
        expect(await text(page, "search_products", { query: 42 })).toMatch(/^Invalid input: "query"/);
        expect(await text(page, "search_products", { category: "servers" })).toMatch(/^Invalid input: "category"/);
        expect(await text(page, "search_products", { maxPrice: "cheap" })).toMatch(/^Invalid input: "maxPrice"/);
    });

    test("get_product returns details, or says the id doesn't exist", async ({ page }) => {
        const p = JSON.parse(await text(page, "get_product", { productId: "standard-vm" }));
        expect(p).toMatchObject({ id: "standard-vm", inStock: 42, freeTrial: true, specs: { CPU: "2 vCPU" } });
        expect(await text(page, "get_product", { productId: "nope" })).toBe('There is no product with id "nope".');
        expect(await text(page, "get_product", {})).toMatch(/^Invalid input: "productId" is required/);
    });

    test("results reflect stock changes made by an admin", async ({ page }) => {
        await page.evaluate(() => DB.update("products", "gpu-vm", { stock: 2 }));
        const gpu = JSON.parse(await text(page, "get_product", { productId: "gpu-vm" }));
        expect(gpu.inStock).toBe(2);
    });
});

/* ------------------------------------------------------------------ */
test.describe("W3 add_to_cart", () => {
    test.beforeEach(async ({ page }) => ready(page));

    test("adds, updates the badge and shows a toast to the person", async ({ page }) => {
        expect(await text(page, "add_to_cart", { productId: "nano-vm", quantity: 2 })).toBe("Added 2 × Nano VM.");
        await expect(page.locator(".cart-count")).toHaveText("2");
        await expect(page.locator(".toast").last()).toContainText("An assistant added 2 × Nano VM");
    });

    test("quantity defaults to 1", async ({ page }) => {
        expect(await text(page, "add_to_cart", { productId: "daily-backups" })).toBe("Added 1 × Daily backups.");
    });

    test("stock limits apply exactly as for the Add button", async ({ page }) => {
        await page.evaluate(() => DB.update("products", "dedicated-ip", { stock: 3 }));
        expect(await text(page, "add_to_cart", { productId: "dedicated-ip", quantity: 5 }))
            .toBe("Added 3 × Dedicated IP. Only 3 could be added because of stock.");
        expect(await text(page, "add_to_cart", { productId: "dedicated-ip" }))
            .toMatch(/^Could not add it: You already have all 3/);
        expect(await text(page, "add_to_cart", { productId: "gpu-vm" })).toBe("Could not add it: GPU VM is sold out.");
    });

    test("bad input is refused before touching the cart", async ({ page }) => {
        const cases = [
            [{}, /"productId" is required/],
            [{ productId: "nano-vm", quantity: 0 }, /"quantity" must be at least 1/],
            [{ productId: "nano-vm", quantity: -3 }, /"quantity" must be at least 1/],
            [{ productId: "nano-vm", quantity: 1.5 }, /"quantity" must be a whole number/],
            [{ productId: "nano-vm", quantity: "lots" }, /"quantity" must be a whole number/],
            [{ productId: "nano-vm", dataCenter: "Tokyo" }, /"dataCenter" must be one of/],
            [{ productId: "nano-vm", operatingSystem: "Windows" }, /"operatingSystem" must be one of/],
        ];
        for (const [args, message] of cases) {
            const out = await text(page, "add_to_cart", args);
            expect(out, JSON.stringify(args)).toMatch(/^Invalid input: /);
            expect(out, JSON.stringify(args)).toMatch(message);
        }
        expect(await text(page, "add_to_cart", { productId: "no-such-thing" })).toBe("Could not add it: That product no longer exists.");
        expect(await cartLines(page)).toEqual([]);
    });

    test("VM lines get the same options as the page, defaults included", async ({ page }) => {
        await text(page, "add_to_cart", { productId: "standard-vm" });
        await text(page, "add_to_cart", { productId: "standard-vm", dataCenter: "Fortaleza", operatingSystem: "Debian 12" });
        const lines = await cartLines(page);
        expect(lines.map(l => l.options)).toEqual([
            { "Data center": "São Paulo", OS: "Ubuntu 24.04 LTS" },
            { "Data center": "Fortaleza", OS: "Debian 12" },
        ]);
        // The Add button with the page's default choices lands on the same line.
        await page.goto("vms.html");
        await addToCart(page, "Standard VM");
        const after = await cartLines(page);
        expect(after).toHaveLength(2);
        expect(after[0].qty).toBe(2);
    });

    test("VPN plans take an exit country; VM options are ignored for them", async ({ page }) => {
        await text(page, "add_to_cart", { productId: "family-vpn", exitCountry: "Portugal", dataCenter: "Fortaleza" });
        await text(page, "add_to_cart", { productId: "personal-vpn" });
        expect((await cartLines(page)).map(l => l.options)).toEqual([{ "Exit country": "Portugal" }, { "Exit country": "Brazil" }]);
    });

    test("add-ons carry no options", async ({ page }) => {
        await text(page, "add_to_cart", { productId: "extra-storage", dataCenter: "Fortaleza", exitCountry: "Japan" });
        expect((await cartLines(page))[0].options).toEqual({});
    });

    test("parallel calls don't lose items", async ({ page }) => {
        const results = await page.evaluate(async () => {
            const t = navigator.modelContextTesting;
            const run = args => document.modelContext?.executeTool
                ? document.modelContext.getTools().then(ts => document.modelContext.executeTool(ts.find(x => x.name === "add_to_cart"), args))
                : t.executeTool("add_to_cart", JSON.stringify(args));
            return Promise.all([
                run({ productId: "nano-vm" }), run({ productId: "daily-backups" }),
                run({ productId: "dedicated-ip" }), run({ productId: "nano-vm" }),
            ]);
        });
        expect(results.every(r => r.startsWith("Added"))).toBe(true);
        const lines = await cartLines(page);
        expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(4);
    });

    test("parallel calls can't go past the stock", async ({ page }) => {
        await page.evaluate(() => DB.update("products", "dedicated-ip", { stock: 2 }));
        await page.evaluate(() => Promise.all([1, 2, 3, 4].map(() =>
            navigator.modelContextTesting.executeTool("add_to_cart", JSON.stringify({ productId: "dedicated-ip" })))));
        expect((await cartLines(page))[0].qty).toBe(2);
    });

    test("a visitor's agent cart moves to the account after sign-in", async ({ page }) => {
        const user = await registerCustomer(page);
        await signOut(page);
        await ready(page);
        await text(page, "add_to_cart", { productId: "family-vpn" });
        await signIn(page, user.email, user.password);
        await ready(page);
        expect(await text(page, "view_cart")).toContain("Family VPN");
    });
});

/* ------------------------------------------------------------------ */
test.describe("W4 view_cart and update_cart_item", () => {
    test.beforeEach(async ({ page }) => ready(page));

    test("empty cart", async ({ page }) => {
        expect(await text(page, "view_cart")).toBe("The cart is empty.");
    });

    test("view_cart gives line keys an agent can use to change quantities", async ({ page }) => {
        await text(page, "add_to_cart", { productId: "daily-backups", quantity: 2 });
        await text(page, "add_to_cart", { productId: "nano-vm" });
        const cart = JSON.parse(await text(page, "view_cart"));
        expect(cart).toMatchObject({ itemCount: 3, monthlyTotal: "R$ 35,70" });   // 2 × 7,90 + 19,90
        const backups = cart.items.find(i => i.name === "Daily backups");
        expect(await text(page, "update_cart_item", { lineKey: backups.lineKey, quantity: 5 })).toBe("Quantity is now 5.");
        expect(JSON.parse(await text(page, "view_cart")).monthlyTotal).toBe("R$ 59,40");
        expect(await text(page, "update_cart_item", { lineKey: backups.lineKey, quantity: 0 })).toBe("Removed from the cart.");
        expect(JSON.parse(await text(page, "view_cart")).items).toHaveLength(1);
    });

    test("quantities are capped at the stock", async ({ page }) => {
        await page.evaluate(() => DB.update("products", "dedicated-ip", { stock: 4 }));
        await text(page, "add_to_cart", { productId: "dedicated-ip" });
        const key = JSON.parse(await text(page, "view_cart")).items[0].lineKey;
        expect(await text(page, "update_cart_item", { lineKey: key, quantity: 50 })).toBe("Quantity is now 4. Only 4 are in stock.");
    });

    test("unknown line keys and bad quantities are refused", async ({ page }) => {
        await text(page, "add_to_cart", { productId: "nano-vm" });
        const key = JSON.parse(await text(page, "view_cart")).items[0].lineKey;
        expect(await text(page, "update_cart_item", { lineKey: "made-up", quantity: 2 }))
            .toBe('There is no cart line with key "made-up". Call view_cart to see the current keys.');
        expect(await text(page, "update_cart_item", { lineKey: key, quantity: -1 })).toMatch(/^Invalid input: "quantity" must be at least 0/);
        expect(await text(page, "update_cart_item", { lineKey: key })).toMatch(/^Invalid input: "quantity" is required/);
        expect(JSON.parse(await text(page, "view_cart")).itemCount).toBe(1);
    });

    test("the cart page updates live when the agent changes the cart", async ({ page }) => {
        await text(page, "add_to_cart", { productId: "nano-vm" });
        await page.goto("cart.html");
        await listTools(page);
        await expect(page.locator("#cart-total")).toHaveText("R$ 19,90");
        await text(page, "add_to_cart", { productId: "nano-vm" });
        await expect(page.locator("#cart-total")).toHaveText("R$ 39,80");
    });
});

/* ------------------------------------------------------------------ */
test.describe("W5 go_to_checkout", () => {
    test("empty cart: stays on the page", async ({ page }) => {
        await ready(page);
        expect(await text(page, "go_to_checkout")).toBe("The cart is empty, so there is nothing to pay for.");
        await expect(page).toHaveURL(/index\.html$/);
    });

    test("customer: opens the payment form and leaves paying to the person", async ({ page }) => {
        await registerCustomer(page);
        await ready(page);
        await text(page, "add_to_cart", { productId: "nano-vm" });
        const out = await call(page, "go_to_checkout");
        if (out.result) expect(out.result).toMatch(/Opening the payment page: 1 item, R\$ 19,90 per month\. The user will enter the card and confirm\./);
        await expect(page).toHaveURL(/cart\.html#payment$/);
        await expect(page.locator("#pay-form")).toBeVisible();
        await expect(page.locator("#order-done")).toBeHidden();      // nothing was paid
    });

    test("visitor: the agent is told the person must sign in first", async ({ page }) => {
        await ready(page);
        await text(page, "add_to_cart", { productId: "nano-vm" });
        const out = await call(page, "go_to_checkout");
        if (out.result) expect(out.result).toMatch(/sign in/i);
        await expect(page).toHaveURL(/cart\.html#payment$/);
        await expect(page.locator("#pay-signin")).toBeVisible();
    });

    test("admin: refused, administrators can't place orders", async ({ page }) => {
        await signInAsAdmin(page);
        await listTools(page, 7);
        await text(page, "add_to_cart", { productId: "nano-vm" });
        expect(await text(page, "go_to_checkout")).toMatch(/Administrator accounts can't place orders/);
        await expect(page).toHaveURL(/admin-products\.html/);
    });
});

/* ------------------------------------------------------------------ */
test.describe("W6 set_stock (admins)", () => {
    test.beforeEach(async ({ page }) => {
        await signInAsAdmin(page);
        await listTools(page, 7);
    });

    test("changes stock and the admin table shows it", async ({ page }) => {
        expect(await text(page, "set_stock", { productId: "gpu-vm", stock: 3 })).toBe("GPU VM now has 3 in stock.");
        await page.reload();
        await expect(page.locator("#stock-gpu-vm")).toHaveValue("3");
    });

    test("bad input is refused and nothing changes", async ({ page }) => {
        expect(await text(page, "set_stock", { productId: "gpu-vm", stock: -5 })).toMatch(/^Invalid input: "stock" must be at least 0/);
        expect(await text(page, "set_stock", { productId: "gpu-vm", stock: 2.5 })).toMatch(/^Invalid input: "stock" must be a whole number/);
        expect(await text(page, "set_stock", { productId: "gpu-vm" })).toMatch(/^Invalid input: "stock" is required/);
        expect(await text(page, "set_stock", { productId: "nope", stock: 1 })).toBe('There is no product with id "nope".');
        expect(await stockOf(page, "gpu-vm")).toBe(0);
    });

    test("stops working once the admin signs out in another tab", async ({ page, context }) => {
        const other = await context.newPage();
        await prepare(other);
        await other.goto("index.html");
        await other.evaluate(() => Auth.logout());
        expect(await text(page, "set_stock", { productId: "gpu-vm", stock: 9 })).toBe("Only administrators can change stock.");
        expect(await stockOf(page, "gpu-vm")).toBe(0);
    });
});
