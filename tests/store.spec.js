// Automated test script for Cache & Carry (Milestone 2).
// Each test.describe block matches a section of the Test Plan in README.md.
const { test, expect } = require("@playwright/test");
const { prepare, signIn, signInAsAdmin, registerCustomer, signOut, productCard, addToCart } = require("./helpers");

test.beforeEach(async ({ page }) => prepare(page));

/* ------------------------------------------------------------------ */
test.describe("T1 Catalog", () => {
    test("home page lists every product from the data", async ({ page }) => {
        await page.goto("index.html");
        await expect(page.locator('[data-shelf="vms"] .product')).toHaveCount(4);
        await expect(page.locator('[data-shelf="vpn"] .product')).toHaveCount(3);
        await expect(page.locator('[data-shelf="addons"] .product')).toHaveCount(3);
    });

    test("category page shows details, and sold-out products can't be added", async ({ page }) => {
        await page.goto("vms.html");
        await expect(page.locator("#plan-count")).toHaveText("4 plans");
        const gpu = productCard(page, "GPU VM");
        await expect(gpu.getByText("Sold out").first()).toBeVisible();
        await expect(gpu.getByRole("button", { name: /Add GPU VM/ })).toBeDisabled();
        await expect(productCard(page, "Standard VM").locator("dt", { hasText: "Memory" })).toBeVisible();
    });

    test("sorting by price puts the cheapest first", async ({ page }) => {
        await page.goto("vms.html");
        await page.getByLabel("Sort by").selectOption("price-asc");
        await expect(page.locator(".product h3").first()).toHaveText("Nano VM");
        await page.getByLabel("Sort by").selectOption("price-desc");
        await expect(page.locator(".product h3").first()).toHaveText("GPU VM");
    });
});

/* ------------------------------------------------------------------ */
test.describe("T2 Search", () => {
    test("finds products by name", async ({ page }) => {
        await page.goto("index.html");
        await page.getByLabel("Search plans").fill("family");
        await page.getByRole("button", { name: "Search" }).click();
        await expect(page.locator("#results-title")).toHaveText("1 result for “family”");
        await expect(page.locator("#search-results .product h3")).toHaveText("Family VPN");
    });

    test("explains when nothing matches", async ({ page }) => {
        await page.goto("index.html?q=kubernetes");
        await expect(page.locator("#results-title")).toHaveText("No results for “kubernetes”");
        await expect(page.locator("#search-results .empty")).toBeVisible();
    });
});

/* ------------------------------------------------------------------ */
test.describe("T3 Sign-in and accounts", () => {
    test("wrong password shows an error", async ({ page }) => {
        await signIn(page, "admin", "wrong-password");
        await expect(page.locator("#signin-error")).toHaveText(/email or password is incorrect/);
        await expect(page).toHaveURL(/login\.html/);
    });

    test("admin/admin opens the admin area, and sign-out works", async ({ page }) => {
        await signInAsAdmin(page);
        await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
        await signOut(page);
    });

    test("a new customer can register and is signed in", async ({ page }) => {
        await registerCustomer(page, { name: "Bruno Lima" });
        await expect(page).toHaveURL(/trial\.html/);
        await expect(page.getByRole("link", { name: "Hi, Bruno" })).toBeVisible();
    });

    test("the same email can't register twice", async ({ page }) => {
        const user = await registerCustomer(page);
        await signOut(page);
        await registerCustomer(page, { email: user.email.toUpperCase() }, { expectSuccess: false });
        await expect(page.locator("#register-error")).toHaveText(/already an account with this email/);
    });

    test("protected pages send visitors to sign in and back", async ({ page }) => {
        const user = await registerCustomer(page);
        await signOut(page);
        await page.goto("account.html");
        await expect(page).toHaveURL(/login\.html\?next=account\.html/);
        await signIn(page, user.email, user.password);
        await expect(page).toHaveURL(/account\.html$/);
    });

    test("customers can't open admin pages, and aren't bounced back and forth", async ({ page }) => {
        await registerCustomer(page);
        let navigations = 0;
        page.on("framenavigated", f => { if (f === page.mainFrame()) navigations++; });
        await page.goto("admin-products.html");
        await expect(page).toHaveURL(/login\.html\?next=admin-products\.html/);
        await expect(page.locator("#signin-error")).toContainText("needs an administrator account");
        await page.waitForTimeout(1500);
        expect(navigations).toBe(2);                       // admin page -> login, then it stays
        // Signing in with the right account goes on to the page.
        await page.getByLabel("Email or username").fill("admin");
        await page.locator("#login-pass").fill("admin");
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/admin-products\.html/);
    });

    test("an admin opening a customer page isn't bounced back and forth", async ({ page }) => {
        await signInAsAdmin(page);
        let navigations = 0;
        page.on("framenavigated", f => { if (f === page.mainFrame()) navigations++; });
        await page.goto("account.html");
        await expect(page.locator("#signin-error")).toContainText("needs a customer account");
        await page.waitForTimeout(1500);
        expect(navigations).toBe(2);
        await page.getByRole("link", { name: "go back to your own page" }).click();
        await expect(page).toHaveURL(/admin-products\.html/);
    });

    test("admin/admin from a customer-only link lands on the admin page, no loop", async ({ page }) => {
        await page.goto("login.html?next=account.html");
        let navigations = 0;
        page.on("framenavigated", f => { if (f === page.mainFrame()) navigations++; });
        await page.getByLabel("Email or username").fill("admin");
        await page.locator("#login-pass").fill("admin");
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/admin-products\.html/);
        await page.waitForTimeout(1500);
        expect(navigations).toBe(1);
    });

    test("a page any role may open is followed after sign-in", async ({ page }) => {
        await page.goto("login.html?next=cart.html");
        await page.getByLabel("Email or username").fill("admin");
        await page.locator("#login-pass").fill("admin");
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/cart\.html/);
    });

    test("customers can edit their details and password", async ({ page }) => {
        const user = await registerCustomer(page);
        await page.goto("account.html");
        await expect(page.locator("#account-title")).toHaveText("Hello, Ana!");   // form is filled in
        await page.getByLabel("Phone").fill("(16) 3333-4444");
        await page.getByText("Change password").click();
        await page.getByLabel("Current password").fill(user.password);
        await page.getByLabel("New password").fill("nova-senha-2");
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect(page.locator(".toast").last()).toHaveText(/saved/);
        await signOut(page);
        await signIn(page, user.email, "nova-senha-2");
        await expect(page).toHaveURL(/account\.html/);
        await expect(page.getByLabel("Phone")).toHaveValue("(16) 3333-4444");
    });
});

/* ------------------------------------------------------------------ */
test.describe("T4 Cart", () => {
    test("adding updates the badge and the cart page", async ({ page }) => {
        await page.goto("vpn.html");
        await productCard(page, "Personal VPN").getByLabel(/Quantity/).fill("2");
        await productCard(page, "Personal VPN").getByRole("button", { name: /Add Personal VPN/ }).click();
        await expect(page.locator(".cart-count")).toHaveText("2");
        await page.goto("cart.html");
        await expect(page.locator("#cart-lines tr")).toHaveCount(1);
        await expect(page.locator("#cart-total")).toHaveText("R$ 29,80");
    });

    test("can't add more than the stock", async ({ page }) => {
        await page.goto("vms.html");
        const card = productCard(page, "Performance VM");     // 15 in stock
        await card.getByLabel(/Quantity/).fill("20");
        await card.getByRole("button", { name: /Add Performance VM/ }).click();
        await expect(page.locator(".toast").last()).toHaveText(/Added 15 .*all we have/);
        await card.getByRole("button", { name: /Add Performance VM/ }).click();
        await expect(page.locator(".toast.error")).toHaveText(/already have all 15/);
    });

    test("VM options are kept with the cart line", async ({ page }) => {
        await page.goto("vms.html");
        await page.getByLabel("Data center").selectOption("Fortaleza");
        await page.getByLabel("Operating system").selectOption("Debian 12");
        await addToCart(page, "Nano VM");
        await page.goto("cart.html");
        await expect(page.locator("#cart-lines")).toContainText("Data center: Fortaleza · OS: Debian 12");
    });

    test("quantity can be changed and lines removed", async ({ page }) => {
        await page.goto("addons.html");
        await addToCart(page, "Daily backups");
        await addToCart(page, "Dedicated IP");
        await page.goto("cart.html");
        await page.getByLabel("Daily backups quantity").fill("3");
        await page.getByLabel("Daily backups quantity").press("Enter");
        await expect(page.locator("#cart-total")).toHaveText("R$ 33,60");     // 3 × 7,90 + 9,90
        await page.getByRole("button", { name: "Remove Dedicated IP" }).click();
        await expect(page.locator("#cart-total")).toHaveText("R$ 23,70");
        await page.getByRole("button", { name: "Empty cart" }).click();
        await expect(page.locator("#cart-empty")).toBeVisible();
    });

    test("a visitor's cart is kept after signing in", async ({ page }) => {
        const user = await registerCustomer(page);
        await signOut(page);
        await page.goto("vpn.html");
        await addToCart(page, "Family VPN");
        await signIn(page, user.email, user.password);
        await page.goto("cart.html");
        await expect(page.locator("#cart-lines")).toContainText("Family VPN");
    });
});

/* ------------------------------------------------------------------ */
test.describe("T5 Checkout", () => {
    async function fillCard(page, { number = "4111 1111 1111 1111", expiry = "12/30" } = {}) {
        await page.getByLabel("Name on card").fill("ana souza");
        await page.getByLabel("Credit card number").fill(number);
        await page.getByLabel("Expiration").fill(expiry);
        await page.getByLabel("CVV").fill("123");
    }

    test("visitors are asked to sign in before paying", async ({ page }) => {
        await page.goto("cart.html");
        await expect(page.locator("#pay-signin")).toBeVisible();
        await expect(page.locator("#pay-form")).toBeHidden();
    });

    test("paying moves stock to sold, saves the order and empties the cart", async ({ page }) => {
        await registerCustomer(page);
        await page.goto("vms.html");
        await addToCart(page, "Standard VM", 2);
        await page.goto("cart.html");
        await fillCard(page);
        await page.getByRole("button", { name: "Pay and activate" }).click();
        await expect(page.locator("#order-done")).toBeVisible();
        await expect(page.locator("#done-summary")).toContainText("R$ 99,80");
        await expect(page.locator("#done-summary")).toContainText("ending in 1111");
        await expect(page.locator(".cart-count")).toBeHidden();

        const product = await page.evaluate(() => DB.get("products", "standard-vm"));
        expect(product.stock).toBe(40);      // was 42
        expect(product.sold).toBe(514);      // was 512

        await page.goto("account.html");
        await expect(page.locator("#orders-body tr")).toHaveCount(1);
        await expect(page.locator("#orders-body")).toContainText("2 × Standard VM");
    });

    test("an expired card is rejected and nothing changes", async ({ page }) => {
        await registerCustomer(page);
        await page.goto("addons.html");
        await addToCart(page, "Extra storage");
        await page.goto("cart.html");
        await fillCard(page, { expiry: "01/20" });
        await page.getByRole("button", { name: "Pay and activate" }).click();
        await expect(page.locator("#pay-error")).toHaveText(/expired/);
        await expect(page.locator(".cart-count")).toHaveText("1");
    });

    test("checkout fails if stock ran out after adding", async ({ page }) => {
        await registerCustomer(page);
        await page.goto("addons.html");
        await addToCart(page, "Dedicated IP");
        await page.evaluate(() => DB.update("products", "dedicated-ip", { stock: 0 }));
        await page.goto("cart.html");
        await fillCard(page);
        await page.getByRole("button", { name: "Pay and activate" }).click();
        await expect(page.locator("#pay-error")).toHaveText(/Only 0 Dedicated IP left/);
    });
});

/* ------------------------------------------------------------------ */
test.describe("T6 Admin: products", () => {
    test("create, edit, restock and delete a product", async ({ page }) => {
        await signInAsAdmin(page);
        await page.getByRole("button", { name: "New product" }).click();
        await page.getByLabel("Name", { exact: true }).fill("Micro VM");
        await page.getByLabel("Price (R$)").fill("9.90");
        await page.getByLabel("Quantity in stock").fill("5");
        await page.getByLabel("Description").fill("The smallest server we sell.");
        await page.getByLabel("Specs").fill("CPU: 1 shared vCPU\nMemory: 512 MB RAM");
        await page.getByRole("button", { name: "Save product" }).click();
        await expect(page.locator("#product-rows")).toContainText("Micro VM");

        // It shows up in the store
        await page.goto("vms.html");
        await expect(productCard(page, "Micro VM")).toContainText("1 shared vCPU");

        // Edit the price
        await page.goto("admin-products.html");
        await expect(page.locator('tr[data-id="micro-vm"]')).toBeVisible();
        await page.getByRole("button", { name: "Edit Micro VM" }).click();
        await page.getByLabel("Price (R$)").fill("12");
        await page.getByRole("button", { name: "Save product" }).click();
        await expect(page.locator('tr[data-id="micro-vm"]')).toContainText("R$ 12,00");

        // Stock to zero from the table -> sold out in the store
        await page.getByLabel("Stock of Micro VM").fill("0");
        await page.getByLabel("Stock of Micro VM").press("Enter");
        await expect(page.locator(".toast").last()).toContainText("stock set to 0");
        await page.goto("vms.html");
        await expect(productCard(page, "Micro VM").getByRole("button", { name: /Add/ })).toBeDisabled();

        // Delete
        await page.goto("admin-products.html");
        await expect(page.locator('tr[data-id="micro-vm"]')).toBeVisible();
        await page.getByRole("button", { name: "Delete Micro VM" }).click();
        await expect(page.locator("#product-rows")).not.toContainText("Micro VM");
    });

    test("invalid product data is refused", async ({ page }) => {
        await signInAsAdmin(page);
        await page.getByRole("button", { name: "New product" }).click();
        await page.getByLabel("Name", { exact: true }).fill("Broken");
        await page.getByLabel("Price (R$)").fill("5");
        await page.getByLabel("Quantity in stock").fill("-3");
        await page.getByLabel("Description").fill("x");
        await page.getByRole("button", { name: "Save product" }).click();
        await expect(page.locator("#product-error")).toHaveText(/Stock must be a whole number/);
    });
});

/* ------------------------------------------------------------------ */
test.describe("T7 Admin: users", () => {
    test("register a customer who can then sign in", async ({ page }) => {
        await signInAsAdmin(page);
        await page.goto("admin-users.html");
        await expect(page.locator("#user-rows tr").first()).toBeVisible();
        await page.getByRole("button", { name: "New customer" }).click();
        await page.getByLabel("Full name").fill("Carla Dias");
        await page.getByLabel("Email").fill("carla@example.com");
        await page.getByLabel("Address").fill("Av. Paulista, 1000");
        await page.getByLabel("Password").fill("carla-123456");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.locator("#user-rows")).toContainText("Carla Dias");
        await signOut(page);
        await signIn(page, "carla@example.com", "carla-123456");
        await expect(page).toHaveURL(/account\.html/);
    });

    test("register another administrator", async ({ page }) => {
        await signInAsAdmin(page);
        await page.goto("admin-users.html");
        await expect(page.locator("#user-rows tr").first()).toBeVisible();
        await page.getByRole("tab", { name: "Administrators" }).click();
        await expect(page.locator("#user-rows")).toContainText("Administrator");
        await page.getByRole("button", { name: "New administrator" }).click();
        await page.getByLabel("Full name").fill("Luiz Santos");
        await page.getByLabel("Email").fill("luiz@example.com");
        await page.getByLabel(/Username/).fill("luiz");
        await page.getByLabel("Password").fill("luiz-123456");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.locator("#user-rows")).toContainText("Luiz Santos");
        await signOut(page);
        await signIn(page, "luiz", "luiz-123456");
        await expect(page).toHaveURL(/admin-products\.html/);
    });

    test("edit and delete a customer; the default admin is protected", async ({ page }) => {
        await registerCustomer(page, { name: "Davi Rocha" });
        await signOut(page);
        await signInAsAdmin(page);
        await page.goto("admin-users.html");
        await expect(page.locator("#user-rows tr").first()).toBeVisible();
        await page.getByRole("button", { name: "Edit Davi Rocha" }).click();
        await page.getByLabel("Full name").fill("Davi R. Rocha");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.locator("#user-rows")).toContainText("Davi R. Rocha");
        await page.getByRole("button", { name: "Delete Davi R. Rocha" }).click();
        await expect(page.locator("#user-rows")).not.toContainText("Davi");

        await page.getByRole("tab", { name: "Administrators" }).click();
        await expect(page.getByRole("button", { name: "Delete Administrator" })).toBeDisabled();
    });
});

/* ------------------------------------------------------------------ */
test.describe("T8 Free trial (our feature)", () => {
    test("visitors are told to sign in", async ({ page }) => {
        await page.goto("trial.html");
        await expect(page.locator("#trial-status")).toContainText("need to be signed in");
        await expect(page.getByRole("button", { name: "Start my free trial" })).toBeDisabled();
    });

    test("a customer starts one trial and sees it on their account", async ({ page }) => {
        await registerCustomer(page, { name: "Eva Prado" });
        await expect(page).toHaveURL(/trial\.html/);
        await page.getByText("Debian 12").click();
        await page.getByText("Fortaleza").click();
        await page.getByLabel("Server name").fill("eva-lab");
        await page.getByText("I agree to the fair use policy").click();
        await page.getByRole("button", { name: "Start my free trial" }).click();
        await expect(page).toHaveURL(/account\.html/);
        await expect(page.locator("#trial-box")).toContainText("eva-lab");
        await expect(page.locator("#trial-box")).toContainText("14 days left");
        const vm = await page.evaluate(() => DB.get("products", "standard-vm"));
        expect(vm.stock).toBe(41);          // the trial VM uses one unit of stock (was 42)

        await page.goto("trial.html");
        await expect(page.locator("#trial-status")).toContainText("already used your free trial");
    });
});

/* ------------------------------------------------------------------ */
test.describe("T9 WebMCP tools", () => {
    // Chrome only exposes WebMCP in an origin trial, so the test installs a
    // fake document.modelContext that records the registered tools.
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.__tools = {};
            document.modelContext = { registerTool: async tool => { window.__tools[tool.name] = tool; } };
        });
    });

    test("registers the store tools", async ({ page }) => {
        await page.goto("index.html");
        await page.waitForFunction(() => Object.keys(window.__tools).length >= 6);
        const names = await page.evaluate(() => Object.keys(window.__tools).sort());
        expect(names).toEqual(["add_to_cart", "get_product", "go_to_checkout", "search_products", "update_cart_item", "view_cart"]);
        const readOnly = await page.evaluate(() => window.__tools.search_products.annotations.readOnlyHint);
        expect(readOnly).toBe(true);
    });

    test("an agent can search and add to the cart, with the same stock rules", async ({ page }) => {
        await page.goto("index.html");
        await page.waitForFunction(() => window.__tools.add_to_cart);
        const found = await page.evaluate(() => window.__tools.search_products.execute({ query: "gpu" }));
        expect(found).toContain("GPU VM");
        const soldOut = await page.evaluate(() => window.__tools.add_to_cart.execute({ productId: "gpu-vm" }));
        expect(soldOut).toContain("sold out");
        const added = await page.evaluate(() =>
            window.__tools.add_to_cart.execute({ productId: "nano-vm", quantity: 2, dataCenter: "São Paulo" }));
        expect(added).toBe("Added 2 × Nano VM.");
        await expect(page.locator(".cart-count")).toHaveText("2");
    });

    test("the admin-only set_stock tool appears only for admins", async ({ page }) => {
        await signInAsAdmin(page);
        await page.waitForFunction(() => window.__tools.view_cart);
        expect(await page.evaluate(() => "set_stock" in window.__tools)).toBe(true);
        const result = await page.evaluate(() => window.__tools.set_stock.execute({ productId: "gpu-vm", stock: 3 }));
        expect(result).toBe("GPU VM now has 3 in stock.");
    });
});

/* ------------------------------------------------------------------ */
test.describe("T10 Regressions (bugs found in code review)", () => {
    test("renaming the default admin doesn't break sign-in on the next page", async ({ page }) => {
        await signInAsAdmin(page);
        await page.evaluate(() => Auth.updateUser("u-admin", { username: "root" }));
        await page.goto("index.html");
        await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
        await signOut(page);
        await signIn(page, "root", "admin");
        await expect(page).toHaveURL(/admin-products\.html/);
    });

    test("a product deleted by an admin doesn't block checkout", async ({ page }) => {
        await registerCustomer(page);
        await page.goto("addons.html");
        await addToCart(page, "Dedicated IP");
        await addToCart(page, "Daily backups");
        await page.evaluate(() => DB.remove("products", "dedicated-ip"));
        await page.goto("cart.html");
        await page.getByLabel("Name on card").fill("ana souza");
        await page.getByLabel("Credit card number").fill("4111 1111 1111 1111");
        await page.getByLabel("Expiration").fill("12/30");
        await page.getByLabel("CVV").fill("123");
        await page.getByRole("button", { name: "Pay and activate" }).click();
        await expect(page.locator("#order-done")).toBeVisible();
        await expect(page.locator("#done-summary")).toContainText("R$ 7,90");
    });

    test("a full storage reports an error instead of losing the write", async ({ page }) => {
        await page.goto("index.html");
        const message = await page.evaluate(async () => {
            Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
            try { await DB.update("products", "nano-vm", { price: 1 }); return "saved"; } catch (e) { return e.message; }
        });
        expect(message).toMatch(/quota/);
    });

    test("signing in doesn't put more than the stock in the cart", async ({ page }) => {
        const user = await registerCustomer(page);
        await page.evaluate(() => DB.update("products", "dedicated-ip", { stock: 3 }));
        await page.goto("addons.html");
        await addToCart(page, "Dedicated IP", 2);
        await signOut(page);
        await page.goto("addons.html");
        await addToCart(page, "Dedicated IP", 3);
        await signIn(page, user.email, user.password);
        await page.goto("cart.html");
        await expect(page.getByLabel("Dedicated IP quantity")).toHaveValue("3");
    });

    test("clearing a quantity box keeps the line", async ({ page }) => {
        await page.goto("addons.html");
        await addToCart(page, "Daily backups", 2);
        await page.goto("cart.html");
        await page.getByLabel("Daily backups quantity").fill("");
        await page.getByLabel("Daily backups quantity").press("Enter");
        await expect(page.getByLabel("Daily backups quantity")).toHaveValue("2");
    });

    test("deleting a customer returns their trial VM to stock", async ({ page }) => {
        const user = await registerCustomer(page);
        await page.evaluate(() => DB.transaction(({ products, trials }) => {
            const me = JSON.parse(localStorage.getItem("cc_session"));
            products.find(p => p.id === "standard-vm").stock -= 1;
            trials.push({ id: "t1", userId: me, productId: "standard-vm", endsAt: new Date(Date.now() + 864e5).toISOString() });
        }));
        await signOut(page);
        await signInAsAdmin(page);
        const id = await page.evaluate(async email => (await Auth.listUsers()).find(u => u.email === email).id, user.email);
        await page.evaluate(id => Auth.deleteUser(id), id);
        const [stock, trials] = await page.evaluate(async () =>
            [(await DB.get("products", "standard-vm")).stock, (await DB.list("trials")).length]);
        expect(stock).toBe(42);
        expect(trials).toBe(0);
    });

    test("an ended trial gives its VM back to stock", async ({ page }) => {
        await page.goto("index.html");
        await page.evaluate(() => DB.transaction(({ products, trials }) => {
            products.find(p => p.id === "standard-vm").stock -= 1;
            trials.push({ id: "t1", userId: "x", productId: "standard-vm", endsAt: new Date(Date.now() - 1000).toISOString() });
        }));
        await page.reload();
        expect((await page.evaluate(() => DB.get("products", "standard-vm"))).stock).toBe(42);
        await page.reload();     // released only once
        expect((await page.evaluate(() => DB.get("products", "standard-vm"))).stock).toBe(42);
    });
});
