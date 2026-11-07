// The store opened straight from disk (file://) in Firefox with its default
// setting security.fileuri.strict_origin_policy = true, as in Firefox,
// Mullvad Browser and Tor Browser. Every file then has its own storage, so
// signing in can't reach other pages. Playwright's Firefox turns that setting
// off, so the "firefox-file" project turns it back on (playwright.config.js).
// These tests check the store explains the problem instead of looping.
const path = require("path");
const { test, expect } = require("@playwright/test");

const base = "file://" + path.resolve(__dirname, "../html") + "/";

test("signing in as admin from a file page doesn't loop, and explains why", async ({ page }) => {
    const navigations = [];
    page.on("framenavigated", f => { if (f === page.mainFrame()) navigations.push(f.url().replace(base, "")); });
    await page.goto(base + "login.html");
    await page.getByLabel("Email or username").fill("admin");
    await page.locator("#login-pass").fill("admin");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#signin-error")).toContainText("npm start");
    await page.waitForTimeout(2000);
    expect(navigations).toEqual(["login.html", "admin-products.html", "login.html?next=admin-products.html&guard=1"]);
});

test("every page warns that the store must be served over http", async ({ page }) => {
    for (const file of ["index.html", "vms.html", "cart.html", "login.html"]) {
        await page.goto(base + file);
        await expect(page.getByTestId("file-mode-banner"), file).toContainText("http://localhost:8080");
    }
});
