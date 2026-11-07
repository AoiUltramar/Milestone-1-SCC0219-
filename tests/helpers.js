// Shared steps for the tests. Each test gets a fresh browser context,
// so localStorage (our "database") starts empty and is re-seeded.
const { expect } = require("@playwright/test");

// Block web fonts and accept confirm() dialogs automatically.
async function prepare(page) {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    page.on("dialog", dialog => dialog.accept());
}

async function signIn(page, login, password) {
    await page.goto("login.html");
    await page.getByLabel("Email or username").fill(login);
    await page.locator("#login-pass").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
}

async function signInAsAdmin(page) {
    await signIn(page, "admin", "admin");
    await expect(page).toHaveURL(/admin-products\.html/);
    await expect(page.locator("#product-rows tr").first()).toBeVisible();   // page script is ready
}

let counter = 0;
// Registers a new customer and returns their details.
async function registerCustomer(page, overrides = {}, { expectSuccess = true } = {}) {
    const user = {
        name: "Ana Souza",
        email: `ana${Date.now()}${counter++}@example.com`,
        phone: "(11) 91234-5678",
        address: "Rua das Flores, 100",
        password: "senha-segura-1",
        ...overrides,
    };
    await page.goto("login.html");
    await page.getByLabel("Full name").fill(user.name);
    await page.locator("#reg-email").fill(user.email);
    await page.getByLabel("Phone").fill(user.phone);
    await page.getByLabel("Billing address").fill(user.address);
    await page.locator("#reg-pass").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    if (expectSuccess) await expect(page.getByRole("link", { name: /^Hi, / })).toBeVisible();   // wait until signed in
    return user;
}

async function signOut(page) {
    await page.getByRole("link", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

// Click a product's Add button and wait for the confirmation message.
async function addToCart(page, name, quantity) {
    const card = productCard(page, name);
    if (quantity !== undefined) await card.getByLabel(/Quantity/).fill(String(quantity));
    await card.getByRole("button", { name: new RegExp("Add " + name) }).click();
    await expect(page.locator(".toast").last()).toContainText(name);
}

const card = page => page.locator(".product", { has: page.locator("h3") });
const productCard = (page, name) => page.locator(".product").filter({ has: page.getByRole("heading", { name, exact: true }) });

module.exports = { prepare, signIn, signInAsAdmin, registerCustomer, signOut, card, productCard, addToCart };
