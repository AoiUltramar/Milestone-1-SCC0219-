// Shared steps for the tests. Each test gets a fresh browser context,
// so the database is reset by the fixture in fixtures.js.
const { expect } = require("@playwright/test");

// Block web fonts and accept confirm() dialogs automatically.
async function prepare(page) {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    page.on("dialog", dialog => dialog.accept());
}

async function signIn(page, login, password) {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");      // the screen script has attached its handlers
    await page.getByLabel("Email or username").fill(login);
    await page.locator("#login-pass").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
}

async function signInAsAdmin(page) {
    await signIn(page, "admin", "admin");
    await expect(page).toHaveURL(/\/admin\/products/);
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
    await page.goto("/login");
    await page.waitForLoadState("networkidle");      // the screen script has attached its handlers
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


/* ---------- Setup through the REST API (separate clients, own cookies) ---------- */
// The browser tests exercise the screens; things the screens can't do on
// their own (change another user's data, fill a data center) are prepared
// through the API, exactly like a second person using the store.
async function apiAdmin(playwright, baseURL) {
    const api = await playwright.request.newContext({ baseURL });
    const res = await api.post("/api/auth/login", { data: { login: "admin", password: "admin" } });
    expect(res.status()).toBe(200);
    return api;
}

// Another customer buys `qty` of a product in a data center (uses real capacity).
async function apiBuy(playwright, baseURL, productId, qty, region) {
    const api = await playwright.request.newContext({ baseURL });
    const reg = await api.post("/api/auth/register", { data: {
        name: "Other Buyer", email: `buyer${Date.now()}${counter++}@example.com`, phone: "(11) 91234-5678",
        address: { street: "Rua B, 1", city: "São Paulo", cep: "01000-000" }, password: "senha-segura-1" } });
    expect(reg.status()).toBe(201);
    const add = await api.post("/api/cart/items", { data: { productId, qty, options: { "Data center": region } } });
    expect(add.status()).toBe(201);
    const pay = await api.post("/api/orders", { data: { card: { name: "OTHER BUYER", number: "4111 1111 1111 1111", expiry: "12/99", cvv: "123" } } });
    expect(pay.status()).toBe(201);
    return api;
}

module.exports = {
    apiAdmin, apiBuy, prepare, signIn, signInAsAdmin, registerCustomer, signOut, card, productCard, addToCart };
