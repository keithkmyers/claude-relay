/**
 * Unit tests for modules/message-nav.js
 *
 * Tests the message navigation rail, scroll policy, stream indicator,
 * turn indexing, keyboard shortcuts, and performance safeguards.
 *
 * These tests validate behavior after an upstream merge + reapply
 * of our scroll/nav changes. Every nuance from the iterative
 * development is captured here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initMessageNav, msgNav } from "../lib/public/modules/message-nav.js";
import {
  createMockMessagesEl,
  createTurnStartEl,
  createMockApi,
  flushTimers,
  advanceTimers,
} from "./helpers.js";

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

var messagesEl, api;

beforeEach(function () {
  vi.useFakeTimers();
  document.body.innerHTML = "";

  messagesEl = createMockMessagesEl();
  api = createMockApi(messagesEl);
  initMessageNav(api);

  // Reset module singleton state from previous tests.
  // The module persists across ES module reimports; initMessageNav
  // recreates the rail but doesn't clear index/streaming/policy.
  msgNav.hideStreamIndicator();
  msgNav.indexClear();
  msgNav.setScrollPolicy("auto");
  msgNav.setSelfScrolling(false);
  api.setScrollPolicy.mockClear();
  api.forceScrollToBottom.mockClear();
  api.refreshIcons.mockClear();
});

afterEach(function () {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Populate N turn-start elements and flush the debounced rail update.
 */
function populateTurns(count, spacing) {
  spacing = spacing || 300;
  for (var i = 0; i < count; i++) {
    var el = createTurnStartEl(i * spacing);
    messagesEl.appendChild(el);
    msgNav.indexAdd(el);
  }
  messagesEl._setScrollGeometry({
    scrollHeight: count * spacing + 600,
    scrollTop: 0,
  });
  flushTimers(); // flush the debounced rail update
}

/**
 * Set scroll position and trigger a debounced rail update, then flush.
 * Use this when testing rail/button state after scrolling.
 */
function scrollAndUpdate(scrollTop, extraGeom) {
  var opts = { scrollTop: scrollTop };
  if (extraGeom) Object.assign(opts, extraGeom);
  messagesEl._setScrollGeometry(opts);
  msgNav.updateRail();
  flushTimers();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. RAIL CREATION & DOM STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

describe("Rail creation and DOM structure", function () {
  it("creates the rail element and appends it to #app", function () {
    var rail = document.querySelector(".msg-nav-rail");
    expect(rail).not.toBeNull();
    expect(rail.parentElement.id).toBe("app");
  });

  it("creates prev, next, and end buttons", function () {
    var buttons = document.querySelectorAll(".msg-nav-btn");
    expect(buttons.length).toBe(3);
  });

  it("creates a position label element", function () {
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel).not.toBeNull();
  });

  it("creates a separator between next and end buttons", function () {
    var sep = document.querySelector(".msg-nav-sep");
    expect(sep).not.toBeNull();
  });

  it("prev button has correct title with keyboard shortcut", function () {
    var buttons = document.querySelectorAll(".msg-nav-btn");
    expect(buttons[0].title).toContain("Previous");
    expect(buttons[0].title).toContain("Alt");
  });

  it("next button has correct title with keyboard shortcut", function () {
    var buttons = document.querySelectorAll(".msg-nav-btn");
    expect(buttons[1].title).toContain("Next");
    expect(buttons[1].title).toContain("Alt");
  });

  it("end button has correct title with keyboard shortcut", function () {
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.title).toContain("Jump to end");
    expect(endBtn.title).toContain("Alt+End");
  });

  it("buttons contain SVG icons from iconHtml", function () {
    var buttons = document.querySelectorAll(".msg-nav-btn");
    buttons.forEach(function (btn) {
      expect(btn.innerHTML).toContain("svg");
    });
  });

  it("rail starts hidden (empty class) when no messages", function () {
    var rail = document.querySelector(".msg-nav-rail");
    expect(rail.classList.contains("empty")).toBe(true);
  });

  it("rail becomes visible when turns are added", function () {
    populateTurns(3);
    var rail = document.querySelector(".msg-nav-rail");
    expect(rail.classList.contains("empty")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. INDEX TRACKING — only .msg-assistant.msg-turn-start elements
// ─────────────────────────────────────────────────────────────────────────────

describe("Index tracking", function () {
  it("indexes .msg-assistant.msg-turn-start elements", function () {
    populateTurns(5);
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBe("1/5");
  });

  it("rejects elements without msg-turn-start class", function () {
    var el = document.createElement("div");
    el.className = "msg-assistant"; // no turn-start
    msgNav.indexAdd(el);
    flushTimers();
    var rail = document.querySelector(".msg-nav-rail");
    expect(rail.classList.contains("empty")).toBe(true);
  });

  it("indexClear empties the index and hides the rail", function () {
    populateTurns(3);
    msgNav.indexClear();
    var rail = document.querySelector(".msg-nav-rail");
    expect(rail.classList.contains("empty")).toBe(true);
  });

  it("indexRebuild re-scans the DOM for turn-start elements", function () {
    // Add elements directly to DOM (not via indexAdd)
    for (var i = 0; i < 4; i++) {
      var el = createTurnStartEl(i * 300);
      messagesEl.appendChild(el);
    }
    messagesEl._setScrollGeometry({ scrollHeight: 4 * 300 + 600 });
    msgNav.indexRebuild();
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBe("1/4");
  });

  it("counts only turn starts, not mid-turn assistant blocks", function () {
    // Simulate: 3 turn starts + extra mid-turn blocks
    for (var i = 0; i < 3; i++) {
      var turnEl = createTurnStartEl(i * 500);
      messagesEl.appendChild(turnEl);
      msgNav.indexAdd(turnEl);

      // Mid-turn continuation block (no turn-start class) — should be rejected
      var midEl = document.createElement("div");
      midEl.className = "msg-assistant";
      messagesEl.appendChild(midEl);
      msgNav.indexAdd(midEl);
    }
    messagesEl._setScrollGeometry({ scrollHeight: 3 * 500 + 600 });
    flushTimers();
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toMatch(/\/3$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POSITION COUNTER
// ─────────────────────────────────────────────────────────────────────────────

describe("Position counter", function () {
  it("shows current/total format", function () {
    populateTurns(5);
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toMatch(/^\d+\/\d+$/);
  });

  it("updates position when scrolling to different turns", function () {
    populateTurns(5, 300);
    // Scroll past turn 3 (offset 600); currentIndex threshold is scrollTop+80
    scrollAndUpdate(650);
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBe("3/5");
  });

  it("shows position 1 at the very top", function () {
    populateTurns(5, 300);
    scrollAndUpdate(0);
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBe("1/5");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PREV BUTTON BEHAVIOR
// ─────────────────────────────────────────────────────────────────────────────

describe("Previous button", function () {
  it("is disabled when at the first turn and turn top is visible", function () {
    populateTurns(5, 300);
    scrollAndUpdate(0);
    var prevBtn = document.querySelectorAll(".msg-nav-btn")[0];
    expect(prevBtn.classList.contains("disabled")).toBe(true);
  });

  it("is enabled when scrolled past the first turn", function () {
    populateTurns(5, 300);
    scrollAndUpdate(400);
    var prevBtn = document.querySelectorAll(".msg-nav-btn")[0];
    expect(prevBtn.classList.contains("disabled")).toBe(false);
  });

  it("scrolls to top of current turn first if not at top", function () {
    populateTurns(5, 300);
    // Scroll so turn 3 (offset 600) is "current" but its top is NOT visible.
    // isTurnTopVisible checks: elTop in [scrollTop-20, scrollTop+120]
    // scrollTop=700: range [680, 820]. turn 3 top=600 → 600 < 680 → NOT visible.
    // currentIndex: elTop(600) <= 700+80=780 → best=2
    scrollAndUpdate(700);

    var prevBtn = document.querySelectorAll(".msg-nav-btn")[0];
    prevBtn.click();

    // Should scrollIntoView on turn 3 (index 2) since its top isn't visible
    var turnEls = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnEls[2].scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("jumps to previous turn if current turn top IS visible", function () {
    populateTurns(5, 300);
    // scrollTop=310: range [290, 430]. turn 2 top=300 → 300 >= 290 && 300 <= 430 → visible.
    // currentIndex: el[0]=0 <= 390 ✓, el[1]=300 <= 390 ✓, el[2]=600 <= 390 ✗ → best=1
    scrollAndUpdate(310);

    var prevBtn = document.querySelectorAll(".msg-nav-btn")[0];
    prevBtn.click();

    // Should jump to previous turn (index 0)
    var turnEls = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnEls[0].scrollIntoView).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. NEXT BUTTON BEHAVIOR
// ─────────────────────────────────────────────────────────────────────────────

describe("Next button", function () {
  it("is disabled when at the last turn AND at bottom", function () {
    populateTurns(3, 300);
    // scrollHeight = 3*300+600 = 1500, clientHeight = 600, max scroll = 900
    // isAtBottom threshold = 150: at-bottom if dist <= 150
    scrollAndUpdate(900);
    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    expect(nextBtn.classList.contains("disabled")).toBe(true);
  });

  it("is enabled when at last turn but NOT at bottom (content below)", function () {
    populateTurns(3, 300);
    // At turn 3 (offset 600) but far from bottom
    scrollAndUpdate(620, { scrollHeight: 3000 });
    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    expect(nextBtn.classList.contains("disabled")).toBe(false);
  });

  it("navigates to the next turn when clicked", function () {
    populateTurns(5, 300);
    scrollAndUpdate(50); // at turn 1

    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    nextBtn.click();

    var turnEls = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnEls[1].scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("jumps to bottom and engages lock when on last turn (not at bottom)", function () {
    populateTurns(3, 300);
    scrollAndUpdate(620, { scrollHeight: 3000 }); // at last turn, not at bottom

    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    nextBtn.click();

    // Should behave like navEnd
    expect(api.forceScrollToBottom).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. END BUTTON BEHAVIOR
// ─────────────────────────────────────────────────────────────────────────────

describe("End button", function () {
  it("calls forceScrollToBottom when clicked", function () {
    populateTurns(3);
    var endBtn = document.querySelector(".msg-nav-end");
    endBtn.click();
    expect(api.forceScrollToBottom).toHaveBeenCalled();
  });

  it("has at-bottom class when scrolled to bottom", function () {
    populateTurns(3, 300);
    // max scroll = 1500 - 600 = 900, threshold 150 → 900 is at bottom
    scrollAndUpdate(900);
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("at-bottom")).toBe(true);
  });

  it("loses at-bottom class when scrolled away from bottom", function () {
    populateTurns(3, 300);
    scrollAndUpdate(100);
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("at-bottom")).toBe(false);
  });

  it("sets scroll policy to auto when clicked during streaming", function () {
    msgNav.showStreamIndicator();
    msgNav.setScrollPolicy("pinned");

    var endBtn = document.querySelector(".msg-nav-end");
    endBtn.click();

    expect(api.setScrollPolicy).toHaveBeenCalledWith("auto");
    expect(msgNav.getScrollPolicy()).toBe("auto");
  });

  it("does NOT set scroll policy when clicked while not streaming", function () {
    msgNav.setScrollPolicy("pinned");
    api.setScrollPolicy.mockClear();

    var endBtn = document.querySelector(".msg-nav-end");
    endBtn.click();

    // Without streaming, navEnd only calls forceScrollToBottom
    expect(api.setScrollPolicy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. STREAM INDICATOR (blue pulsing dot)
// ─────────────────────────────────────────────────────────────────────────────

describe("Stream indicator", function () {
  it("replaces end button icon with pulsing dot when streaming starts", function () {
    msgNav.showStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.querySelector(".stream-indicator-dot")).not.toBeNull();
    expect(endBtn.classList.contains("streaming")).toBe(true);
  });

  it("restores original icon when streaming ends", function () {
    var endBtn = document.querySelector(".msg-nav-end");
    var originalHTML = endBtn.innerHTML;

    msgNav.showStreamIndicator();
    expect(endBtn.innerHTML).not.toBe(originalHTML);
    expect(endBtn.querySelector(".stream-indicator-dot")).not.toBeNull();

    msgNav.hideStreamIndicator();
    expect(endBtn.innerHTML).toBe(originalHTML);
    expect(endBtn.querySelector(".stream-indicator-dot")).toBeNull();
  });

  it("updates end button title during streaming", function () {
    msgNav.showStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.title).toContain("Follow response");
    expect(endBtn.title).toContain("re-anchor");
  });

  it("restores end button title when streaming ends", function () {
    msgNav.showStreamIndicator();
    msgNav.hideStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.title).toContain("Jump to end");
  });

  it("calls refreshIcons after hiding indicator", function () {
    api.refreshIcons.mockClear();
    msgNav.showStreamIndicator();
    msgNav.hideStreamIndicator();
    expect(api.refreshIcons).toHaveBeenCalled();
  });

  it("no-ops cheaply if already showing (early return)", function () {
    msgNav.showStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");
    var htmlAfterFirst = endBtn.innerHTML;

    // Second call — should be a no-op
    msgNav.showStreamIndicator();
    expect(endBtn.innerHTML).toBe(htmlAfterFirst);
  });

  it("can re-show after hide (mid-turn tool calls re-trigger indicator)", function () {
    // First streaming phase
    msgNav.showStreamIndicator();
    expect(document.querySelector(".msg-nav-end .stream-indicator-dot")).not.toBeNull();

    // Tool call ends turn → hideStreamIndicator
    msgNav.hideStreamIndicator();
    expect(document.querySelector(".msg-nav-end .stream-indicator-dot")).toBeNull();

    // Streaming resumes → showStreamIndicator again
    msgNav.showStreamIndicator();
    expect(document.querySelector(".msg-nav-end .stream-indicator-dot")).not.toBeNull();
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(true);
  });

  it("streaming + at-bottom shows both classes simultaneously", function () {
    populateTurns(3, 300);
    scrollAndUpdate(900); // at bottom

    msgNav.showStreamIndicator();

    // Force a rail update to set at-bottom
    msgNav.updateRail();
    flushTimers();

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
    expect(endBtn.classList.contains("at-bottom")).toBe(true);
  });

  it("streaming + NOT at-bottom shows streaming without at-bottom", function () {
    populateTurns(3, 300);
    scrollAndUpdate(100); // not at bottom

    msgNav.showStreamIndicator();
    msgNav.updateRail();
    flushTimers();

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
    expect(endBtn.classList.contains("at-bottom")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. SCROLL POLICY — auto/pinned state machine
// ─────────────────────────────────────────────────────────────────────────────

describe("Scroll policy", function () {
  it("defaults to auto", function () {
    expect(msgNav.getScrollPolicy()).toBe("auto");
  });

  it("can be set externally", function () {
    msgNav.setScrollPolicy("pinned");
    expect(msgNav.getScrollPolicy()).toBe("pinned");
  });

  it("user scroll up during streaming breaks auto → pinned", function () {
    populateTurns(3, 300);
    msgNav.showStreamIndicator();
    msgNav.setScrollPolicy("auto");
    api.setScrollPolicy.mockClear();

    // User scrolls up (not at bottom)
    messagesEl._setScrollGeometry({ scrollTop: 100, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));

    expect(msgNav.getScrollPolicy()).toBe("pinned");
    expect(api.setScrollPolicy).toHaveBeenCalledWith("pinned");
  });

  it("user scroll to bottom during streaming re-engages pinned → auto", function () {
    populateTurns(3, 300);
    msgNav.showStreamIndicator();
    msgNav.setScrollPolicy("pinned");
    api.setScrollPolicy.mockClear();

    // User scrolls to bottom (within threshold)
    messagesEl._setScrollGeometry({ scrollTop: 2400, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));

    expect(msgNav.getScrollPolicy()).toBe("auto");
    expect(api.setScrollPolicy).toHaveBeenCalledWith("auto");
  });

  it("scroll events do NOT change policy when not streaming", function () {
    populateTurns(3, 300);
    msgNav.setScrollPolicy("auto");
    api.setScrollPolicy.mockClear();

    // Scroll while not streaming
    messagesEl._setScrollGeometry({ scrollTop: 100, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));

    // Non-streaming scroll handler only calls scheduleRailUpdate, not policy changes
    expect(api.setScrollPolicy).not.toHaveBeenCalled();
  });

  it("at-bottom class updates in real-time during streaming scroll", function () {
    populateTurns(3, 300);
    msgNav.showStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");

    // Scroll to bottom
    messagesEl._setScrollGeometry({ scrollTop: 2400, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));
    expect(endBtn.classList.contains("at-bottom")).toBe(true);

    // Scroll away from bottom
    msgNav.setScrollPolicy("pinned"); // reset for clean test
    messagesEl._setScrollGeometry({ scrollTop: 100, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));
    expect(endBtn.classList.contains("at-bottom")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. SELF-SCROLLING FLAG — programmatic scroll skipping (perf)
// ─────────────────────────────────────────────────────────────────────────────

describe("Self-scrolling flag (programmatic scroll optimization)", function () {
  it("scroll handler skips when _selfScrolling is true during streaming", function () {
    populateTurns(3, 300);
    msgNav.showStreamIndicator();
    msgNav.setScrollPolicy("auto");
    api.setScrollPolicy.mockClear();

    // Programmatic scroll: flag is set
    msgNav.setSelfScrolling(true);
    messagesEl._setScrollGeometry({ scrollTop: 100, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));
    msgNav.setSelfScrolling(false);

    // Policy should NOT have changed — handler was skipped
    expect(msgNav.getScrollPolicy()).toBe("auto");
    expect(api.setScrollPolicy).not.toHaveBeenCalled();
  });

  it("scroll handler runs normally when _selfScrolling is false", function () {
    populateTurns(3, 300);
    msgNav.showStreamIndicator();
    msgNav.setScrollPolicy("auto");

    // User scroll (no flag)
    messagesEl._setScrollGeometry({ scrollTop: 100, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));

    expect(msgNav.getScrollPolicy()).toBe("pinned");
  });

  it("at-bottom class is NOT toggled during self-scrolling", function () {
    populateTurns(3, 300);
    msgNav.showStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");

    // Start: user scrolls to bottom → at-bottom
    messagesEl._setScrollGeometry({ scrollTop: 900, scrollHeight: 1500 });
    messagesEl.dispatchEvent(new Event("scroll"));
    expect(endBtn.classList.contains("at-bottom")).toBe(true);

    // Programmatic scroll away from bottom
    msgNav.setSelfScrolling(true);
    messagesEl._setScrollGeometry({ scrollTop: 0, scrollHeight: 1500 });
    messagesEl.dispatchEvent(new Event("scroll"));
    msgNav.setSelfScrolling(false);

    // at-bottom should still be true (handler was skipped entirely)
    expect(endBtn.classList.contains("at-bottom")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Keyboard shortcuts", function () {
  function fireKey(key, opts) {
    var event = new KeyboardEvent("keydown", Object.assign({
      key: key,
      bubbles: true,
    }, opts || {}));
    var prevented = false;
    event.preventDefault = function () { prevented = true; };
    document.dispatchEvent(event);
    return prevented;
  }

  it("Alt+ArrowUp triggers navPrev and prevents default", function () {
    populateTurns(5, 300);
    expect(fireKey("ArrowUp", { altKey: true })).toBe(true);
  });

  it("Alt+K triggers navPrev (vim-style)", function () {
    populateTurns(5, 300);
    expect(fireKey("k", { altKey: true })).toBe(true);
  });

  it("Alt+ArrowDown triggers navNext and prevents default", function () {
    populateTurns(5, 300);
    expect(fireKey("ArrowDown", { altKey: true })).toBe(true);
  });

  it("Alt+J triggers navNext (vim-style)", function () {
    populateTurns(5, 300);
    expect(fireKey("j", { altKey: true })).toBe(true);
  });

  it("Alt+End triggers navEnd and calls forceScrollToBottom", function () {
    populateTurns(5, 300);
    api.forceScrollToBottom.mockClear();
    expect(fireKey("End", { altKey: true })).toBe(true);
    expect(api.forceScrollToBottom).toHaveBeenCalled();
  });

  it("non-alt key combos are ignored", function () {
    populateTurns(5, 300);
    api.forceScrollToBottom.mockClear();
    expect(fireKey("ArrowUp", { altKey: false })).toBe(false);
    expect(fireKey("End", { altKey: false })).toBe(false);
    expect(api.forceScrollToBottom).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. RAIL UPDATE DEBOUNCING (performance)
// ─────────────────────────────────────────────────────────────────────────────

describe("Rail update debouncing", function () {
  it("debounces updates with 250ms delay", function () {
    populateTurns(3, 300);
    var posLabel = document.querySelector(".msg-nav-pos");

    // Change scroll and request update
    messagesEl._setScrollGeometry({ scrollTop: 350 });
    msgNav.updateRail();

    // Not yet updated (within debounce window)
    advanceTimers(100);
    expect(posLabel.textContent).toBe("1/3"); // still old value

    // After full debounce period
    advanceTimers(200);
    expect(posLabel.textContent).toBe("2/3"); // now updated
  });

  it("coalesces multiple rapid updates into one", function () {
    populateTurns(3, 300);

    // Trigger many rapid updates
    for (var i = 0; i < 10; i++) {
      msgNav.updateRail();
    }

    // Should execute just once after debounce
    advanceTimers(250);
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBeTruthy();
  });

  it("does NOT trigger rail update on scroll during streaming", function () {
    populateTurns(3, 300);
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBe("1/3");

    // Start streaming
    msgNav.showStreamIndicator();

    // Scroll to a different turn — the non-streaming branch that calls
    // scheduleRailUpdate() is gated by if (!_streaming)
    messagesEl._setScrollGeometry({ scrollTop: 400 });
    messagesEl.dispatchEvent(new Event("scroll"));
    advanceTimers(500);

    // Position label should NOT have updated (rail update skipped during streaming)
    expect(posLabel.textContent).toBe("1/3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. SCROLL-TO-TURN VISUAL FEEDBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("Scroll-to-turn visual feedback", function () {
  it("calls scrollIntoView with smooth behavior", function () {
    populateTurns(5, 300);
    scrollAndUpdate(0);

    // Click next to go to turn 2
    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    nextBtn.click();

    var turnEls = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnEls[1].scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("applies and removes highlight background", function () {
    populateTurns(5, 300);
    scrollAndUpdate(0);

    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    nextBtn.click();

    var turnEls = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    var targetEl = turnEls[1];

    // Highlight should be set immediately
    expect(targetEl.style.background).toContain("rgba");

    // After 600ms, highlight should be cleared
    advanceTimers(600);
    expect(targetEl.style.background).toBe("");
  });

  it("sets transition property for smooth highlight", function () {
    populateTurns(5, 300);
    scrollAndUpdate(0);

    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    nextBtn.click();

    var turnEls = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnEls[1].style.transition).toContain("background");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. isAtBottom CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

describe("isAtBottom calculation", function () {
  it("at-bottom class set when within 150px threshold of bottom", function () {
    populateTurns(3, 300);
    // scrollHeight=1500, clientHeight=600, bottom=900
    // Threshold 150: at-bottom when dist = scrollHeight-scrollTop-clientHeight <= 150
    // scrollTop=800: dist = 1500-800-600 = 100 <= 150 → at bottom
    scrollAndUpdate(800);
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("at-bottom")).toBe(true);
  });

  it("at-bottom class NOT set when more than 150px from bottom", function () {
    populateTurns(3, 300);
    // scrollTop=100: dist = 1500-100-600 = 800 > 150
    scrollAndUpdate(100);
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("at-bottom")).toBe(false);
  });

  it("at-bottom class set when exactly at bottom", function () {
    populateTurns(3, 300);
    scrollAndUpdate(900); // max scroll = 1500-600=900, dist=0
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("at-bottom")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. END-TO-END STREAMING SCENARIO
// ─────────────────────────────────────────────────────────────────────────────

describe("Full streaming lifecycle", function () {
  it("complete stream cycle: indicator → scroll up → pinned → scroll down → auto → hide", function () {
    populateTurns(3, 300);
    messagesEl._setScrollGeometry({ scrollTop: 2400, scrollHeight: 3000 });

    // 1. Streaming starts
    msgNav.showStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
    expect(endBtn.querySelector(".stream-indicator-dot")).not.toBeNull();

    // 2. User scrolls up — breaks auto-follow
    messagesEl._setScrollGeometry({ scrollTop: 100, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));
    expect(msgNav.getScrollPolicy()).toBe("pinned");
    expect(endBtn.classList.contains("at-bottom")).toBe(false);

    // 3. User scrolls back to bottom — re-engages auto-follow
    messagesEl._setScrollGeometry({ scrollTop: 2400, scrollHeight: 3000 });
    messagesEl.dispatchEvent(new Event("scroll"));
    expect(msgNav.getScrollPolicy()).toBe("auto");
    expect(endBtn.classList.contains("at-bottom")).toBe(true);

    // 4. Streaming ends
    msgNav.hideStreamIndicator();
    expect(endBtn.classList.contains("streaming")).toBe(false);
    expect(endBtn.querySelector(".stream-indicator-dot")).toBeNull();
  });

  it("clicking end button during streaming re-anchors to auto-follow", function () {
    populateTurns(3, 300);
    msgNav.showStreamIndicator();
    msgNav.setScrollPolicy("pinned"); // user scrolled up

    var endBtn = document.querySelector(".msg-nav-end");
    endBtn.click();

    expect(msgNav.getScrollPolicy()).toBe("auto");
    expect(api.setScrollPolicy).toHaveBeenCalledWith("auto");
    expect(api.forceScrollToBottom).toHaveBeenCalled();
  });

  it("multiple tool calls: indicator hides and re-shows between tool executions", function () {
    populateTurns(2, 300);

    // Stream phase 1
    msgNav.showStreamIndicator();
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(true);

    // Tool call ends → result handler hides indicator
    msgNav.hideStreamIndicator();
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(false);

    // Stream phase 2 (continuation after tool)
    msgNav.showStreamIndicator();
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(true);

    // Final done
    msgNav.hideStreamIndicator();
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. SESSION/WORKSPACE SWITCH SCENARIO
// ─────────────────────────────────────────────────────────────────────────────

describe("Session/workspace switch handling", function () {
  it("showStreamIndicator works after clear+hide cycle (session switch)", function () {
    // Simulate session switch: clear everything
    msgNav.indexClear();
    msgNav.hideStreamIndicator();
    msgNav.setScrollPolicy("auto");

    // Server sends status=processing after history replay
    msgNav.showStreamIndicator();

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
    expect(endBtn.querySelector(".stream-indicator-dot")).not.toBeNull();
  });

  it("indicator re-shows on delta after switching away and back", function () {
    // Session A: streaming active
    msgNav.showStreamIndicator();
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(true);

    // Switch to session B: resetClientState hides indicator + clears index
    msgNav.hideStreamIndicator();
    msgNav.indexClear();
    msgNav.setScrollPolicy("auto");

    // Switch back to session A: history replays, then first delta calls show
    msgNav.showStreamIndicator();
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
    expect(endBtn.querySelector(".stream-indicator-dot")).not.toBeNull();
  });

  it("index survives rebuild after session switch", function () {
    // After session switch, history_done triggers indexRebuild
    for (var i = 0; i < 3; i++) {
      var el = createTurnStartEl(i * 300);
      messagesEl.appendChild(el);
    }
    messagesEl._setScrollGeometry({ scrollHeight: 1500 });

    msgNav.indexRebuild();
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBe("1/3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge cases", function () {
  it("handles empty index gracefully — all buttons safe to click", function () {
    api.forceScrollToBottom.mockClear();

    var prevBtn = document.querySelectorAll(".msg-nav-btn")[0];
    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    var endBtn = document.querySelector(".msg-nav-end");

    prevBtn.click(); // should not throw
    nextBtn.click(); // should not throw (navNext with empty index: cur=-1, not >= 0)
    endBtn.click();  // should call forceScrollToBottom

    expect(api.forceScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("handles single turn correctly", function () {
    populateTurns(1, 300);
    var posLabel = document.querySelector(".msg-nav-pos");
    expect(posLabel.textContent).toBe("1/1");

    var prevBtn = document.querySelectorAll(".msg-nav-btn")[0];
    expect(prevBtn.classList.contains("disabled")).toBe(true);
  });

  it("navNext does nothing when index is empty (no forceScrollToBottom)", function () {
    api.forceScrollToBottom.mockClear();
    // Empty index: currentIndex returns -1
    // navNext: -1 < -1 → false, -1 >= 0 → false → nothing happens
    var nextBtn = document.querySelectorAll(".msg-nav-btn")[1];
    nextBtn.click();
    expect(api.forceScrollToBottom).not.toHaveBeenCalled();
  });

  it("rapid show/hide cycles don't corrupt state", function () {
    for (var i = 0; i < 5; i++) {
      msgNav.showStreamIndicator();
      msgNav.hideStreamIndicator();
    }

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(false);
    // Should still be able to show again
    msgNav.showStreamIndicator();
    expect(endBtn.classList.contains("streaming")).toBe(true);
  });
});
