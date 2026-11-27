// The `test` function every spec file uses. It is Playwright's own, plus one
// automatic step: before EACH test the test database is emptied and seeded
// again, so every test starts from the same known state (10 products,
// 3 physical servers and the admin/admin account).
const base = require("@playwright/test");

const test = base.test.extend({
    resetDatabase: [async ({ request }, use) => {
        const response = await request.post("/api/test/reset");
        base.expect(response.status(), "POST /api/test/reset (is the server running with CC_TEST=1?)").toBe(204);
        await use();
    }, { auto: true }],
});

module.exports = { test, expect: base.expect };
