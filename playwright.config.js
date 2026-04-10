// Playwright E2E config for Clay Windmills feature verification.
// Point CLAY_TEST_URL at any running Clay instance to validate.
//
// Usage:
//   CLAY_TEST_URL=http://localhost:2635 npx playwright test
//   npx playwright test                       # defaults to localhost:2635

var { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.CLAY_TEST_URL || "http://localhost:2635",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile-chrome",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        isMobile: true,
      },
    },
  ],
});
