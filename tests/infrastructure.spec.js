const { test, expect } = require("./fixtures");
const { prepare, signInAsAdmin, productCard, registerCustomer, apiAdmin, apiBuy } = require("./helpers");

test.beforeEach(async ({ page }) => prepare(page));

test("a new GPU host increases capacity only in its data center", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/dashboard");
    await expect(page.locator("#server-rows tr")).toHaveCount(3);
    await page.locator("#server-region").selectOption("Fortaleza");
    await page.locator("#server-gpu").fill("2");
    await page.getByRole("button", { name: "Add server" }).click();
    await expect(page.locator("#server-rows tr")).toHaveCount(4);
    await page.goto("/vms");
    const gpu = productCard(page, "GPU VM");
    await expect(gpu.getByRole("button", { name: "Add GPU VM" })).toBeDisabled();
    await page.getByLabel("Data center").selectOption("Fortaleza");
    await expect(gpu.getByRole("button", { name: "Add GPU VM" })).toBeEnabled();
    await expect(gpu.getByLabel(/Quantity/)).toHaveAttribute("max", "2");
});


test("cart capacity blocks all affected VM plans and recovers when capacity is freed", async ({ page }) => {
    await page.goto("/vms");
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

test("sold-out add-ons are disabled when the cart reaches the stock limit", async ({ page, playwright, baseURL }) => {
    const admin = await apiAdmin(playwright, baseURL);
    expect((await admin.patch("/api/products/dedicated-ip", { data: { stock: 1 } })).status()).toBe(200);
    await page.goto("/addons");
    const ip = productCard(page, "Dedicated IP");
    await ip.getByRole("button", { name: /Add Dedicated IP/ }).click();
    await expect(ip.getByRole("button", { name: /Add Dedicated IP/ })).toBeDisabled();
    await expect(ip.getByLabel(/Quantity/)).toBeDisabled();
    await page.evaluate(() => Cart.clear());
    await expect(ip.getByRole("button", { name: /Add Dedicated IP/ })).toBeEnabled();
});


test("free trial is disabled in a full data center but available elsewhere", async ({ page, playwright, baseURL }) => {
    await registerCustomer(page);
    await apiBuy(playwright, baseURL, "performance-vm", 4, "São Paulo");   // another customer fills the data center
    await page.goto("/trial");
    await expect(page.locator("#trial-status")).toContainText("No trial capacity in São Paulo");
    await expect(page.getByRole("button", { name: "Start my free trial" })).toBeDisabled();
    await page.getByText("Fortaleza", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Start my free trial" })).toBeEnabled();
});
