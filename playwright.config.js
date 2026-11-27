// Playwright configuration. `npm test` starts the Node.js server on port 8081
// with a separate test database ("cacheandcarry_test"), then runs tests/*.spec.js.
//
// It needs MongoDB running (default mongodb://127.0.0.1:27017; set MONGO_URL to
// change it). The tests empty and re-seed ONLY the test database.
const fs = require("fs");
const { defineConfig, devices } = require("@playwright/test");

const PORT = 8081;

// WebMCP is behind a flag, and Playwright's bundled Chromium is too old for it.
// The "webmcp" project uses a system Chrome/Chromium 146+ instead; set
// WEBMCP_CHROME to its path, or it uses /usr/bin/chromium when that exists.
const webmcpChrome = process.env.WEBMCP_CHROME ||
    ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find(p => fs.existsSync(p));
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

module.exports = defineConfig({
    testDir: "./tests",
    // One shared database, so the tests run one after another.
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "api",
            testMatch: /api\.spec\.js/,
        },
        {
            name: "desktop",
            testIgnore: /(api|responsive|webmcp)\.spec\.js/,
            use: { ...devices["Desktop Chrome"], launchOptions },
        },
        {
            name: "phone",
            testMatch: /responsive\.spec\.js/,
            use: { ...devices["Pixel 7"], launchOptions },
        },
        ...(webmcpChrome ? [{
            name: "webmcp",
            testMatch: /webmcp\.spec\.js/,
            use: { ...devices["Desktop Chrome"],
                   launchOptions: { executablePath: webmcpChrome,
                                    args: ["--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport"] } },
        }] : []),
    ],
    webServer: {
        command: "node server/index.js",
        env: { PORT: String(PORT), DB_NAME: process.env.TEST_DB_NAME || "cacheandcarry_test", CC_TEST: "1" },
        url: `http://localhost:${PORT}/api/products`,
        reuseExistingServer: false,
        timeout: 30000,
    },
});
