/**
 * Tests for modules/server-logo.js — server icon & color customization.
 *
 * Validates:
 *   - initServerLogo attaches right-click handler to .icon-strip-home
 *   - Popover opens on contextmenu and contains expected UI structure
 *   - Emoji palette renders all icon categories with emoji buttons
 *   - Color swatches are rendered (dark-mode palette + custom picker)
 *   - Selecting an emoji updates the logo <img> src to a data URL
 *   - Selecting a color swatch sets #top-bar background and server-color-* classes
 *   - Custom color picker fires and activates correctly
 *   - Default button resets logo, favicon, and top bar color
 *   - Escape / outside-click closes the popover
 *   - getServerLogoUrl / getServerFaviconUrl return expected values
 *   - renderIconCanvas (via emoji selection) produces a data:image/png URL
 *   - Top bar always gets server-color-dark class for the muted palette
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock canvas context — jsdom doesn't implement canvas
// ---------------------------------------------------------------------------

var _capturedFillStyle = "";

function createMockCanvasCtx() {
  _capturedFillStyle = "";
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    set fillStyle(v) { _capturedFillStyle = v; },
    get fillStyle() { return _capturedFillStyle; },
    set font(v) {},
    get font() { return ""; },
    set textAlign(v) {},
    get textAlign() { return "center"; },
    set textBaseline(v) {},
    get textBaseline() { return "middle"; },
  };
}

// Patch HTMLCanvasElement.prototype.getContext before any imports
var _mockCtx = createMockCanvasCtx();
var origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === "2d") return _mockCtx;
  return origGetContext.call(this, type);
};

// Patch toDataURL to return a deterministic data URL
var _toDataCallCount = 0;
HTMLCanvasElement.prototype.toDataURL = function () {
  _toDataCallCount++;
  return "data:image/png;base64,MOCK_" + _toDataCallCount;
};

// ---------------------------------------------------------------------------
// Mock the two imports server-logo.js needs
// ---------------------------------------------------------------------------

vi.mock("../lib/public/modules/icons.js", function () {
  return {
    iconHtml: function (name) { return "<svg data-icon=\"" + name + "\"></svg>"; },
    refreshIcons: vi.fn(),
  };
});

vi.mock("../lib/public/modules/profile.js", function () {
  return {
    showAvatarPositioner: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Stub fetch globally
// ---------------------------------------------------------------------------

var fetchSpy;

function setupFetchStub() {
  fetchSpy = vi.fn(function () {
    return Promise.resolve({
      json: function () { return Promise.resolve({ type: "default" }); },
      ok: true,
    });
  });
  global.fetch = fetchSpy;
}

// ---------------------------------------------------------------------------
// DOM scaffolding — matches the elements server-logo.js looks for
// ---------------------------------------------------------------------------

function buildDom() {
  // Icon strip home button (top-left logo)
  var home = document.createElement("div");
  home.className = "icon-strip-home";
  var logo = document.createElement("img");
  logo.className = "icon-strip-logo";
  logo.src = "icon-banded-76.png";
  home.appendChild(logo);
  document.body.appendChild(home);

  // Favicon link
  var favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.type = "image/png";
  favicon.href = "favicon-banded.png";
  document.head.appendChild(favicon);

  // Top bar
  var topBar = document.createElement("div");
  topBar.id = "top-bar";
  document.body.appendChild(topBar);
}

function teardownDom() {
  document.body.innerHTML = "";
  var link = document.querySelector('link[rel="icon"]');
  if (link) link.remove();
  localStorage.clear();
}

// ---------------------------------------------------------------------------
// Import the module under test — fresh per describe via resetModules
// ---------------------------------------------------------------------------

var mod;

async function loadModule() {
  vi.resetModules();
  mod = await import("../lib/public/modules/server-logo.js");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rightClickHome() {
  var home = document.querySelector(".icon-strip-home");
  var ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  home.dispatchEvent(ev);
}

function getPopover() {
  return document.querySelector(".server-logo-popover");
}

/** Properly close the popover using the module's own Escape handler. */
function closePopover() {
  if (!getPopover()) return;
  // The setTimeout(0) registering keydown/click may be pending
  vi.runAllTimers();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("Server Logo Module", function () {
  beforeEach(async function () {
    vi.useFakeTimers();
    setupFetchStub();
    buildDom();
    _mockCtx = createMockCanvasCtx();
    _toDataCallCount = 0;
    await loadModule();
    mod.initServerLogo();
    // Let the init fetch settle
    await vi.runAllTimersAsync();
  });

  afterEach(function () {
    closePopover();
    vi.useRealTimers();
    teardownDom();
    vi.restoreAllMocks();
  });

  // ── Init & Right-Click ─────────────────────────────────────────────────

  describe("initServerLogo()", function () {
    it("sets tooltip on home icon", function () {
      var home = document.querySelector(".icon-strip-home");
      expect(home.title).toContain("Right-click");
    });

    it("fetches /api/server-logo on init", function () {
      expect(fetchSpy).toHaveBeenCalledWith("/api/server-logo");
    });
  });

  // ── Popover Structure ──────────────────────────────────────────────────

  describe("Popover", function () {
    it("opens on right-click of home icon", function () {
      expect(getPopover()).toBeNull();
      rightClickHome();
      expect(getPopover()).not.toBeNull();
    });

    it("has a header with title 'Server Icon'", function () {
      rightClickHome();
      var title = getPopover().querySelector(".server-logo-title");
      expect(title).not.toBeNull();
      expect(title.textContent).toBe("Server Icon");
    });

    it("has a preview image", function () {
      rightClickHome();
      var img = getPopover().querySelector(".server-logo-preview-img");
      expect(img).not.toBeNull();
    });

    it("has a Default button", function () {
      rightClickHome();
      var btn = getPopover().querySelector(".server-logo-option-default");
      expect(btn).not.toBeNull();
    });

    it("has an Upload button", function () {
      rightClickHome();
      var btn = getPopover().querySelector(".server-logo-upload");
      expect(btn).not.toBeNull();
    });

    it("has a hidden file input for upload", function () {
      rightClickHome();
      var inp = getPopover().querySelector("#server-logo-file");
      expect(inp).not.toBeNull();
      expect(inp.type).toBe("file");
      expect(inp.style.display).toBe("none");
    });

    it("closes on Escape key", function () {
      rightClickHome();
      expect(getPopover()).not.toBeNull();
      vi.runAllTimers();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(getPopover()).toBeNull();
    });

    it("closes on outside click", function () {
      rightClickHome();
      expect(getPopover()).not.toBeNull();
      vi.runAllTimers();
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(getPopover()).toBeNull();
    });

    it("toggles off when right-clicking home again while open", function () {
      rightClickHome();
      expect(getPopover()).not.toBeNull();
      rightClickHome();
      expect(getPopover()).toBeNull();
    });
  });

  // ── Emoji Palette ──────────────────────────────────────────────────────

  describe("Emoji Palette", function () {
    it("renders a scrollable palette container", function () {
      rightClickHome();
      var palette = getPopover().querySelector(".server-logo-palette");
      expect(palette).not.toBeNull();
    });

    it("renders category labels", function () {
      rightClickHome();
      var labels = getPopover().querySelectorAll(".server-logo-cat-label");
      expect(labels.length).toBeGreaterThanOrEqual(6);
      expect(labels[0].textContent).toBe("Tech");
    });

    it("renders emoji buttons with data-emoji attributes", function () {
      rightClickHome();
      var emojis = getPopover().querySelectorAll(".server-logo-emoji");
      expect(emojis.length).toBeGreaterThan(50);
      emojis.forEach(function (btn) {
        expect(btn.dataset.emoji).toBeTruthy();
      });
    });

    it("clicking an emoji sets the logo to a data:image/png URL", function () {
      rightClickHome();
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();
      var logoImg = document.querySelector(".icon-strip-logo");
      expect(logoImg.src).toContain("data:image/png");
    });

    it("clicking an emoji marks it active", function () {
      rightClickHome();
      var emojis = getPopover().querySelectorAll(".server-logo-emoji");
      emojis[0].click();
      expect(emojis[0].classList.contains("server-logo-emoji-active")).toBe(true);

      emojis[5].click();
      expect(emojis[0].classList.contains("server-logo-emoji-active")).toBe(false);
      expect(emojis[5].classList.contains("server-logo-emoji-active")).toBe(true);
    });

    it("clicking an emoji updates the favicon", function () {
      rightClickHome();
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();
      var faviconEl = document.querySelector('link[rel="icon"]');
      expect(faviconEl.href).toContain("data:image/png");
    });

    it("clicking an emoji sends save request to API", function () {
      rightClickHome();
      fetchSpy.mockClear();
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();

      var putCalls = fetchSpy.mock.calls.filter(function (c) {
        return c[0] === "/api/server-logo" && c[1] && c[1].method === "PUT";
      });
      expect(putCalls.length).toBe(1);
      var body = JSON.parse(putCalls[0][1].body);
      expect(body.type).toBe("emoji");
      expect(body.emoji).toBeTruthy();
    });
  });

  // ── Color Swatches ─────────────────────────────────────────────────────

  describe("Color Swatches", function () {
    it("renders 16 palette swatches", function () {
      rightClickHome();
      var swatches = getPopover().querySelectorAll(".server-logo-color-swatch");
      expect(swatches.length).toBe(16);
    });

    it("all palette colors are dark-mode-friendly (max channel <= 77)", function () {
      rightClickHome();
      var swatches = getPopover().querySelectorAll(".server-logo-color-swatch");
      swatches.forEach(function (s) {
        var hex = s.dataset.color.replace("#", "");
        var r = parseInt(hex.substring(0, 2), 16);
        var g = parseInt(hex.substring(2, 4), 16);
        var b = parseInt(hex.substring(4, 6), 16);
        var maxChan = Math.max(r, g, b);
        expect(maxChan).toBeLessThanOrEqual(77);
      });
    });

    it("clicking a swatch sets #top-bar background and server-color-dark class", function () {
      rightClickHome();
      var swatch = getPopover().querySelector(".server-logo-color-swatch");
      swatch.click();

      var topBar = document.getElementById("top-bar");
      // jsdom normalizes hex to rgb() — just check it's non-empty
      expect(topBar.style.background).not.toBe("");
      expect(topBar.classList.contains("server-color-dark")).toBe(true);
      expect(topBar.classList.contains("server-color-active")).toBe(true);
    });

    it("clicking a swatch marks it active and clears others", function () {
      rightClickHome();
      var swatches = getPopover().querySelectorAll(".server-logo-color-swatch");
      swatches[0].click();
      expect(swatches[0].classList.contains("server-logo-color-active")).toBe(true);

      swatches[3].click();
      expect(swatches[0].classList.contains("server-logo-color-active")).toBe(false);
      expect(swatches[3].classList.contains("server-logo-color-active")).toBe(true);
    });

    it("clicking a swatch re-renders emoji icon if emoji is active", function () {
      rightClickHome();
      // Select an emoji first
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();
      var logoImg = document.querySelector(".icon-strip-logo");
      var srcBefore = logoImg.src;

      // Change color
      var swatches = getPopover().querySelectorAll(".server-logo-color-swatch");
      swatches[7].click();
      var srcAfter = logoImg.src;

      // data URL should differ because the canvas mock counter incremented
      expect(srcAfter).toContain("data:image/png");
      expect(srcAfter).not.toBe(srcBefore);
    });

    it("clicking a swatch stores color in localStorage", function () {
      rightClickHome();
      var swatch = getPopover().querySelector(".server-logo-color-swatch");
      swatch.click();
      expect(localStorage.getItem("clay-server-color")).toBe(swatch.dataset.color);
    });
  });

  // ── Custom Color Picker ────────────────────────────────────────────────

  describe("Custom Color Picker", function () {
    it("renders the color picker input and swatch wrapper", function () {
      rightClickHome();
      var wrap = getPopover().querySelector(".server-logo-color-picker-wrap");
      var input = getPopover().querySelector(".server-logo-color-input");
      expect(wrap).not.toBeNull();
      expect(input).not.toBeNull();
      expect(input.type).toBe("color");
    });

    it("picker input event activates the picker wrap and clears preset swatches", function () {
      rightClickHome();
      var swatch = getPopover().querySelector(".server-logo-color-swatch");
      swatch.click();
      expect(swatch.classList.contains("server-logo-color-active")).toBe(true);

      var input = getPopover().querySelector(".server-logo-color-input");
      input.value = "#220033";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(swatch.classList.contains("server-logo-color-active")).toBe(false);
      var wrap = getPopover().querySelector(".server-logo-color-picker-wrap");
      expect(wrap.classList.contains("server-logo-color-active")).toBe(true);
    });

    it("picker input updates the visual swatch background", function () {
      rightClickHome();
      var input = getPopover().querySelector(".server-logo-color-input");
      input.value = "#553311";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      var visualSwatch = getPopover().querySelector(".server-logo-color-picker-swatch");
      // jsdom normalizes hex → rgb(); verify it changed from the default
      expect(visualSwatch.style.background).not.toBe("");
      expect(visualSwatch.style.background).toContain("rgb");
    });

    it("picker input sets top bar background", function () {
      rightClickHome();
      var input = getPopover().querySelector(".server-logo-color-input");
      input.value = "#110033";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      var topBar = document.getElementById("top-bar");
      expect(topBar.style.background).not.toBe("");
    });
  });

  // ── Default Button ─────────────────────────────────────────────────────

  describe("Default Button", function () {
    it("resets logo to default Clay icon", function () {
      rightClickHome();
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();
      var logoImg = document.querySelector(".icon-strip-logo");
      expect(logoImg.src).toContain("data:image/png");

      var defaultBtn = getPopover().querySelector(".server-logo-option-default");
      defaultBtn.click();
      expect(logoImg.src).toContain("icon-banded-76.png");
    });

    it("resets favicon to default", function () {
      rightClickHome();
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();

      var defaultBtn = getPopover().querySelector(".server-logo-option-default");
      defaultBtn.click();

      var faviconEl = document.querySelector('link[rel="icon"]');
      expect(faviconEl.href).toContain("favicon-banded.png");
    });

    it("clears top bar color", function () {
      rightClickHome();
      var swatch = getPopover().querySelector(".server-logo-color-swatch");
      swatch.click();
      var topBar = document.getElementById("top-bar");
      expect(topBar.style.background).not.toBe("");

      var defaultBtn = getPopover().querySelector(".server-logo-option-default");
      defaultBtn.click();
      expect(topBar.style.background).toBe("");
      expect(topBar.classList.contains("server-color-active")).toBe(false);
    });

    it("clears all color swatch active states including custom picker", function () {
      rightClickHome();
      var swatch = getPopover().querySelector(".server-logo-color-swatch");
      swatch.click();

      var defaultBtn = getPopover().querySelector(".server-logo-option-default");
      defaultBtn.click();

      var active = getPopover().querySelectorAll(".server-logo-color-active");
      expect(active.length).toBe(0);

      var pickerWrap = getPopover().querySelector(".server-logo-color-picker-wrap");
      expect(pickerWrap.classList.contains("server-logo-color-active")).toBe(false);
    });

    it("removes localStorage cache entries", function () {
      rightClickHome();
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();
      expect(localStorage.getItem("clay-server-logo")).not.toBeNull();

      var defaultBtn = getPopover().querySelector(".server-logo-option-default");
      defaultBtn.click();
      expect(localStorage.getItem("clay-server-logo")).toBeNull();
      expect(localStorage.getItem("clay-server-color")).toBeNull();
    });
  });

  // ── Public Getters ─────────────────────────────────────────────────────

  describe("Public API", function () {
    it("getServerFaviconUrl returns default when no logo set", function () {
      expect(mod.getServerFaviconUrl()).toBe("favicon-banded.png");
    });

    it("getServerLogoUrl returns empty string when no logo set", function () {
      expect(mod.getServerLogoUrl()).toBe("");
    });
  });

  // ── server-logo-changed Event ──────────────────────────────────────────

  describe("Custom Event", function () {
    it("dispatches server-logo-changed when emoji is selected", function () {
      var received = null;
      window.addEventListener("server-logo-changed", function handler(e) {
        received = e.detail;
        window.removeEventListener("server-logo-changed", handler);
      });
      rightClickHome();
      var emoji = getPopover().querySelector(".server-logo-emoji");
      emoji.click();

      expect(received).not.toBeNull();
      expect(received.url).toContain("data:image/png");
    });
  });
});
