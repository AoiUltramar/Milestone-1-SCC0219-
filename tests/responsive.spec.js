// Runs on a phone-sized screen (see the "phone" project in playwright.config.js).
const { test, expect } = require("@playwright/test");
const { prepare, productCard } = require("./helpers");

test.beforeEach(async ({ page }) => prepare(page));

const pages = ["index", "vms", "vpn", "addons", "cart", "login", "about", "trial"];

for (const name of pages) {
    test(`${name}.html fits the screen and has no script errors`, async ({ page }) => {
        const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${name}.html`);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("h1")).toHaveCount(1);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);       // no sideways scrolling
        expect(errors).toEqual([]);
    });
}

test("buying works on a phone", async ({ page }) => {
    await page.goto("vpn.html");
    await productCard(page, "Personal VPN").getByRole("button", { name: /Add/ }).tap();
    await expect(page.locator(".cart-count")).toHaveText("1");
});
