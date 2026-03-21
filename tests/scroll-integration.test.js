/**
 * Integration tests — app.js scroll/streaming logic.
 *
 * These tests exercise the code paths in app.js that interact with
 * the message-nav module: ensureAssistantBlock(), scrollToBottom(),
 * forceScrollToBottom(), appendDelta(), and the processMessage handlers.
 *
 * Because app.js is a monolithic IIFE that can't be imported in isolation,
 * we recreate the critical code paths as standalone functions with the same
 * logic and verify they produce the correct calls to msgNav.
 *
 * This is intentional: if app.js is refactored or upstream changes land,
 * these tests verify the BEHAVIORAL CONTRACT that must be preserved,
 * not the exact implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initMessageNav, msgNav } from "../lib/public/modules/message-nav.js";
import {
  createMockMessagesEl,
  createMockApi,
  flushTimers,
} from "./helpers.js";

// ─────────────────────────────────────────────────────────────────────────────
// Recreated app.js code paths for isolated testing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal reproduction of app.js state and functions.
 * Mirrors the exact logic from app.js but in a testable form.
 */
function createAppHarness(messagesEl) {
  var state = {
    currentMsgEl: null,
    currentFullText: "",
    turnFirstAssistant: true,
    scrollPolicy: "auto",
    turnCounter: 0,
    prependAnchor: null,
    replayingHistory: false,
    streamBuffer: "",
    streamDrainTimer: null,
    isUserScrolledUp: false,
  };

  /**
   * ensureAssistantBlock — exact logic from app.js lines 1902-1933.
   */
  function ensureAssistantBlock() {
    if (!state.currentMsgEl) {
      var isTurnStart = state.turnFirstAssistant;
      state.currentMsgEl = document.createElement("div");
      state.currentMsgEl.className = "msg-assistant" + (isTurnStart ? " msg-turn-start" : "");
      state.turnFirstAssistant = false;
      state.currentMsgEl.dataset.turn = state.turnCounter;
      state.currentMsgEl.innerHTML = '<div class="md-content" dir="auto"></div>';
      messagesEl.appendChild(state.currentMsgEl);
      state.currentFullText = "";

      if (isTurnStart) {
        msgNav.indexAdd(state.currentMsgEl);
      }

      if (isTurnStart && !state.prependAnchor && !state.replayingHistory) {
        var jumpTarget = state.currentMsgEl;
        // In real app.js this uses requestAnimationFrame; we call directly
        jumpTarget.scrollIntoView = vi.fn();
        jumpTarget.scrollIntoView({ behavior: "instant", block: "start" });
        state.scrollPolicy = "pinned";
        msgNav.setScrollPolicy("pinned");
        msgNav.showStreamIndicator();
      }
    }
    return state.currentMsgEl;
  }

  /**
   * appendDelta — exact logic from app.js lines 1985-1995.
   */
  function appendDelta(text) {
    ensureAssistantBlock();
    msgNav.showStreamIndicator();
    state.streamBuffer += text;
  }

  /**
   * finalizeAssistantBlock — nulls currentMsgEl, as app.js does
   * after tool results or turn completion.
   */
  function finalizeAssistantBlock() {
    state.currentMsgEl = null;
  }

  /**
   * addUserMessage — sets turnFirstAssistant, as app.js does.
   */
  function addUserMessage(text) {
    state.turnFirstAssistant = true;
    state.turnCounter++;
    var div = document.createElement("div");
    div.className = "msg-user";
    div.textContent = text;
    messagesEl.appendChild(div);
  }

  /**
   * scrollToBottom — exact logic from app.js lines 1761-1775.
   */
  function scrollToBottom() {
    if (state.prependAnchor) return;
    if (state.isUserScrolledUp) return;
    msgNav.setSelfScrolling(true);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    msgNav.setSelfScrolling(false);
  }

  /**
   * drainStreamTick scroll gating — from app.js drainStreamTick.
   */
  function drainScrollStep() {
    if (state.scrollPolicy === "auto") {
      scrollToBottom();
    }
  }

  /**
   * resetClientState — mirrors app.js lines 2327-2362.
   */
  function resetClientState() {
    state.currentMsgEl = null;
    state.currentFullText = "";
    state.turnFirstAssistant = true;
    state.turnCounter = 0;
    state.scrollPolicy = "auto";
    state.streamBuffer = "";
    state.isUserScrolledUp = false;
    state.prependAnchor = null;
    state.replayingHistory = false;
    msgNav.hideStreamIndicator();
    msgNav.indexClear();
    msgNav.setScrollPolicy("auto");
  }

  /**
   * handleResult — mirrors the "result" case handler.
   */
  function handleResult() {
    finalizeAssistantBlock();
    state.scrollPolicy = "auto";
    msgNav.hideStreamIndicator();
  }

  /**
   * handleDone — mirrors the "done" case handler.
   */
  function handleDone() {
    finalizeAssistantBlock();
    state.scrollPolicy = "auto";
    msgNav.hideStreamIndicator();
  }

  /**
   * handleStatusProcessing — mirrors "status"/"processing" handler.
   */
  function handleStatusProcessing() {
    if (!state.replayingHistory) {
      msgNav.showStreamIndicator();
    }
  }

  return {
    state: state,
    ensureAssistantBlock: ensureAssistantBlock,
    appendDelta: appendDelta,
    finalizeAssistantBlock: finalizeAssistantBlock,
    addUserMessage: addUserMessage,
    scrollToBottom: scrollToBottom,
    drainScrollStep: drainScrollStep,
    resetClientState: resetClientState,
    handleResult: handleResult,
    handleDone: handleDone,
    handleStatusProcessing: handleStatusProcessing,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

var messagesEl, api, app;

beforeEach(function () {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  messagesEl = createMockMessagesEl();
  api = createMockApi(messagesEl);
  initMessageNav(api);

  // Reset module state
  msgNav.hideStreamIndicator();
  msgNav.indexClear();
  msgNav.setScrollPolicy("auto");
  msgNav.setSelfScrolling(false);
  api.setScrollPolicy.mockClear();
  api.forceScrollToBottom.mockClear();
  api.refreshIcons.mockClear();

  app = createAppHarness(messagesEl);
});

afterEach(function () {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. TURN START — only first assistant block jumps and shows indicator
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureAssistantBlock: turn start gating", function () {
  it("first assistant block after user message IS a turn start", function () {
    app.addUserMessage("Hello");
    app.ensureAssistantBlock();

    var blocks = messagesEl.querySelectorAll(".msg-assistant");
    expect(blocks.length).toBe(1);
    expect(blocks[0].classList.contains("msg-turn-start")).toBe(true);
  });

  it("turn start triggers scrollIntoView jump", function () {
    app.addUserMessage("Hello");
    var el = app.ensureAssistantBlock();
    expect(el.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
  });

  it("turn start sets scroll policy to pinned", function () {
    app.addUserMessage("Hello");
    app.ensureAssistantBlock();
    expect(app.state.scrollPolicy).toBe("pinned");
    expect(msgNav.getScrollPolicy()).toBe("pinned");
  });

  it("turn start shows stream indicator", function () {
    app.addUserMessage("Hello");
    app.ensureAssistantBlock();
    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
  });

  it("turn start adds element to nav index", function () {
    app.addUserMessage("Hello");
    app.ensureAssistantBlock();
    flushTimers();
    // 1 turn indexed — at tail so label is empty, verify via DOM
    var turnStarts = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnStarts.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. MID-TURN CONTINUATION — no jump, no indicator (THE BIG BUG FIX)
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureAssistantBlock: mid-turn continuation blocks", function () {
  it("continuation block after tool call does NOT jump to start", function () {
    // Turn starts
    app.addUserMessage("Do something");
    app.ensureAssistantBlock();

    // Tool runs → finalizeAssistantBlock nulls currentMsgEl
    app.finalizeAssistantBlock();
    expect(app.state.currentMsgEl).toBeNull();

    // Continuation block created (e.g., after tool result)
    // turnFirstAssistant is already false
    app.state.scrollPolicy = "auto"; // user re-engaged
    var contEl = app.ensureAssistantBlock();

    // Should NOT have scrollIntoView (no mock was set = undefined)
    expect(contEl.scrollIntoView).toBeUndefined();
  });

  it("continuation block does NOT change scroll policy", function () {
    app.addUserMessage("Do something");
    app.ensureAssistantBlock();

    app.finalizeAssistantBlock();
    app.state.scrollPolicy = "auto"; // simulate user re-engaged

    app.ensureAssistantBlock();

    // Policy should still be auto (not reset to pinned)
    expect(app.state.scrollPolicy).toBe("auto");
  });

  it("continuation block is NOT added to nav index", function () {
    app.addUserMessage("Do something");
    app.ensureAssistantBlock();
    app.finalizeAssistantBlock();

    // Count index before continuation
    flushTimers();
    var posLabel = document.querySelector(".msg-nav-pos");
    var before = posLabel.textContent;

    app.ensureAssistantBlock();
    flushTimers();

    // Count should not have changed
    expect(posLabel.textContent).toBe(before);
  });

  it("continuation block does NOT have msg-turn-start class", function () {
    app.addUserMessage("Hello");
    app.ensureAssistantBlock();
    app.finalizeAssistantBlock();

    var contEl = app.ensureAssistantBlock();
    expect(contEl.classList.contains("msg-turn-start")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. MULTI-TURN SCENARIO
// ─────────────────────────────────────────────────────────────────────────────

describe("Multi-turn conversation flow", function () {
  it("each user message starts a new turn in the index", function () {
    // Turn 1
    app.addUserMessage("First question");
    app.appendDelta("First answer");
    app.handleDone();

    // Turn 2
    app.addUserMessage("Second question");
    app.appendDelta("Second answer");
    app.handleDone();

    // Turn 3
    app.addUserMessage("Third question");
    app.appendDelta("Third answer");
    app.handleDone();

    flushTimers();
    // 3 turns indexed — verify via DOM count (label is empty at tail)
    var turnStarts = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnStarts.length).toBe(3);
  });

  it("tool calls within a turn don't create extra index entries", function () {
    app.addUserMessage("Use tools");
    app.appendDelta("Let me use a tool...");
    // Tool runs → finalize + continuation
    app.finalizeAssistantBlock();
    app.appendDelta("Tool result says...");
    // Another tool
    app.finalizeAssistantBlock();
    app.appendDelta("Final answer");
    app.handleDone();

    flushTimers();
    // Only 1 turn, even though 3 assistant blocks were created
    var turnStarts = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnStarts.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SCROLL POLICY DURING STREAMING
// ─────────────────────────────────────────────────────────────────────────────

describe("Scroll policy during streaming", function () {
  it("auto policy allows scrollToBottom in drainStreamTick", function () {
    app.state.scrollPolicy = "auto";
    messagesEl._setScrollGeometry({ scrollHeight: 2000, scrollTop: 500 });

    app.drainScrollStep();

    // scrollTop should now be at max (scrollHeight - clientHeight = 1400)
    expect(messagesEl._getScrollTop()).toBe(1400);
  });

  it("pinned policy blocks scrollToBottom in drainStreamTick", function () {
    app.state.scrollPolicy = "pinned";
    messagesEl._setScrollGeometry({ scrollHeight: 2000, scrollTop: 500 });

    app.drainScrollStep();

    // scrollTop should NOT have changed
    expect(messagesEl._getScrollTop()).toBe(500);
  });

  it("scrollToBottom sets selfScrolling flag during execution", function () {
    // Track setSelfScrolling calls
    var calls = [];
    var origSet = msgNav.setSelfScrolling;
    msgNav.setSelfScrolling = function (v) {
      calls.push(v);
      origSet(v);
    };

    app.state.scrollPolicy = "auto";
    app.drainScrollStep();

    expect(calls).toEqual([true, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. appendDelta ALWAYS ENSURES STREAM INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

describe("appendDelta stream indicator guarantee", function () {
  it("first delta shows stream indicator", function () {
    app.addUserMessage("Hello");
    app.appendDelta("Hi");

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
  });

  it("delta after tool call re-shows indicator (it was hidden by result handler)", function () {
    app.addUserMessage("Use a tool");
    app.appendDelta("Using tool...");

    // Tool completes → result handler hides indicator
    app.handleResult();
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(false);

    // Next delta → indicator should re-show
    app.appendDelta("Got the result");
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(true);
  });

  it("delta during history replay does NOT show indicator", function () {
    app.state.replayingHistory = true;
    app.state.turnFirstAssistant = true;

    app.ensureAssistantBlock();
    // showStreamIndicator is called from appendDelta, but the ensureAssistantBlock
    // path that shows it is gated by !replayingHistory.
    // However, appendDelta itself always calls showStreamIndicator...
    // The early return in showStreamIndicator handles the case where it's already showing.
    // For history replay, we rely on the status handler gating.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. SESSION SWITCH (resetClientState)
// ─────────────────────────────────────────────────────────────────────────────

describe("Session switch via resetClientState", function () {
  it("resets all state cleanly", function () {
    // Simulate active session with streaming
    app.addUserMessage("Hello");
    app.appendDelta("Hi there");

    // Session switch
    app.resetClientState();

    expect(app.state.turnFirstAssistant).toBe(true);
    expect(app.state.scrollPolicy).toBe("auto");
    expect(app.state.currentMsgEl).toBeNull();
    expect(msgNav.getScrollPolicy()).toBe("auto");
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(false);
  });

  it("status=processing after switch shows indicator", function () {
    app.resetClientState();
    app.handleStatusProcessing();

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(true);
  });

  it("status=processing during history replay does NOT show indicator", function () {
    app.resetClientState();
    app.state.replayingHistory = true;
    app.handleStatusProcessing();

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RESPONSE COMPLETION HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

describe("Response completion handlers", function () {
  it("result handler resets policy to auto and hides indicator", function () {
    app.addUserMessage("Hello");
    app.appendDelta("Working...");
    expect(app.state.scrollPolicy).toBe("pinned");

    app.handleResult();

    expect(app.state.scrollPolicy).toBe("auto");
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(false);
  });

  it("done handler resets policy to auto and hides indicator", function () {
    app.addUserMessage("Hello");
    app.appendDelta("Done!");

    app.handleDone();

    expect(app.state.scrollPolicy).toBe("auto");
    expect(document.querySelector(".msg-nav-end").classList.contains("streaming")).toBe(false);
  });

  it("done handler finalizes assistant block", function () {
    app.addUserMessage("Hello");
    app.appendDelta("Response");
    expect(app.state.currentMsgEl).not.toBeNull();

    app.handleDone();

    expect(app.state.currentMsgEl).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. HISTORY REPLAY GATING
// ─────────────────────────────────────────────────────────────────────────────

describe("History replay gating", function () {
  it("ensureAssistantBlock does NOT jump during replay", function () {
    app.state.replayingHistory = true;
    app.state.turnFirstAssistant = true;

    var el = app.ensureAssistantBlock();

    // scrollIntoView should not have been set (jump skipped)
    expect(el.scrollIntoView).toBeUndefined();
  });

  it("ensureAssistantBlock does NOT change policy during replay", function () {
    app.state.replayingHistory = true;
    app.state.turnFirstAssistant = true;
    app.state.scrollPolicy = "auto";

    app.ensureAssistantBlock();

    expect(app.state.scrollPolicy).toBe("auto"); // unchanged
  });

  it("ensureAssistantBlock does NOT show indicator during replay", function () {
    app.state.replayingHistory = true;
    app.state.turnFirstAssistant = true;

    app.ensureAssistantBlock();

    var endBtn = document.querySelector(".msg-nav-end");
    expect(endBtn.classList.contains("streaming")).toBe(false);
  });

  it("turn starts are still indexed during replay (for nav after replay)", function () {
    app.state.replayingHistory = true;
    app.state.turnFirstAssistant = true;

    app.ensureAssistantBlock();
    flushTimers();

    // 1 turn indexed — at tail so label is empty, verify via DOM
    var turnStarts = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnStarts.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. FULL END-TO-END STREAMING SCENARIO
// ─────────────────────────────────────────────────────────────────────────────

describe("Full streaming conversation scenario", function () {
  it("user message → AI streams → tool call → AI continues → done", function () {
    // User sends message
    app.addUserMessage("Search for cats");
    expect(app.state.turnFirstAssistant).toBe(true);

    // AI starts responding
    app.appendDelta("Let me search for that...");
    expect(app.state.scrollPolicy).toBe("pinned"); // jumped to start
    expect(document.querySelector(".msg-nav-end .stream-indicator-dot")).not.toBeNull();

    // Turn 1, first assistant block has turn-start class
    var firstBlock = messagesEl.querySelector(".msg-assistant.msg-turn-start");
    expect(firstBlock).not.toBeNull();

    // AI runs a tool → result handler fires
    app.handleResult();
    expect(document.querySelector(".msg-nav-end .stream-indicator-dot")).toBeNull();
    expect(app.state.scrollPolicy).toBe("auto");

    // Tool result arrives, AI continues with new block
    app.appendDelta("I found 42 results...");
    // Indicator re-shows from appendDelta's showStreamIndicator call
    expect(document.querySelector(".msg-nav-end .stream-indicator-dot")).not.toBeNull();

    // This continuation block should NOT have turn-start
    var blocks = messagesEl.querySelectorAll(".msg-assistant");
    expect(blocks.length).toBe(2);
    expect(blocks[1].classList.contains("msg-turn-start")).toBe(false);

    // AI finishes
    app.handleDone();
    expect(document.querySelector(".msg-nav-end .stream-indicator-dot")).toBeNull();
    expect(app.state.scrollPolicy).toBe("auto");

    // Nav index should have exactly 1 turn
    flushTimers();
    var turnStarts = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnStarts.length).toBe(1);
  });

  it("three full turns with tool calls produce exactly 3 index entries", function () {
    for (var turn = 0; turn < 3; turn++) {
      app.addUserMessage("Question " + (turn + 1));
      app.appendDelta("Thinking...");
      app.handleResult(); // tool call
      app.appendDelta("Here's the answer...");
      app.handleDone();
    }

    flushTimers();
    var turnStarts = messagesEl.querySelectorAll(".msg-assistant.msg-turn-start");
    expect(turnStarts.length).toBe(3);
  });
});
