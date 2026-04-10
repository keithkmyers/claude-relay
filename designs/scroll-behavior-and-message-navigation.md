# Scroll Behavior & Message Navigation

> Design document for two interrelated features in Clay's message view.

---

## Problem Statement

### 1. Forced scroll during streaming is disruptive

When the assistant is typing a response, `scrollToBottom()` is called on every
animation frame inside `drainStreamTick()` (app.js:1980). If the user is already
near the bottom (within `scrollThreshold = 150px`), they are continuously pinned
to the very end of the growing content. This makes it impossible to read earlier
paragraphs of the *current* response while it is still being written.

**Current behavior:**

```
User sends message
  -> ensureAssistantBlock() creates .msg-assistant
  -> appendDelta() buffers text
  -> drainStreamTick() renders markdown + scrollToBottom() every frame
  -> user is force-scrolled to the trailing edge of the response
```

The existing `isUserScrolledUp` check in `scrollToBottom()` does provide an
escape hatch: once the user scrolls more than 150px away from the bottom, auto-
scroll stops and a "New activity" button appears. But this means the user must
*fight* the scroll first, and there's a jarring race between their scroll input
and the next rAF call pulling them back down.

### 2. No message-level navigation

Scrolling is the only way to move between messages. In long conversations (which
are common with tool-heavy Claude Code sessions), finding a specific earlier
exchange requires freehand scrolling through potentially hundreds of tool
invocations. There is no concept of "jump to previous user message" or "jump to
next assistant response".

---

## Design Goals

| Goal | Rationale |
|------|-----------|
| **Jump-to-start on new response** | When the assistant begins responding, auto-scroll the user to the *top* of the new assistant block, not the bottom. |
| **Free scroll during streaming** | After the initial jump, the user can scroll anywhere. No more per-frame `scrollToBottom()` calls. |
| **Active-response indicator** | A persistent visual cue shows the assistant is still streaming, so the user knows more content is arriving even though the view isn't force-scrolled. |
| **Message-by-message navigation** | Vertical prev/next/end controls let the user hop between conversation turns without freehand scrolling. |
| **Responsive** | Both features must work on desktop (sidebar visible) and mobile (bottom tab bar, touch). |
| **Architectural cohesion** | The two features share a "message index" concept. Build them on a shared foundation. |

---

## Architecture Overview

```
                         MessageIndex (new)
                        ┌─────────────────┐
                        │ tracks all       │
                        │ .msg-user and    │
                        │ .msg-assistant   │
                        │ elements with    │
                        │ data-turn attrs  │
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ScrollController      MessageNav          StreamIndicator
      (replaces raw       (new component)      (new component)
       scrollToBottom)
              │                  │                  │
              ▼                  ▼                  ▼
        app.js / tools     side rail UI       floating badge
                           + keyboard          on active block
```

### New module: `modules/message-nav.js`

Single module that owns:

1. **MessageIndex** — ordered list of turn anchors (`.msg-user`, `.msg-assistant` elements with `data-turn`).
2. **ScrollController** — replaces today's raw `scrollToBottom()` with policy-aware scrolling.
3. **MessageNav UI** — the navigation rail with prev/next/end buttons.
4. **StreamIndicator** — the visual "typing" badge shown during active streaming.

This module is initialized from `app.js` the same way `tools.js`, `sidebar.js`,
etc. are today, receiving the shared API object.

---

## Feature 1: Scroll Behavior During Streaming

### New Scroll Policy

```
                    ┌────────────────────┐
                    │  User sends msg    │
                    └────────┬───────────┘
                             │
                    ┌────────▼───────────┐
                    │  Server starts     │
                    │  streaming (first  │
                    │  "delta" arrives)  │
                    └────────┬───────────┘
                             │
                ┌────────────▼────────────────┐
                │ ensureAssistantBlock()       │
                │ creates .msg-assistant       │
                │                              │
                │ ONE-TIME JUMP:               │
                │ scroll so that the TOP of    │
                │ .msg-assistant is near the   │
                │ top of the viewport          │
                │ (e.g. 40px from top)         │
                └────────────┬────────────────┘
                             │
                ┌────────────▼────────────────┐
                │ Set scrollPolicy =          │
                │   "user-free"               │
                │                              │
                │ drainStreamTick() still      │
                │ renders markdown but does    │
                │ NOT call scrollToBottom()    │
                └────────────┬────────────────┘
                             │
                ┌────────────▼────────────────┐
                │ "result" or "done" arrives  │
                │ scrollPolicy = "normal"     │
                │ StreamIndicator removed     │
                └─────────────────────────────┘
```

### Changes to `app.js`

#### A. New state variable

```js
// "auto"   — default, today's behavior (scrollToBottom when near end)
// "pinned" — initial jump done, now user-free (no auto-scroll during stream)
var scrollPolicy = "auto";
```

#### B. Modify `ensureAssistantBlock()`

When `ensureAssistantBlock()` creates a *new* element (i.e., `currentMsgEl` was
null), and we are responding to a user prompt (not replaying history):

```js
function ensureAssistantBlock() {
  if (!currentMsgEl) {
    currentMsgEl = document.createElement("div");
    currentMsgEl.className = "msg-assistant";
    currentMsgEl.dataset.turn = turnCounter;
    currentMsgEl.innerHTML = '<div class="md-content" dir="auto"></div>';
    addToMessages(currentMsgEl);
    currentFullText = "";

    // --- NEW: jump to top of this block, then free the user ---
    if (!replayingHistory) {
      requestAnimationFrame(function () {
        currentMsgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      scrollPolicy = "pinned";
      showStreamIndicator(currentMsgEl);   // badge appears
      messageIndex.add(currentMsgEl);      // register in index
    }
  }
  return currentMsgEl;
}
```

#### C. Modify `drainStreamTick()`

```js
function drainStreamTick() {
  // ... existing chunk drain logic unchanged ...

  // REPLACE:
  //   scrollToBottom();
  // WITH:
  if (scrollPolicy === "auto") {
    scrollToBottom();
  }
  // "pinned" policy: do nothing, user scrolls freely

  // ... rest unchanged ...
}
```

#### D. Modify `scrollToBottom()` callers

Other callers of `scrollToBottom()` (system messages, tool results, etc.) are
left unchanged — they still respect `isUserScrolledUp`. Only the streaming path
is gated by the new policy.

#### E. Reset policy on response end

In the `"result"` and `"done"` handlers in `processMessage()`:

```js
scrollPolicy = "auto";
hideStreamIndicator();
```

### Stream Indicator

A small floating badge attached to the assistant block showing the response is
still in progress. The existing `activity-inline` element (sparkles icon +
shimmer text like "Thinking...") already provides this during the *thinking*
phase, but it disappears when the first `delta` arrives (line 2793:
`setActivity(null)`). We need a *different* indicator that persists through the
entire streaming phase.

#### Visual Design

```
┌─ .msg-assistant ──────────────────────────────────────┐
│                                                       │
│  The assistant's markdown content is streaming in      │
│  here, growing as text arrives...                     │
│                                                       │
│                                     ┌───────────────┐ │
│                                     │ ● Responding  │ │
│                                     └───────────────┘ │
└───────────────────────────────────────────────────────┘
```

- Positioned at bottom-right of the `.msg-assistant` block (CSS `position:
  sticky; bottom: 0` within the block, or absolutely positioned).
- Small pill: pulsing dot (CSS animation) + "Responding" label.
- Accent2 color (blue) to match existing activity styling.
- Clicking it scrolls to the current bottom of the content ("jump to latest").
- Disappears on `"result"` / `"done"`.

#### CSS

```css
.stream-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent2);
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: 14px;
  cursor: pointer;
  user-select: none;
  float: right;
  margin-top: 8px;
  opacity: 0;
  animation: fadeIn 0.2s ease forwards;
}

.stream-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent2);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.8); }
}
```

#### JS (inside `modules/message-nav.js`)

```js
function showStreamIndicator(msgEl) {
  hideStreamIndicator();
  var el = document.createElement("div");
  el.className = "stream-indicator";
  el.innerHTML = '<span class="stream-indicator-dot"></span> Responding';
  el.addEventListener("click", function () {
    // Jump to current end of this message
    msgEl.scrollIntoView({ behavior: "smooth", block: "end" });
  });
  msgEl.appendChild(el);
  _activeIndicator = el;
}

function hideStreamIndicator() {
  if (_activeIndicator) {
    _activeIndicator.remove();
    _activeIndicator = null;
  }
}
```

---

## Feature 2: Message Navigation Rail

### Concept

A vertical navigation rail pinned to the right edge of the message area. It
provides three controls:

| Button | Icon        | Action |
|--------|-------------|--------|
| **Prev** | `chevron-up` | Scroll to the previous `[data-turn]` element relative to the current viewport. |
| **Next** | `chevron-down` | Scroll to the next `[data-turn]` element. |
| **End**  | `chevrons-down` (or `arrow-down-to-line`) | Jump to the very bottom (latest content). Equivalent to today's "Latest" button. |

Visually, the metaphor is `<  >  >|` rotated vertically:

```
           ┌───┐
           │ ▲ │   Prev message
           ├───┤
           │ ▼ │   Next message
           ├───┤
           │▼▼ │   Jump to end
           └───┘
```

### MessageIndex

The navigation needs to know which elements are "messages" and their order.
Today, user and assistant blocks already have `data-turn` attributes. We build
an index from these.

```js
var MessageIndex = {
  _els: [],

  rebuild: function () {
    this._els = Array.from(
      messagesEl.querySelectorAll("[data-turn]")
    );
  },

  add: function (el) {
    // Called when a new turn element is appended
    this._els.push(el);
  },

  clear: function () {
    this._els = [];
  },

  // Returns the turn element currently visible at the top of the viewport
  currentIndex: function () {
    var scrollTop = messagesEl.scrollTop;
    var offset = messagesEl.getBoundingClientRect().top;
    for (var i = this._els.length - 1; i >= 0; i--) {
      if (this._els[i].offsetTop - messagesEl.offsetTop <= scrollTop + 60) {
        return i;
      }
    }
    return 0;
  },

  scrollTo: function (index) {
    var el = this._els[index];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  count: function () {
    return this._els.length;
  }
};
```

The index is rebuilt on `clearMessages()` and `history_done`. Individual entries
are `add()`-ed as user/assistant blocks are created.

### Navigation Rail UI

#### Desktop Layout (>768px)

```
┌──────────────────────────────────────────────────────────┐
│                    #main-column                          │
│  ┌──────────────────────────────────────────────┬──────┐ │
│  │                                              │      │ │
│  │              #messages                       │  ▲   │ │
│  │              (scrollable)                    │      │ │
│  │                                              │  ▼   │ │
│  │                                              │      │ │
│  │                                              │ ▼▼   │ │
│  │                                              │      │ │
│  └──────────────────────────────────────────────┴──────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              #input-area                             │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- The rail is positioned with `position: absolute` (or `fixed` relative to
  `#main-column`) on the right edge.
- Vertically centered in the messages viewport.
- Semi-transparent background, appears on hover or when scrolling, fades after
  idle. Always visible on touch devices.
- Z-index above messages but below modals/sheets.

#### Mobile Layout (<=768px)

On mobile, the right-edge rail would conflict with thumb reach and content width.
Two options:

**Option A — Compact bottom-right cluster:**

```
┌──────────────────────────┐
│                          │
│       #messages          │
│                          │
│                    ┌───┐ │
│                    │ ▲ │ │
│                    │ ▼ │ │
│                    │▼▼ │ │
│                    └───┘ │
├──────────────────────────┤
│       #input             │
├──────────────────────────┤
│     mobile tab bar       │
└──────────────────────────┘
```

Positioned above the input area, right-aligned. Small circular buttons stacked
vertically. This keeps them in thumb reach but out of the content flow.

**Option B — Inline in bottom tab bar:**

Add prev/next as part of the existing mobile tab bar, repurposing unused space.
However, the tab bar is already dense (5 tabs), so this is less preferred.

**Recommendation: Option A** for mobile, keeping the tab bar unchanged.

#### CSS

```css
/* --- Message Navigation Rail --- */
.msg-nav-rail {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 15;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

/* Show on hover over messages area, or when actively scrolling */
#messages:hover ~ .msg-nav-rail,
.msg-nav-rail:hover,
.msg-nav-rail.visible {
  opacity: 1;
  pointer-events: auto;
}

.msg-nav-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-alt);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
  box-shadow: 0 1px 4px rgba(var(--shadow-rgb), 0.15);
}

.msg-nav-btn:hover {
  color: var(--text);
  background: var(--sidebar-hover);
  border-color: var(--text-dimmer);
}

.msg-nav-btn:active {
  transform: scale(0.92);
}

.msg-nav-btn .lucide {
  width: 16px;
  height: 16px;
}

/* Disabled state (at first/last message) */
.msg-nav-btn.disabled {
  opacity: 0.3;
  cursor: default;
  pointer-events: none;
}

/* Separator before "end" button */
.msg-nav-sep {
  width: 16px;
  height: 1px;
  background: var(--border);
  margin: 2px auto;
}

/* Mobile adjustments */
@media (max-width: 768px) {
  .msg-nav-rail {
    right: 6px;
    top: auto;
    bottom: 90px; /* above input + safe area */
    transform: none;
    opacity: 1;   /* always visible on mobile (no hover) */
    pointer-events: auto;
  }

  .msg-nav-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    /* Slightly larger touch targets */
  }
}
```

#### Position counter badge (optional enhancement)

A small label between prev/next showing current position like "3 / 12":

```
     ┌───┐
     │ ▲ │
     ├───┤
     │3/8│   ← position counter
     ├───┤
     │ ▼ │
     ├───┤
     │▼▼ │
     └───┘
```

This is low priority but easy to add once the index exists.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt + ↑` / `Alt + k` | Previous message |
| `Alt + ↓` / `Alt + j` | Next message |
| `Alt + End` | Jump to end |

These don't conflict with existing keybindings (the input area captures most
keys only when focused).

---

## Integration Points

### Where new code lives

| Component | File | Rationale |
|-----------|------|-----------|
| `MessageIndex`, `ScrollController`, nav rail JS | `modules/message-nav.js` (NEW) | Keeps concerns together; follows existing module pattern. |
| Stream indicator JS | `modules/message-nav.js` | Same module — it depends on the scroll controller. |
| Nav rail CSS | `css/message-nav.css` (NEW) | Follows existing CSS file-per-component pattern. |
| Stream indicator CSS | `css/message-nav.css` | Same file. |

### Changes to existing files

| File | Change |
|------|--------|
| `app.js` | Import new module. Add `scrollPolicy` variable. Modify `ensureAssistantBlock()`, `drainStreamTick()`, `scrollToBottom()`, and `processMessage()` case handlers. Wire up `MessageIndex.add()` calls. |
| `index.html` | Add `<link>` for `message-nav.css`. Add `<script type="module">` for `message-nav.js`. Add navigation rail markup inside `#main-column` (or let JS inject it). |
| `css/messages.css` | Add `position: relative` to `#messages` parent (if not already) to anchor the rail. Minor adjustments if needed. |

### Interaction with existing "New activity" button (`#new-msg-btn`)

The existing floating "Latest" / "New activity" button overlaps functionally
with the "Jump to end" button in the nav rail. Options:

1. **Replace it** — the nav rail's end button subsumes its role. The rail's end
   button can change label/color when new content arrives during scroll-up.
2. **Keep both** — the existing button is centered and prominent; the rail
   button is a smaller persistent control. They coexist.

**Recommendation:** Keep the existing button for now (it's well-tested and
prominent). The nav rail's end button is an *additional* affordance. Long term,
consider merging them.

---

## Migration / Rollout Strategy

This can be implemented incrementally:

### Phase 1: Scroll policy change + stream indicator
- Add `scrollPolicy` variable and gate `drainStreamTick()`.
- Modify `ensureAssistantBlock()` to do initial jump-to-start.
- Add stream indicator badge.
- **No new module needed** — changes are small enough to live in `app.js`
  initially.

### Phase 2: Message navigation rail
- Create `modules/message-nav.js` and `css/message-nav.css`.
- Build `MessageIndex` and nav rail UI.
- Extract Phase 1's scroll controller logic into the module.
- Add keyboard shortcuts.

### Phase 3: Polish
- Position counter badge.
- Merge "New activity" button into nav rail.
- Add swipe gestures (swipe-up/down on rail to navigate).
- Animate transitions between messages (highlight flash on arrive).

---

## Edge Cases & Considerations

| Scenario | Handling |
|----------|----------|
| **Very long single response** (e.g., large code block) | The initial jump puts the user at the top of the assistant block. As content grows, they may want to jump to the end — the stream indicator's click handler does this. |
| **Tool executions interspersed with text** | Tool items don't have `data-turn` — they are grouped between user/assistant turns. The nav skips over tool groups (jumps turn-to-turn). If we want tool-level navigation later, we add a `data-tool-turn` or similar. |
| **History replay** | During history replay (`replayingHistory = true`), skip the jump-to-start behavior and stream indicator. Keep today's scroll-to-bottom behavior. |
| **Multiple rapid messages** | If the user sends a follow-up before the previous response finishes (unlikely but possible via queue), the index handles it — each turn gets its own entry. |
| **Thinking phase** | The thinking phase already uses `activity-inline` with shimmer. The stream indicator only appears once the first `delta` arrives (text streaming begins). Both are not shown simultaneously. |
| **Touch/mobile scroll inertia** | On mobile, momentum scrolling (`-webkit-overflow-scrolling: touch`) means the initial jump-to-start should use `scrollIntoView({ behavior: "instant" })` rather than "smooth" to avoid fighting inertia. |
| **Content reflow during streaming** | Markdown re-render can cause height changes (e.g., a table completing). The user's scroll position may shift. This is acceptable — it's the existing behavior and fixing it would require scroll anchoring (`overflow-anchor`), which is a separate concern. |

---

## Open Questions

1. **Should the initial jump be instant or smooth?** Smooth feels nicer but
   takes ~300ms during which new content might arrive and cause jank. Suggest
   `"instant"` on mobile, `"smooth"` on desktop.

2. **Should the nav rail auto-hide after idle?** On desktop, showing it only on
   hover keeps the UI clean. On mobile (no hover), it should always be visible
   but can be made very subtle (low opacity until tapped).

3. **Granularity of navigation:** Jump per *turn* (user msg + assistant response
   as a pair) or per *element* (each user and assistant block separately)?
   Suggest per-element — it's more flexible and the index already tracks each
   one individually.

4. **Counter badge:** Worth the visual complexity? Can defer to Phase 3.

---

## Summary

| What | How |
|------|-----|
| Stop forced scroll during streaming | New `scrollPolicy` variable; `drainStreamTick()` skips `scrollToBottom()` when policy is `"pinned"` |
| Jump to response start | `ensureAssistantBlock()` calls `scrollIntoView({ block: "start" })` once |
| Show streaming indicator | New `.stream-indicator` pill appended to `.msg-assistant`, removed on `"result"` |
| Message navigation | New `MessageIndex` tracks `[data-turn]` elements; vertical rail with prev/next/end buttons |
| Responsive design | Rail on right edge (desktop) or bottom-right cluster (mobile); touch-sized buttons; always-visible on touch devices |
| New files | `modules/message-nav.js`, `css/message-nav.css` |
| Modified files | `app.js`, `index.html`, possibly `css/messages.css` |
