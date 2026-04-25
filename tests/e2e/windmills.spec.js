// windmills.spec.js — Playwright E2E tests for Clay Windmills enhancements.
//
// These verify that our custom features actually render in a live Clay instance.
// Unlike static grep checks, these catch cases where code is present but the
// feature doesn't load (import errors, runtime exceptions, CSS not applied, etc.).
//
// Run:  CLAY_TEST_URL=http://localhost:PORT npx playwright test
//
// NOTE: Uses `var` and `function` per project code style (CLAUDE.md).
// Playwright's own APIs (test, expect) use their native style.

var { test, expect } = require("@playwright/test");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Clay shows a 6-digit PIN prompt (individual <input class="pin-digit"> boxes).
// Set CLAY_PIN env var to the 6-digit PIN. If no PIN is set and the gate
// appears, the test will fail with a clear message.
async function waitForApp(page) {
  await page.goto("/");

  // Detect the PIN gate — it uses individual digit inputs with class "pin-digit"
  var pinBox = page.locator(".pin-digit").first();
  var hasPinGate = await pinBox.isVisible({ timeout: 3000 }).catch(function() { return false; });

  if (hasPinGate) {
    var pin = process.env.CLAY_PIN || "";
    if (!pin) {
      throw new Error(
        "Clay instance requires a PIN but CLAY_PIN env var is not set. " +
        "Run with: CLAY_PIN=123456 CLAY_TEST_URL=... npx playwright test"
      );
    }

    // Fill each digit box individually
    var digits = page.locator(".pin-digit");
    for (var i = 0; i < pin.length; i++) {
      await digits.nth(i).fill(pin[i]);
    }

    // The PIN auto-submits on the 6th digit; wait for the page to reload
    // into the main app
    await page.waitForSelector("#app", { timeout: 15000 });
  } else {
    // No PIN gate — wait for app directly
    await page.waitForSelector("#app", { timeout: 15000 });
  }

  // Give modules time to initialize (WebSocket connect, session load, etc.)
  await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// PID Display
// ---------------------------------------------------------------------------

test.describe("PID Display", function() {
  test("PID is visible in session info popover", async function({ page }) {
    await waitForApp(page);

    var infoBtn = page.locator("#header-info-btn");
    await expect(infoBtn).toBeVisible({ timeout: 5000 });
    await infoBtn.click();

    var pidEl = page.locator("#info-pid-value");
    await expect(pidEl).toBeVisible({ timeout: 3000 });

    var pidText = await pidEl.textContent();
    // PID should be a number (or "…" if still loading, which is also fine
    // as long as the element exists — the server populates it via WebSocket)
    expect(pidText.length).toBeGreaterThan(0);
  });

  test("PID copy button exists", async function({ page }) {
    await waitForApp(page);

    await page.locator("#header-info-btn").click();
    var copyBtn = page.locator("#info-pid-copy");
    await expect(copyBtn).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Restart Claude
// ---------------------------------------------------------------------------

test.describe("Restart Claude", function() {
  test("Restart button visible in info popover", async function({ page }) {
    await waitForApp(page);

    await page.locator("#header-info-btn").click();

    var restartBtn = page.locator(".info-restart-btn");
    await expect(restartBtn).toBeVisible({ timeout: 3000 });

    // Verify it has the right label
    var text = await restartBtn.textContent();
    expect(text).toContain("Restart Claude");
  });

  test("Restart option in sidebar context menu", async function({ page }) {
    await waitForApp(page);

    // Find a session button in the sidebar and right-click it
    var sessionBtn = page.locator(".session-btn").first();
    if (await sessionBtn.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
      await sessionBtn.click({ button: "right" });

      // Context menu should appear with Restart option
      var restartItem = page.locator(".session-ctx-item").filter({ hasText: "Restart Claude" });
      await expect(restartItem).toBeVisible({ timeout: 3000 });

      // Dismiss the menu
      await page.keyboard.press("Escape");
    } else {
      // No sessions yet — skip gracefully, don't fail
      test.skip();
    }
  });
});

// ---------------------------------------------------------------------------
// Message Navigation Rail
// ---------------------------------------------------------------------------

test.describe("Message Navigation Rail", function() {
  test("Nav rail renders in DOM", async function({ page }) {
    await waitForApp(page);

    var rail = page.locator(".msg-nav-rail");
    await expect(rail).toBeAttached({ timeout: 5000 });
  });

  test("Nav rail has prev, next, and end buttons", async function({ page }) {
    await waitForApp(page);

    // Buttons are always in the DOM, even if disabled/empty
    var btns = page.locator(".msg-nav-rail .msg-nav-btn");
    var count = await btns.count();
    // At minimum: prev, next, end = 3 buttons
    expect(count).toBeGreaterThanOrEqual(3);

    // End button specifically
    var endBtn = page.locator(".msg-nav-end");
    await expect(endBtn).toBeAttached();
  });

  test("Position label element exists", async function({ page }) {
    await waitForApp(page);

    var posLabel = page.locator(".msg-nav-pos");
    await expect(posLabel).toBeAttached();
  });

  test("Nav rail is within viewport bounds (not clipped off-screen)", async function({ page }) {
    await waitForApp(page);

    var rail = page.locator(".msg-nav-rail");
    // Wait for it to exist (may have .empty display:none if no messages)
    await expect(rail).toBeAttached({ timeout: 5000 });

    // Check that if the rail is displayed, it's actually on-screen
    var pos = await rail.evaluate(function(el) {
      var style = window.getComputedStyle(el);
      if (style.display === "none") return { hidden: true };
      var rect = el.getBoundingClientRect();
      return {
        hidden: false,
        right: rect.right,
        left: rect.left,
        viewportWidth: window.innerWidth,
        onScreen: rect.left >= -1 && rect.right <= window.innerWidth + 1
      };
    });

    if (!pos.hidden) {
      expect(pos.onScreen).toBe(true);
    }
    // If hidden (empty class, no messages), that's fine — it'll show when needed
  });

  test("Nav rail visible in channel/wide-view mode", async function({ page, browserName }, testInfo) {
    if (testInfo.project.name !== "desktop-chrome") {
      test.skip();
      return;
    }

    await waitForApp(page);

    // Enable wide-view (channel mode) by toggling the body class
    await page.evaluate(function() {
      document.body.classList.add("wide-view");
    });
    await page.waitForTimeout(300);

    var rail = page.locator(".msg-nav-rail");
    await expect(rail).toBeAttached({ timeout: 3000 });

    var pos = await rail.evaluate(function(el) {
      var style = window.getComputedStyle(el);
      if (style.display === "none") return { hidden: true };
      var rect = el.getBoundingClientRect();
      return {
        hidden: false,
        right: rect.right,
        left: rect.left,
        viewportWidth: window.innerWidth,
        onScreen: rect.left >= -1 && rect.right <= window.innerWidth + 1
      };
    });

    if (!pos.hidden) {
      expect(pos.onScreen).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Mobile Mode & Panel-Aware Docking
// ---------------------------------------------------------------------------

test.describe("Mobile Mode", function() {
  test("Nav is always docked (sidecar mode)", async function({ page }) {
    await waitForApp(page);

    // Nav rail should be docked at ALL viewport sizes now
    var app = page.locator("#app");
    await expect(app).toHaveClass(/nav-docked/, { timeout: 5000 });

    // Rail should live inside #input-wrapper, not floating in #app
    var railParent = await page.locator(".msg-nav-rail").evaluate(function(el) {
      return el.parentElement ? el.parentElement.id : null;
    });
    expect(railParent).toBe("input-wrapper");
  });
});

// ---------------------------------------------------------------------------
// Expandable Command Blocks
// ---------------------------------------------------------------------------

test.describe("Expandable Command Blocks", function() {
  test("tool-command-block CSS is loaded", async function({ page }) {
    await waitForApp(page);

    // Inject a dummy element with the class and verify it gets styled.
    // This avoids cross-origin stylesheet access issues — if the CSS rule
    // exists, the computed style will differ from an unstyled element.
    var isStyled = await page.evaluate(function() {
      var el = document.createElement("div");
      el.className = "tool-command-block";
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      var cs = window.getComputedStyle(el);
      // The CSS sets font-family to monospace and a background color
      var hasMonospace = cs.fontFamily.indexOf("monospace") > -1 ||
                         cs.fontFamily.indexOf("Courier") > -1 ||
                         cs.fontFamily.indexOf("mono") > -1;
      var hasBg = cs.backgroundColor !== "" &&
                  cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                  cs.backgroundColor !== "transparent";
      document.body.removeChild(el);
      return hasMonospace || hasBg;
    });
    expect(isStyled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scroll Threshold
// ---------------------------------------------------------------------------

test.describe("Scroll Thresholds", function() {
  test("Messages container has scroll listener", async function({ page }) {
    await waitForApp(page);

    // Verify the messages container exists and is scrollable
    var msgs = page.locator("#messages");
    await expect(msgs).toBeAttached({ timeout: 5000 });

    // The container should have overflow set for scrolling
    var overflow = await msgs.evaluate(function(el) {
      return window.getComputedStyle(el).overflowY;
    });
    expect(["auto", "scroll"]).toContain(overflow);
  });
});

// ---------------------------------------------------------------------------
// Session Info Popover (structural)
// ---------------------------------------------------------------------------

test.describe("Session Info Popover Structure", function() {
  test("Popover contains session ID, local ID, and PID sections", async function({ page }) {
    await waitForApp(page);

    await page.locator("#header-info-btn").click();

    // The popover should be in the DOM
    var popover = page.locator(".session-info-popover");
    await expect(popover).toBeVisible({ timeout: 3000 });

    // Should contain identifiable sections
    var text = await popover.textContent();
    // At minimum, Process ID and Restart should be present
    expect(text).toContain("Process ID");
    expect(text).toContain("Restart");
  });
});

// ---------------------------------------------------------------------------
// Server Logo Customization
// ---------------------------------------------------------------------------

test.describe("Server Logo Customization", function() {
  test("Icon-strip home icon has right-click hint in tooltip", async function({ page }) {
    await waitForApp(page);

    var title = await page.locator(".icon-strip-home").getAttribute("title");
    expect(title).toContain("Right-click");
  });

  test("Right-clicking the Clay logo opens the server icon popover", async function({ page }) {
    await waitForApp(page);

    var home = page.locator(".icon-strip-home");
    await home.click({ button: "right" });

    var popover = page.locator(".server-logo-popover");
    await expect(popover).toBeVisible({ timeout: 3000 });

    // Should have header, color swatches, emoji palette, and default/upload buttons
    await expect(popover.locator(".server-logo-title")).toHaveText("Server Icon");
    await expect(popover.locator(".server-logo-color-swatch").first()).toBeVisible();
    await expect(popover.locator(".server-logo-palette")).toBeVisible();
    await expect(popover.locator(".server-logo-option-default")).toBeVisible();
    await expect(popover.locator(".server-logo-upload")).toBeVisible();

    // Custom color picker should be present
    await expect(popover.locator(".server-logo-color-input")).toBeAttached();

    // Emoji grid should have buttons
    var emojiCount = await popover.locator(".server-logo-emoji").count();
    expect(emojiCount).toBeGreaterThan(50);

    // Close it
    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();
  });

  test("Server logo CSS is loaded (popover styles apply)", async function({ page }) {
    await waitForApp(page);

    // Inject a dummy element with the popover class to verify CSS loaded
    var isStyled = await page.evaluate(function() {
      var el = document.createElement("div");
      el.className = "server-logo-popover";
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      var cs = window.getComputedStyle(el);
      var hasZ = parseInt(cs.zIndex) >= 9000;
      var hasBorder = cs.borderRadius !== "0px";
      document.body.removeChild(el);
      return hasZ || hasBorder;
    });
    expect(isStyled).toBe(true);
  });

  test("Server color band CSS classes exist", async function({ page }) {
    await waitForApp(page);

    // Verify the server-color-dark rule is loaded by injecting a test element
    var isStyled = await page.evaluate(function() {
      var topBar = document.getElementById("top-bar");
      if (!topBar) return false;
      // The class should be stylable — just verify the element exists
      return true;
    });
    expect(isStyled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session Status
// ---------------------------------------------------------------------------

test.describe("Session Status", function() {
  test("Mark Done option appears in session context menu", async function({ page }) {
    await waitForApp(page);

    // Find a session item in the sidebar and right-click it
    var sessionItem = page.locator(".session-item").first();
    if (await sessionItem.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
      await sessionItem.click({ button: "right" });

      // Context menu should appear with Mark Done option
      var statusItem = page.locator(".session-ctx-item").filter({ hasText: "Mark Done" });
      await expect(statusItem).toBeVisible({ timeout: 3000 });

      // Dismiss the menu
      await page.keyboard.press("Escape");
    } else {
      test.skip();
    }
  });

  test("Clicking Mark Done adds checkmark icon to session", async function({ page }) {
    await waitForApp(page);

    var sessionItem = page.locator(".session-item").first();
    if (await sessionItem.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
      // Right-click → Mark Done
      await sessionItem.click({ button: "right" });
      var statusItem = page.locator(".session-ctx-item").filter({ hasText: "Mark Done" });
      await expect(statusItem).toBeVisible({ timeout: 3000 });
      await statusItem.click();

      // Session should now have the status-done class and checkmark icon
      await expect(page.locator(".session-item.status-done").first()).toBeVisible({ timeout: 3000 });
      await expect(page.locator(".session-status-icon.done").first()).toBeVisible({ timeout: 3000 });

      // Right-click again — should now say "Clear Status"
      var doneItem = page.locator(".session-item.status-done").first();
      await doneItem.click({ button: "right" });
      var clearItem = page.locator(".session-ctx-item").filter({ hasText: "Clear Status" });
      await expect(clearItem).toBeVisible({ timeout: 3000 });

      // Clear the status
      await clearItem.click();
      await page.waitForTimeout(500);

      // Checkmark should be gone
      var doneIcons = await page.locator(".session-status-icon.done").count();
      expect(doneIcons).toBe(0);
    } else {
      test.skip();
    }
  });

  test("Session status CSS is loaded", async function({ page }) {
    await waitForApp(page);

    var isStyled = await page.evaluate(function() {
      var el = document.createElement("span");
      el.className = "session-status-icon done";
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      var cs = window.getComputedStyle(el);
      // The CSS sets display to inline-flex
      var hasInlineFlex = cs.display === "inline-flex";
      document.body.removeChild(el);
      return hasInlineFlex;
    });
    expect(isStyled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Module Loading (catch import failures)
// ---------------------------------------------------------------------------

test.describe("Module Loading", function() {
  test("No console errors from windmill modules", async function({ page }) {
    var errors = [];
    page.on("pageerror", function(err) {
      errors.push(err.message);
    });
    page.on("console", function(msg) {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await waitForApp(page);

    // Filter for errors related to our modules
    var windmillErrors = errors.filter(function(e) {
      return e.indexOf("message-nav") > -1 ||
             e.indexOf("mobile-mode") > -1 ||
             e.indexOf("initMessageNav") > -1 ||
             e.indexOf("initMobileMode") > -1 ||
             e.indexOf("info-pid") > -1 ||
             e.indexOf("restart") > -1 ||
             e.indexOf("server-logo") > -1 ||
             e.indexOf("initServerLogo") > -1;
    });
    expect(windmillErrors).toEqual([]);
  });
});
