/**
 * Tests for modules/mobile-mode.js — reading vs typing mode detection.
 *
 * Validates:
 *   - Mobile detection via matchMedia
 *   - Focus/blur toggles .mobile-typing class
 *   - Desktop focus does NOT trigger typing mode
 *   - matchMedia change events update mobile state
 *   - Exported query helpers (isMobile, isTypingMode)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initMobileMode, isMobile, isTypingMode, isPanelOpen } from "../lib/public/modules/mobile-mode.js";

// ── Helpers ──────────────────────────────────────────────────────────────

var _mqlListeners = [];
var _mqlMatches = false;

function createMockMatchMedia(matches) {
  _mqlMatches = matches;
  _mqlListeners = [];

  // Mock window.matchMedia
  window.matchMedia = vi.fn(function () {
    return {
      get matches() { return _mqlMatches; },
      addEventListener: function (_event, fn) {
        _mqlListeners.push(fn);
      },
      removeEventListener: function () {},
    };
  });
}

/** Simulate a matchMedia change (e.g. viewport resize crossing 768px). */
function fireMqlChange(matches) {
  _mqlMatches = matches;
  _mqlListeners.forEach(function (fn) {
    fn({ matches: matches });
  });
}

function createMockApi() {
  var appEl = document.createElement("div");
  appEl.id = "app";
  document.body.appendChild(appEl);

  var inputEl = document.createElement("textarea");
  inputEl.id = "input";
  document.body.appendChild(inputEl);

  return {
    $: function (id) { return document.getElementById(id); },
    inputEl: inputEl,
    _appEl: appEl,
  };
}

function cleanup() {
  var appEl = document.getElementById("app");
  if (appEl) appEl.remove();
  var inputEl = document.getElementById("input");
  if (inputEl) inputEl.remove();
}

// ── Test Suites ──────────────────────────────────────────────────────────

describe("Mobile Mode Detection", function () {
  var api;

  afterEach(function () {
    cleanup();
  });

  // ── Mobile state detection ──────────────────────────────────────────

  describe("isMobile()", function () {
    it("returns true when viewport matches mobile breakpoint", function () {
      createMockMatchMedia(true);
      api = createMockApi();
      initMobileMode(api);
      expect(isMobile()).toBe(true);
    });

    it("returns false when viewport is wider than mobile breakpoint", function () {
      createMockMatchMedia(false);
      api = createMockApi();
      initMobileMode(api);
      expect(isMobile()).toBe(false);
    });

    it("updates when viewport crosses the breakpoint", function () {
      createMockMatchMedia(false);
      api = createMockApi();
      initMobileMode(api);
      expect(isMobile()).toBe(false);

      fireMqlChange(true);
      expect(isMobile()).toBe(true);

      fireMqlChange(false);
      expect(isMobile()).toBe(false);
    });
  });

  // ── Typing mode ─────────────────────────────────────────────────────

  describe("Typing mode (mobile + input focused)", function () {
    it("adds .mobile-typing to #app when input is focused on mobile", function () {
      createMockMatchMedia(true);
      api = createMockApi();
      initMobileMode(api);

      api.inputEl.dispatchEvent(new Event("focus"));
      expect(api._appEl.classList.contains("mobile-typing")).toBe(true);
    });

    it("removes .mobile-typing when input loses focus", function () {
      createMockMatchMedia(true);
      api = createMockApi();
      initMobileMode(api);

      api.inputEl.dispatchEvent(new Event("focus"));
      expect(api._appEl.classList.contains("mobile-typing")).toBe(true);

      api.inputEl.dispatchEvent(new Event("blur"));
      expect(api._appEl.classList.contains("mobile-typing")).toBe(false);
    });

    it("isTypingMode() reflects current state", function () {
      createMockMatchMedia(true);
      api = createMockApi();
      initMobileMode(api);

      expect(isTypingMode()).toBe(false);

      api.inputEl.dispatchEvent(new Event("focus"));
      expect(isTypingMode()).toBe(true);

      api.inputEl.dispatchEvent(new Event("blur"));
      expect(isTypingMode()).toBe(false);
    });

    it("rapid focus/blur toggles resolve correctly", function () {
      createMockMatchMedia(true);
      api = createMockApi();
      initMobileMode(api);

      api.inputEl.dispatchEvent(new Event("focus"));
      api.inputEl.dispatchEvent(new Event("blur"));
      api.inputEl.dispatchEvent(new Event("focus"));

      expect(api._appEl.classList.contains("mobile-typing")).toBe(true);
      expect(isTypingMode()).toBe(true);
    });
  });

  // ── Desktop: no typing mode ─────────────────────────────────────────

  describe("Desktop (no typing mode)", function () {
    it("does NOT add .mobile-typing when input is focused on desktop", function () {
      createMockMatchMedia(false);
      api = createMockApi();
      initMobileMode(api);

      api.inputEl.dispatchEvent(new Event("focus"));
      expect(api._appEl.classList.contains("mobile-typing")).toBe(false);
    });

    it("isTypingMode() returns false on desktop even when focused", function () {
      createMockMatchMedia(false);
      api = createMockApi();
      initMobileMode(api);

      api.inputEl.dispatchEvent(new Event("focus"));
      expect(isTypingMode()).toBe(false);
    });
  });

  // ── Viewport resize transitions ────────────────────────────────────

  describe("Viewport transitions", function () {
    it("entering mobile while focused immediately activates typing mode", function () {
      createMockMatchMedia(false);
      api = createMockApi();
      initMobileMode(api);

      // Focus on desktop — no typing mode
      api.inputEl.dispatchEvent(new Event("focus"));
      expect(api._appEl.classList.contains("mobile-typing")).toBe(false);

      // Viewport narrows to mobile while still focused
      fireMqlChange(true);
      expect(api._appEl.classList.contains("mobile-typing")).toBe(true);
      expect(isTypingMode()).toBe(true);
    });

    it("leaving mobile removes .mobile-typing even if input stays focused", function () {
      createMockMatchMedia(true);
      api = createMockApi();
      initMobileMode(api);

      api.inputEl.dispatchEvent(new Event("focus"));
      expect(api._appEl.classList.contains("mobile-typing")).toBe(true);

      // Viewport widens to desktop
      fireMqlChange(false);
      expect(api._appEl.classList.contains("mobile-typing")).toBe(false);
      expect(isTypingMode()).toBe(false);
    });
  });

  // ── Sidecar: rail reparenting ────────────────────────────────────────

  describe("Rail reparenting (sidecar)", function () {
    function createDomWithRail() {
      // Build the DOM structure: #app > ... > #input-wrapper > #input-row
      var appEl = document.createElement("div");
      appEl.id = "app";
      document.body.appendChild(appEl);

      var inputArea = document.createElement("div");
      inputArea.id = "input-area";
      appEl.appendChild(inputArea);

      var inputWrapper = document.createElement("div");
      inputWrapper.id = "input-wrapper";
      inputArea.appendChild(inputWrapper);

      var inputRow = document.createElement("div");
      inputRow.id = "input-row";
      inputWrapper.appendChild(inputRow);

      var inputEl = document.createElement("textarea");
      inputEl.id = "input";
      inputRow.appendChild(inputEl);

      // The rail starts inside #app (as message-nav.js creates it)
      var railEl = document.createElement("div");
      railEl.className = "msg-nav-rail";
      appEl.appendChild(railEl);

      return {
        $: function (id) { return document.getElementById(id); },
        inputEl: inputEl,
        _appEl: appEl,
        _inputWrapper: inputWrapper,
        _railEl: railEl,
      };
    }

    it("always docks rail into #input-wrapper on mobile init", function () {
      createMockMatchMedia(true);
      var ctx = createDomWithRail();
      initMobileMode(ctx);

      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });

    it("always docks rail into #input-wrapper on desktop init", function () {
      createMockMatchMedia(false);
      var ctx = createDomWithRail();
      initMobileMode(ctx);

      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });

    it("keeps rail in #input-wrapper when switching mobile ↔ desktop", function () {
      createMockMatchMedia(false);
      var ctx = createDomWithRail();
      initMobileMode(ctx);

      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);

      fireMqlChange(true);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);

      fireMqlChange(false);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });
  });

  // ── Panel-open docking (desktop) ──────────────────────────────────

  describe("Panel-open docking (desktop)", function () {
    function createDomWithPanels() {
      var appEl = document.createElement("div");
      appEl.id = "app";
      document.body.appendChild(appEl);

      var inputArea = document.createElement("div");
      inputArea.id = "input-area";
      appEl.appendChild(inputArea);

      var inputWrapper = document.createElement("div");
      inputWrapper.id = "input-wrapper";
      inputArea.appendChild(inputWrapper);

      var inputRow = document.createElement("div");
      inputRow.id = "input-row";
      inputWrapper.appendChild(inputRow);

      var inputEl = document.createElement("textarea");
      inputEl.id = "input";
      inputRow.appendChild(inputEl);

      var railEl = document.createElement("div");
      railEl.className = "msg-nav-rail";
      appEl.appendChild(railEl);

      // Panel elements (siblings of #app in real DOM, but for test
      // purposes they just need to exist in the document)
      var fileViewer = document.createElement("div");
      fileViewer.id = "file-viewer";
      fileViewer.className = "hidden";
      document.body.appendChild(fileViewer);

      var terminal = document.createElement("div");
      terminal.id = "terminal-container";
      terminal.className = "hidden";
      document.body.appendChild(terminal);

      return {
        $: function (id) { return document.getElementById(id); },
        inputEl: inputEl,
        _appEl: appEl,
        _inputWrapper: inputWrapper,
        _railEl: railEl,
        _fileViewer: fileViewer,
        _terminal: terminal,
      };
    }

    function cleanupPanels() {
      var fv = document.getElementById("file-viewer");
      if (fv) fv.remove();
      var tc = document.getElementById("terminal-container");
      if (tc) tc.remove();
    }

    afterEach(function () {
      cleanupPanels();
    });

    it("stays docked when terminal opens on desktop (always docked)", async function () {
      createMockMatchMedia(false);
      var ctx = createDomWithPanels();
      initMobileMode(ctx);

      // Already docked before panel opens
      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);

      // Simulate terminal opening
      ctx._terminal.classList.remove("hidden");
      await new Promise(function (r) { setTimeout(r, 0); });

      expect(isPanelOpen()).toBe(true);
      // Still docked
      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });

    it("stays docked when terminal closes (always docked)", async function () {
      createMockMatchMedia(false);
      var ctx = createDomWithPanels();
      initMobileMode(ctx);

      // Open terminal
      ctx._terminal.classList.remove("hidden");
      await new Promise(function (r) { setTimeout(r, 0); });
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);

      // Close terminal
      ctx._terminal.classList.add("hidden");
      await new Promise(function (r) { setTimeout(r, 0); });

      expect(isPanelOpen()).toBe(false);
      // Still docked — never undocks
      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });

    it("docks rail when file viewer opens on desktop", async function () {
      createMockMatchMedia(false);
      var ctx = createDomWithPanels();
      initMobileMode(ctx);

      ctx._fileViewer.classList.remove("hidden");
      await new Promise(function (r) { setTimeout(r, 0); });

      expect(isPanelOpen()).toBe(true);
      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });

    it("stays docked when switching from file viewer to terminal", async function () {
      createMockMatchMedia(false);
      var ctx = createDomWithPanels();
      initMobileMode(ctx);

      // Open file viewer
      ctx._fileViewer.classList.remove("hidden");
      await new Promise(function (r) { setTimeout(r, 0); });
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);

      // Switch: close file viewer, open terminal (synchronous, like real code)
      ctx._fileViewer.classList.add("hidden");
      ctx._terminal.classList.remove("hidden");
      await new Promise(function (r) { setTimeout(r, 0); });

      expect(isPanelOpen()).toBe(true);
      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });

    it("sets .nav-docked on mobile init", function () {
      createMockMatchMedia(true);
      var ctx = createDomWithPanels();
      initMobileMode(ctx);

      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
    });

    it("keeps .nav-docked when leaving mobile and no panel open (always docked)", function () {
      createMockMatchMedia(true);
      var ctx = createDomWithPanels();
      initMobileMode(ctx);

      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);

      fireMqlChange(false);
      // Still docked — never undocks
      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
    });

    it("keeps .nav-docked when leaving mobile if panel is open", async function () {
      createMockMatchMedia(true);
      var ctx = createDomWithPanels();
      initMobileMode(ctx);

      // Open terminal while on mobile
      ctx._terminal.classList.remove("hidden");
      await new Promise(function (r) { setTimeout(r, 0); });

      // Switch to desktop
      fireMqlChange(false);

      expect(ctx._appEl.classList.contains("nav-docked")).toBe(true);
      expect(ctx._railEl.parentElement).toBe(ctx._inputWrapper);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe("Edge cases", function () {
    it("handles missing inputEl gracefully", function () {
      createMockMatchMedia(true);
      var appEl = document.createElement("div");
      appEl.id = "app";
      document.body.appendChild(appEl);

      var apiNoInput = {
        $: function (id) { return document.getElementById(id); },
        inputEl: null,
      };

      // Should not throw
      expect(function () {
        initMobileMode(apiNoInput);
      }).not.toThrow();

      expect(isMobile()).toBe(true);
      expect(isTypingMode()).toBe(false);
    });

    it("handles missing #app element gracefully", function () {
      createMockMatchMedia(true);
      var inputEl = document.createElement("textarea");
      document.body.appendChild(inputEl);

      var apiNoApp = {
        $: function () { return null; },
        inputEl: inputEl,
      };

      // Should not throw
      expect(function () {
        initMobileMode(apiNoApp);
      }).not.toThrow();

      // Focus/blur should not throw either
      inputEl.dispatchEvent(new Event("focus"));
      inputEl.dispatchEvent(new Event("blur"));

      inputEl.remove();
    });
  });
});
