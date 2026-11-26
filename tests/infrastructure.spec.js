const { test, expect } = require("@playwright/test");
const { prepare, signInAsAdmin, productCard, registerCustomer } = require("./helpers");

test.beforeEach(async ({ page }) => prepare(page));

test("a new GPU host increases capacity only in its data center", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("admin-dashboard.html");
    await expect(page.locator("#server-rows tr")).toHaveCount(3);
    await page.locator("#server-region").selectOption("Fortaleza");
    await page.locator("#server-gpu").fill("2");
    await page.getByRole("button", { name: "Add server" }).click();
    await expect(page.locator("#server-rows tr")).toHaveCount(4);
    await page.goto("vms.html");
    const gpu = productCard(page, "GPU VM");
    await expect(gpu.getByRole("button", { name: "Add GPU VM" })).toBeDisabled();
    await page.getByLabel("Data center").selectOption("Fortaleza");
    await expect(gpu.getByRole("button", { name: "Add GPU VM" })).toBeEnabled();
    await expect(gpu.getByLabel(/Quantity/)).toHaveAttribute("max", "2");
});


test("cart capacity blocks all affected VM plans and recovers when capacity is freed", async ({ page }) => {
    await page.goto("vms.html");
    const performance = productCard(page, "Performance VM");
    const standard = productCard(page, "Standard VM");
    await performance.getByLabel(/Quantity/).fill("4");
    await performance.getByRole("button", { name: /Add Performance VM/ }).click();
    await expect(standard.locator(".stock")).toHaveText("No capacity");
    await expect(standard.getByRole("button", { name: /Add Standard VM/ })).toBeDisabled();
    await expect(standard.getByLabel(/Quantity/)).toBeDisabled();
    await page.getByLabel("Data center").selectOption("Fortaleza");
    await expect(standard.getByRole("button", { name: /Add Standard VM/ })).toBeEnabled();
    await page.getByLabel("Data center").selectOption("São Paulo");
    await expect(standard.locator(".stock")).toHaveText("No capacity");
    await expect(standard.getByRole("button", { name: /Add Standard VM/ })).toBeDisabled();
    await page.evaluate(() => Cart.clear());
    await expect(standard.getByRole("button", { name: /Add Standard VM/ })).toBeEnabled();
});

test("sold-out add-ons are disabled when the cart reaches the stock limit", async ({ page }) => {
    await page.goto("addons.html");
    await page.evaluate(() => DB.update("products", "dedicated-ip", { stock: 1 }));
    await page.reload();
    const ip = productCard(page, "Dedicated IP");
    await ip.getByRole("button", { name: /Add Dedicated IP/ }).click();
    await expect(ip.getByRole("button", { name: /Add Dedicated IP/ })).toBeDisabled();
    await expect(ip.getByLabel(/Quantity/)).toBeDisabled();
    await page.evaluate(() => Cart.clear());
    await expect(ip.getByRole("button", { name: /Add Dedicated IP/ })).toBeEnabled();
});


test("free trial is disabled in a full data center but available elsewhere", async ({ page }) => {
    await registerCustomer(page);
    await page.goto("trial.html");
    await page.evaluate(() => DB.transaction(({ products, servers, subscriptions, trials }) => {
        const product = products.find(p => p.id === "performance-vm");
        const allocations = DB.allocate(DB.infrastructureState({ servers, subscriptions, trials }), product, "São Paulo", 4);
        subscriptions.push({ status: "active", allocations, endsAt: new Date(Date.now() + 86400000).toISOString() });
    }));
    await page.reload();
    await expect(page.locator("#trial-status")).toContainText("No trial capacity in São Paulo");
    await expect(page.getByRole("button", { name: "Start my free trial" })).toBeDisabled();
    await page.getByText("Fortaleza", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Start my free trial" })).toBeEnabled();
});
