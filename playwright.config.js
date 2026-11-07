// Playwright configuration: starts a local web server and runs tests/*.spec.js
// in Chromium. Run with:  npm test
const fs = require("fs");
const { defineConfig, devices } = require("@playwright/test");

// WebMCP is behind a flag, and Playwright's bundled Chromium is too old for it.
// The "webmcp" project uses a system Chrome/Chromium 146+ instead; set
// WEBMCP_CHROME to its path, or it uses /usr/bin/chromium when that exists.
const webmcpChrome = process.env.WEBMCP_CHROME ||
    ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find(p => fs.existsSync(p));

module.exports = defineConfig({
    testDir: "./tests",
    fullyParallel: true,
    retries: 0,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: "http://localhost:8080/html/",
        trace: "retain-on-failure",
        // Google Fonts aren't needed for tests; skipping them keeps runs fast offline.
    },
    projects: [
        {
            name: "desktop",
            testIgnore: /(responsive|webmcp)\.spec\.js/,
            use: { ...devices["Desktop Chrome"],
                   launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {} },
        },
        {
            name: "phone",
            testMatch: /responsive\.spec\.js/,
            use: { ...devices["Pixel 7"],
                   launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {} },
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
        command: "npx http-server . -p 8080 -c-1 --silent",
        url: "http://localhost:8080/html/index.html",
        reuseExistingServer: true,
    },
});
