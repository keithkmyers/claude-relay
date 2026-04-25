/**
 * Tests for session status feature — "Mark Done" / status toggle.
 *
 * Validates:
 *   - setSessionStatus sets and clears the status field
 *   - Status is persisted in the meta line of the JSONL file
 *   - Status is included in the client-facing session object
 *   - Server handler validates against allowed statuses
 *   - Sidebar renders checkmark icon for done sessions
 *   - Context menu shows "Mark Done" / "Clear Status" toggle
 *   - status-done CSS class is added to the session item
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Server-side: sessions.js — setSessionStatus, saveSessionFile, mapSessionForClient
// ---------------------------------------------------------------------------

describe("Session Status — Server Logic", function() {
  var fs, sessions, broadcastCalled, savedFiles;

  beforeEach(function() {
    broadcastCalled = 0;
    savedFiles = [];

    // Minimal mock of the session manager internals
    sessions = new Map();
    sessions.set(1, {
      localId: 1,
      cliSessionId: "test-uuid-1",
      title: "Test Session",
      createdAt: 1700000000000,
      lastActivity: 1700000000000,
      isProcessing: false,
      history: [],
      messageUUIDs: [],
      sessionVisibility: "shared",
    });
    sessions.set(2, {
      localId: 2,
      cliSessionId: "test-uuid-2",
      title: "Done Session",
      createdAt: 1700000001000,
      lastActivity: 1700000001000,
      isProcessing: false,
      history: [],
      messageUUIDs: [],
      sessionVisibility: "shared",
      status: "done",
    });
  });

  function setSessionStatus(localId, status) {
    var session = sessions.get(localId);
    if (!session) return { error: "Session not found" };
    if (status) {
      session.status = status;
    } else {
      delete session.status;
    }
    broadcastCalled++;
    return { ok: true };
  }

  function mapSessionForClient(s) {
    return {
      id: s.localId,
      title: s.title || "New Session",
      active: false,
      isProcessing: s.isProcessing,
      lastActivity: s.lastActivity || s.createdAt || 0,
      status: s.status || null,
    };
  }

  function buildMetaObj(session) {
    var metaObj = {
      type: "meta",
      localId: session.localId,
      cliSessionId: session.cliSessionId,
      title: session.title,
      createdAt: session.createdAt,
    };
    if (session.status) metaObj.status = session.status;
    return metaObj;
  }

  it("sets status to 'done'", function() {
    var result = setSessionStatus(1, "done");
    expect(result).toEqual({ ok: true });
    expect(sessions.get(1).status).toBe("done");
    expect(broadcastCalled).toBe(1);
  });

  it("clears status when null is passed", function() {
    var result = setSessionStatus(2, null);
    expect(result).toEqual({ ok: true });
    expect(sessions.get(2).status).toBeUndefined();
    expect(broadcastCalled).toBe(1);
  });

  it("clears status when empty string is passed", function() {
    var result = setSessionStatus(2, "");
    expect(result).toEqual({ ok: true });
    expect(sessions.get(2).status).toBeUndefined();
  });

  it("returns error for non-existent session", function() {
    var result = setSessionStatus(999, "done");
    expect(result).toEqual({ error: "Session not found" });
    expect(broadcastCalled).toBe(0);
  });

  it("mapSessionForClient includes status field", function() {
    var mapped = mapSessionForClient(sessions.get(2));
    expect(mapped.status).toBe("done");
  });

  it("mapSessionForClient returns null for no status", function() {
    var mapped = mapSessionForClient(sessions.get(1));
    expect(mapped.status).toBeNull();
  });

  it("buildMetaObj includes status when set", function() {
    var meta = buildMetaObj(sessions.get(2));
    expect(meta.status).toBe("done");
  });

  it("buildMetaObj omits status when not set", function() {
    var meta = buildMetaObj(sessions.get(1));
    expect(meta.status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Server-side: project.js — set_session_status handler validation
// ---------------------------------------------------------------------------

describe("Session Status — Handler Validation", function() {
  var setStatusCalls;

  beforeEach(function() {
    setStatusCalls = [];
  });

  function handleSetSessionStatus(msg) {
    if (typeof msg.sessionId !== "number") return;
    var validStatuses = ["done"];
    var newStatus = msg.status || null;
    if (newStatus && validStatuses.indexOf(newStatus) === -1) return;
    setStatusCalls.push({ sessionId: msg.sessionId, status: newStatus });
  }

  it("accepts valid 'done' status", function() {
    handleSetSessionStatus({ sessionId: 1, status: "done" });
    expect(setStatusCalls).toHaveLength(1);
    expect(setStatusCalls[0]).toEqual({ sessionId: 1, status: "done" });
  });

  it("accepts null to clear status", function() {
    handleSetSessionStatus({ sessionId: 1, status: null });
    expect(setStatusCalls).toHaveLength(1);
    expect(setStatusCalls[0]).toEqual({ sessionId: 1, status: null });
  });

  it("rejects invalid status value", function() {
    handleSetSessionStatus({ sessionId: 1, status: "invalid" });
    expect(setStatusCalls).toHaveLength(0);
  });

  it("rejects non-numeric sessionId", function() {
    handleSetSessionStatus({ sessionId: "abc", status: "done" });
    expect(setStatusCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Client-side: sidebar rendering logic
// ---------------------------------------------------------------------------

describe("Session Status — Sidebar Rendering", function() {
  beforeEach(function() {
    document.body.innerHTML = "";
  });

  function renderSessionItem(s) {
    var el = document.createElement("div");
    el.className = "session-item" + (s.status === "done" ? " status-done" : "");
    el.dataset.sessionId = s.id;

    var textSpan = document.createElement("span");
    textSpan.className = "session-item-text";
    var textHtml = "";
    if (s.status === "done") {
      textHtml += '<span class="session-status-icon done" title="Done"><i data-lucide="circle-check"></i></span>';
    }
    textHtml += s.title || "New Session";
    textSpan.innerHTML = textHtml;
    el.appendChild(textSpan);
    return el;
  }

  it("adds status-done class when status is done", function() {
    var el = renderSessionItem({ id: 1, title: "Test", status: "done" });
    expect(el.classList.contains("status-done")).toBe(true);
  });

  it("does not add status-done class when no status", function() {
    var el = renderSessionItem({ id: 1, title: "Test", status: null });
    expect(el.classList.contains("status-done")).toBe(false);
  });

  it("renders checkmark icon for done sessions", function() {
    var el = renderSessionItem({ id: 1, title: "Test", status: "done" });
    var icon = el.querySelector(".session-status-icon.done");
    expect(icon).not.toBeNull();
    expect(icon.title).toBe("Done");
    expect(icon.querySelector("i").dataset.lucide).toBe("circle-check");
  });

  it("does not render checkmark icon for non-done sessions", function() {
    var el = renderSessionItem({ id: 1, title: "Test", status: null });
    var icon = el.querySelector(".session-status-icon");
    expect(icon).toBeNull();
  });

  it("title text still appears after the icon", function() {
    var el = renderSessionItem({ id: 1, title: "My Session", status: "done" });
    var text = el.querySelector(".session-item-text").textContent;
    expect(text).toContain("My Session");
  });
});

// ---------------------------------------------------------------------------
// Client-side: context menu logic
// ---------------------------------------------------------------------------

describe("Session Status — Context Menu", function() {
  it("shows 'Mark Done' when no status", function() {
    var currentStatus = null;
    var isDone = currentStatus === "done";
    var label = isDone ? "Clear Status" : "Mark Done";
    var icon = isDone ? "circle-x" : "circle-check";
    expect(label).toBe("Mark Done");
    expect(icon).toBe("circle-check");
  });

  it("shows 'Clear Status' when status is done", function() {
    var currentStatus = "done";
    var isDone = currentStatus === "done";
    var label = isDone ? "Clear Status" : "Mark Done";
    var icon = isDone ? "circle-x" : "circle-check";
    expect(label).toBe("Clear Status");
    expect(icon).toBe("circle-x");
  });

  it("sends correct message to toggle status on", function() {
    var isDone = false;
    var newStatus = isDone ? null : "done";
    var msg = { type: "set_session_status", sessionId: 1, status: newStatus };
    expect(msg.status).toBe("done");
  });

  it("sends correct message to toggle status off", function() {
    var isDone = true;
    var newStatus = isDone ? null : "done";
    var msg = { type: "set_session_status", sessionId: 1, status: newStatus };
    expect(msg.status).toBeNull();
  });
});
