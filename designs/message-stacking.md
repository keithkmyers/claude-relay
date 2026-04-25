# Message Stacking

> Design document for combining queued user messages into a single prompt when Claude is already processing.

---

## Problem Statement

### 1. Queued messages produce unnecessary intermediate turns

When the user sends multiple messages while Claude is processing (using tools, generating text),
each message is pushed individually to the SDK's async message queue via `pushMessage()`
(`sdk-bridge.js:2016`). Each queued message becomes a **separate conversational turn**: Claude
finishes the current response, processes message B, generates a full response, then processes
message C, generates another full response.

**Current behavior:**

```
User sends message A (Claude begins processing)
  -> session.isProcessing = true
  -> sdk.startQuery(session, textA)

User sends message B while Claude is still on A
  -> sdk.pushMessage(session, textB)   // buffered in queue

User sends message C while Claude is still on A
  -> sdk.pushMessage(session, textC)   // buffered in queue

Claude finishes response to A
  -> SDK iterator calls next() -> gets B
  -> Claude processes B, generates full response
  -> SDK iterator calls next() -> gets C
  -> Claude processes C, generates full response
```

The user intended B and C as **addenda to the same thought** — a clarification, a correction,
an "oh, and also..." — but the system treats each as an independent prompt deserving its own
full turn. This wastes context window, generates redundant preambles, and breaks the natural
flow of rapid-fire human communication.

### 2. Natural stacking is inconsistent

The Claude Agent SDK does batch consecutive user messages in some cases. When messages arrive
during **tool execution** (Agent, Read, Bash, etc.), the SDK's async iterator may consume
multiple queue entries before generating the next response, effectively stacking them.

Observed in session `1fa36804-6381-4f19-9835-0662dbb0da6a` (ws_subtrackt project):

```
Line 242: user_message "Ah, good catch..."        <- starts new turn
Line 249: tool_start Agent                         <- Claude launches Agent
Line 277: user_message "oh, I think its that..."   <- arrives during Agent execution
Line 284: user_message "when loading the *show"    <- arrives during Agent execution
Line 319: message_uuid (user)                      <- SDK sees both queued messages
Line 320: message_uuid (user)
Line 321: delta "Right, the research confirms..."  <- Claude responds to BOTH at once
```

But when messages arrive during **text generation** (no tool use), the SDK processes them
sequentially. Whether stacking occurs depends on timing and SDK internals — not user intent.

### 3. No user control over stacking behavior

There is no mechanism for the user to say "combine these messages" or "keep them separate."
The outcome is determined entirely by whether Claude happens to be using a tool when the
messages arrive.

---

## Design Goals

| Goal | Rationale |
|------|-----------|
| **Deterministic stacking** | Queued messages should be combined regardless of SDK timing or tool-use state. |
| **User-configurable default** | Server setting controls whether stacking is on or off by default. |
| **Per-message override** | Chain/unchain UI lets the user control stacking for individual messages before or after sending. |
| **Visual clarity** | Clear indicators show which messages are queued, which are stacked, and the chain state. |
| **Zero impact when off** | Disabled by default. Existing behavior is unchanged unless the user opts in. |
| **Backward-compatible** | Old clients ignore stacking fields in WS messages. Server handles missing `stack` field gracefully. |

---

## Architecture Overview

```
                    Client (input.js / app.js)
                   ┌──────────────────────────┐
                   │ chain toggle in input bar │
                   │ stacked badge on bubbles  │
                   │ chain icons on queued msgs│
                   └────────────┬─────────────┘
                                │  { type: "message", text, stack: true/false }
                                ▼
                    Server (project.js)
                   ┌──────────────────────────┐
                   │ reads messageStacking     │
                   │ from daemon config        │
                   │ resolves per-msg stack    │
                   │ flag (msg > config)       │
                   └────────────┬─────────────┘
                                │  sdk.pushMessage(session, text, images, stack)
                                ▼
                    SDK Bridge (sdk-bridge.js)
                   ┌──────────────────────────┐
                   │ messageQueue.push() or   │
                   │ messageQueue.stackLast() │
                   │                          │
                   │ stackLast: if pending    │
                   │ user msg in buffer,      │
                   │ concatenate texts with   │
                   │ \n\n separator           │
                   └────────────┬─────────────┘
                                │
                                ▼
                    Claude Agent SDK
                   ┌──────────────────────────┐
                   │ async iterator consumes  │
                   │ one combined message     │
                   │ instead of N separate    │
                   └──────────────────────────┘
```

### New module: `modules/message-stack.js`

Client-side module responsible for:

1. **Chain toggle state** — tracks whether the next message should stack
2. **Queued message tracking** — marks bubbles that were sent while processing
3. **Chain icon rendering** — shows link/unlink icons on queued message bubbles
4. **Server config sync** — reads stacking preference from daemon config

Initialized from `app.js` the same way `message-nav.js`, `mobile-mode.js`, etc. are today.

---

## Feature 1: Server-Side Message Stacking

### Stacking policy

When stacking is enabled and `pushMessage()` is called:

```
pushMessage(session, text, images, stack)
  │
  ├── stack === false?
  │     └── normal push to messageQueue (separate turn)
  │
  ├── messageQueue buffer empty? (waiting is set — SDK is idle)
  │     └── normal push (nothing to stack onto; SDK consumes immediately)
  │
  └── messageQueue buffer has pending user message?
        └── concatenate text onto last entry's content array
            with \n\n separator between text blocks;
            merge image arrays
```

The key insight: stacking only applies when the message queue has **buffered but unconsumed**
entries. If the SDK iterator is waiting (idle between turns), the first message is delivered
immediately — there is nothing to stack onto. Subsequent messages that arrive before the SDK
asks for the next one get stacked into the buffer.

### Changes to `lib/sdk-bridge.js`

#### A. Add `stackLast()` to message queue

```js
function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    stackLast: function(msg) {
      // Stack onto the last buffered user message if possible
      if (queue.length === 0) return false;
      var last = queue[queue.length - 1];
      if (last.type !== "user") return false;

      var lastContent = last.message.content;
      var newContent = msg.message.content;

      // Append new content items; insert \n\n separator between text blocks
      for (var i = 0; i < newContent.length; i++) {
        if (newContent[i].type === "text") {
          // Find existing trailing text to append to
          var appended = false;
          for (var j = lastContent.length - 1; j >= 0; j--) {
            if (lastContent[j].type === "text") {
              lastContent[j].text += "\n\n" + newContent[i].text;
              appended = true;
              break;
            }
          }
          if (!appended) {
            lastContent.push(newContent[i]);
          }
        } else {
          // Images: append to content array (before text ideally, but
          // order is not critical for the API)
          lastContent.push(newContent[i]);
        }
      }
      return true;
    },
    pending: function() { return queue.length; },
    end: function() { /* ... unchanged ... */ },
    [Symbol.asyncIterator]: function() { /* ... unchanged ... */ },
  };
}
```

#### B. Modify `pushMessage()` to accept `stack` flag

```js
function pushMessage(session, text, images, stack) {
  var content = [];
  if (images && images.length > 0) {
    for (var i = 0; i < images.length; i++) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
      });
    }
  }
  if (text) {
    content.push({ type: "text", text: text });
  }
  var userMsg = {
    type: "user",
    message: { role: "user", content: content },
  };

  if (session.worker) {
    session.worker.send({ type: "push_message", content: userMsg, stack: !!stack });
  } else if (stack && session.messageQueue && typeof session.messageQueue.stackLast === "function") {
    if (!session.messageQueue.stackLast(userMsg)) {
      // Nothing to stack onto — push normally
      session.messageQueue.push(userMsg);
    }
  } else {
    session.messageQueue.push(userMsg);
  }
}
```

### Changes to `lib/project.js`

In the message handler (around line 3988):

```js
// Resolve stacking preference: per-message flag > server config
var stackEnabled = false;
if (msg.stack !== undefined) {
  stackEnabled = !!msg.stack;
} else {
  // Use server default
  var dc = typeof opts.onGetDaemonConfig === "function" ? opts.onGetDaemonConfig() : {};
  stackEnabled = dc.messageStacking === "on";
}

if (!session.isProcessing) {
  session.isProcessing = true;
  onProcessingChanged();
  // ... start query (unchanged)
} else {
  sdk.pushMessage(session, fullText, msg.images, stackEnabled);
  // Notify clients that message was stacked
  if (stackEnabled) {
    sendToSession(session.localId, { type: "message_stacked" });
  }
}
```

---

## Feature 2: Windmills Setting

### Server-side config

A `messageStacking` field in `daemon.json` with values `"on"` or `"off"` (default `"off"`).

#### Changes to `lib/daemon.js`

```js
// In onGetDaemonConfig():
messageStacking: config.messageStacking || "off",

// New handler:
onSetMessageStacking: function (value) {
  var want = value === "on" ? "on" : "off";
  config.messageStacking = want;
  saveConfig(config);
  console.log("[daemon] Message stacking:", want, "(web)");
  return { ok: true, messageStacking: want };
},
```

#### Changes to `lib/server.js`

New GET/PUT endpoints at `/api/settings/message-stacking`, following the exact pattern of
`/api/settings/auto-naming`:

```js
// PUT /api/settings/message-stacking
if (req.method === "PUT" && fullUrl === "/api/settings/message-stacking") {
  var body = "";
  req.on("data", function (chunk) { body += chunk; });
  req.on("end", function () {
    try {
      var data = JSON.parse(body);
      if (typeof opts.onSetMessageStacking === "function") {
        opts.onSetMessageStacking(data.value || "off");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, messageStacking: data.value || "off" }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
  });
  return;
}

// GET /api/settings/message-stacking
if (req.method === "GET" && fullUrl === "/api/settings/message-stacking") {
  var val = "off";
  if (typeof opts.onGetDaemonConfig === "function") {
    var dc = opts.onGetDaemonConfig();
    val = dc.messageStacking || "off";
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ messageStacking: val }));
  return;
}
```

#### Changes to `lib/public/index.html`

Add toggle to the Windmills / AI Features section, after the Session Naming card:

```html
<div class="settings-card" style="margin-top: 16px;">
  <div class="settings-field">
    <label class="settings-label">Message Stacking</label>
    <div class="settings-hint">When you send messages while Claude is processing,
      combine them into a single prompt instead of separate turns.</div>
    <div class="settings-radio-group" id="settings-message-stacking" style="margin-top: 10px;">
      <label class="settings-radio-label">
        <input type="radio" name="message-stacking" value="off"> <span>Off</span>
        <span class="settings-hint">Each message gets its own turn (default).</span>
      </label>
      <label class="settings-radio-label">
        <input type="radio" name="message-stacking" value="on"> <span>On</span>
        <span class="settings-hint">Queued messages are combined into one prompt.</span>
      </label>
    </div>
  </div>
</div>
```

#### Changes to `lib/public/modules/server-settings.js`

In `loadAIFeaturesSettings()`, add fetch/bind logic following the auto-naming pattern:

```js
// Load current value
fetch("/api/settings/message-stacking").then(function (r) { return r.json(); }).then(function (data) {
  var radios = document.querySelectorAll('#settings-message-stacking input[name="message-stacking"]');
  var val = data.messageStacking || "off";
  for (var i = 0; i < radios.length; i++) {
    radios[i].checked = radios[i].value === val;
  }
}).catch(function () {});

// Bind change handlers
var stackRadios = document.querySelectorAll('#settings-message-stacking input[name="message-stacking"]');
for (var i = 0; i < stackRadios.length; i++) {
  stackRadios[i].addEventListener("change", function () {
    if (!this.checked) return;
    var value = this.value;
    fetch("/api/settings/message-stacking", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: value }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.ok) {
        showToast("Message stacking: " + (data.messageStacking === "on" ? "On" : "Off"));
      }
    }).catch(function () {});
  });
}
```

---

## Feature 3: Client-Side Chain Toggle and Stacked Indicators

### Chain toggle in input bar

When Claude is processing and stacking is enabled, a chain-link icon appears in the input
action row (next to the schedule, attach, and send buttons). The icon acts as a toggle:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  [Type a message...]                             │
│                                                  │
│  [clip] [image] [schedule] [chain] [send/stop]   │
│                                                  │
└──────────────────────────────────────────────────┘
```

| State | Icon | Meaning |
|-------|------|---------|
| Linked (default when stacking on) | `link` (Lucide) | Next message will be combined with previous queued message |
| Unlinked | `unlink` (Lucide) | Next message will be sent as a separate turn |
| Hidden | — | Claude is not processing, or stacking is off |

Clicking the icon toggles between linked and unlinked. The state persists for the duration
of the current processing run. When Claude finishes (receives `done`), the chain icon hides
and state resets to the default.

### Stacked indicator on message bubbles

When a user message is sent while processing, the bubble receives a `msg-queued` CSS class.
If the message was stacked (combined with the previous queued message), a small stacked
badge appears below or beside the bubble:

```
┌──────────────────────────────┐
│  Can you also check the      │ <- regular queued message
│  config file?                │
└──────────────────────────────┘
         ╷
    ┌────┴────┐
    │  linked │  <- chain indicator (Phase 2)
    └────┬────┘
         ╵
┌──────────────────────────────┐
│  oh, and look at the tests   │ <- stacked message
│  too                         │
│                   [stacked]  │ <- badge
└──────────────────────────────┘
```

### New module: `lib/public/modules/message-stack.js`

```js
import { iconHtml, refreshIcons } from './icons.js';

var ctx;
var chainState = true;   // true = linked (stack), false = unlinked (separate)
var stackingEnabled = false;

export function initMessageStack(_ctx) {
  ctx = _ctx;
  // Chain toggle button is created in HTML, wired up here
  var chainBtn = document.getElementById("chain-btn");
  if (chainBtn) {
    chainBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      chainState = !chainState;
      updateChainIcon();
    });
  }
}

export function setStackingEnabled(enabled) {
  stackingEnabled = enabled;
  updateChainVisibility();
}

export function isStackLinked() {
  return stackingEnabled && chainState;
}

export function resetChainState() {
  chainState = true; // reset to default on turn end
  updateChainIcon();
  updateChainVisibility();
}

function updateChainIcon() {
  var chainBtn = document.getElementById("chain-btn");
  if (!chainBtn) return;
  chainBtn.innerHTML = iconHtml(chainState ? "link" : "unlink");
  chainBtn.title = chainState ? "Messages will be stacked (click to separate)" :
                                "Messages will be sent separately (click to stack)";
  chainBtn.classList.toggle("chain-linked", chainState);
  chainBtn.classList.toggle("chain-unlinked", !chainState);
  refreshIcons();
}

function updateChainVisibility() {
  var chainBtn = document.getElementById("chain-btn");
  if (!chainBtn) return;
  var show = stackingEnabled && ctx.processing;
  chainBtn.classList.toggle("hidden", !show);
}

export function onProcessingChanged(processing) {
  updateChainVisibility();
  if (!processing) resetChainState();
}
```

### New CSS: `lib/public/css/message-stack.css`

```css
/* Chain toggle button */
#chain-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  color: var(--text-muted);
  transition: color 0.15s, background 0.15s;
  display: flex;
  align-items: center;
}

#chain-btn:hover {
  background: rgba(var(--overlay-rgb), 0.08);
  color: var(--text);
}

#chain-btn.chain-linked {
  color: var(--accent);
}

#chain-btn.chain-unlinked {
  color: var(--text-muted);
  opacity: 0.6;
}

#chain-btn.hidden {
  display: none;
}

/* Stacked badge on message bubbles */
.msg-stacked-badge {
  display: inline-block;
  font-size: 11px;
  color: var(--text-dimmer);
  background: rgba(var(--overlay-rgb), 0.06);
  border-radius: 4px;
  padding: 1px 6px;
  margin-top: 4px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* Queued message indicator */
.msg-user.msg-queued .bubble {
  opacity: 0.85;
  border-left: 2px solid var(--accent);
}
```

### Changes to `lib/public/app.js`

- Import `initMessageStack`, `isStackLinked`, `onProcessingChanged`, `setStackingEnabled`
  from `./modules/message-stack.js`
- In the WS `message` handler, handle `message_stacked` event:
  mark the last user bubble with the stacked badge
- In `addUserMessage()`: if `processing` is true, add `msg-queued` class to the bubble
- In `sendMessage()` flow (via input.js context): include `stack: isStackLinked()` in the
  WS payload when `processing` is true
- On `done` event: call `onProcessingChanged(false)`
- On daemon config received: call `setStackingEnabled(dc.messageStacking === "on")`

### Changes to `lib/public/modules/input.js`

In `sendMessage()`, add `stack` field to the outgoing payload:

```js
var payload = { type: "message", text: text || "" };
if (images.length > 0) payload.images = images;
if (pastes.length > 0) payload.pastes = pastes;
// Include stacking preference when processing
if (ctx.processing && ctx.isStackLinked) {
  payload.stack = ctx.isStackLinked();
}
ctx.ws.send(JSON.stringify(payload));
```

---

## Feature 4: Per-Message Chain/Unchain on Queued Bubbles (Phase 2)

> This feature is deferred to a future iteration. Included here for completeness.

### Concept

Each queued message bubble (`.msg-queued`) shows a clickable chain icon between itself and
the previous queued bubble. Clicking toggles whether this message is stacked with the one
above it.

```
┌──────────────────────┐
│  check the config    │  msg-queued
└──────────────────────┘
         [link]           <- clickable chain icon
┌──────────────────────┐
│  and the tests too   │  msg-queued, stacked
└──────────────────────┘
         [unlink]         <- click to separate
┌──────────────────────┐
│  actually, new topic │  msg-queued, NOT stacked
└──────────────────────┘
```

### Server requirements for Phase 2

The server would need to maintain a **pending message buffer** separate from the raw SDK
message queue, so individual entries can be retroactively split or merged:

```js
session.pendingStack = [
  { text: "check the config", images: [], stacked: false },   // first in group
  { text: "and the tests too", images: [], stacked: true },    // stacked with above
  { text: "actually, new topic", images: [], stacked: false }, // separate turn
];
```

When the SDK iterator asks for the next message, the server walks `pendingStack`, combines
stacked groups, and delivers them as separate queue entries per group.

A `toggle_stack` WebSocket message from the client would update the `stacked` flag and
rebuild the queue entries.

**Complexity**: Moderate. The main challenge is rebuilding the SDK message queue from the
buffer without losing already-consumed entries. Deferred until Phase 1 is validated.

---

## Integration Points

### Where new code lives

| Component | File | Rationale |
|-----------|------|-----------|
| Message queue stacking | `lib/sdk-bridge.js` | `stackLast()` on the queue, `pushMessage()` flag |
| Stacking config | `lib/daemon.js` | Persistent server setting |
| API endpoints | `lib/server.js` | GET/PUT pattern matching auto-naming |
| Settings UI | `lib/public/index.html`, `lib/public/modules/server-settings.js` | Windmills section |
| Client module | `lib/public/modules/message-stack.js` | Chain toggle, stacked indicators |
| CSS | `lib/public/css/message-stack.css` | Chain icon, stacked badge, queued indicator |

### Changes to existing files

| File | Change |
|------|--------|
| `lib/project.js` | Resolve stack flag, pass to `pushMessage()`, send `message_stacked` |
| `lib/public/app.js` | Import module, handle `message_stacked` WS event, wire up context |
| `lib/public/modules/input.js` | Add `stack` field to outgoing message payload |
| `lib/public/index.html` | Add chain-btn to input actions, settings card to Windmills |

---

## Migration / Rollout Strategy

### Phase 1: Core stacking

- Server-side `stackLast()` on message queue
- `pushMessage()` accepts `stack` flag
- Windmills setting (on/off, default off)
- API endpoints
- Settings UI
- Client chain toggle icon in input bar
- Stacked badge on message bubbles
- `msg-queued` indicator CSS class

### Phase 2: Per-message chain/unchain

- Chain icons between queued message bubbles
- `toggle_stack` WS message
- Server-side pending message buffer
- Retroactive split/merge of queue entries

### Phase 3: Polish

- Stacking animation (messages visually merging)
- Sound/haptic feedback on mobile when stacking
- Stacking indicator in session sidebar (shows N stacked messages)
- Keyboard shortcut to toggle chain state

---

## Edge Cases & Considerations

| Scenario | Handling |
|----------|----------|
| Single message while processing | No stacking needed; message goes to queue normally. Chain icon visible but no-op until a second message arrives. |
| Images in stacked messages | Images from all stacked messages are merged into the combined content array. Each image block is preserved as-is. |
| Pastes in stacked messages | Paste text is appended to `fullText` before reaching `pushMessage()` (existing behavior in `project.js`). Stacking concatenates the full texts. |
| Message arrives while SDK iterator is waiting | `push()` delivers immediately (waiting promise resolves). Nothing to stack onto. This is correct — it's the first message of a new turn. |
| Worker process isolation (multi-user) | `pushMessage` routes through `session.worker.send()`. The `stack` flag is forwarded to the worker. Worker's internal queue handles stacking the same way. |
| @Mention messages | Mentions route through `sendMention()`, not `sendMessage()`. Stacking does not apply to mentions. |
| Scheduled messages | Scheduled messages bypass the regular send path. Stacking does not apply. |
| Stacking disabled mid-stream | If user toggles chain to unlinked, the next message gets `stack: false`. Previously stacked messages are unaffected (already combined in the queue). |
| History replay | Stacked messages appear as the original individual `user_message` entries in the JSONL history. The stacking happens at the SDK queue level only, not in history. |
| Rewind | Rewinding to a stacked message rewinds to the individual `user_message` UUID. The stacking is transparent to rewind. |

---

## Open Questions

1. **Should the chain toggle persist across sessions?**
   Currently resets to default (linked) on each `done` event. Could persist in
   `localStorage` if users prefer their override to be sticky.
   Suggest: reset per processing run (Phase 1), add persistence option in Phase 3.

2. **Should stacked messages show as merged bubbles in the UI?**
   Phase 1 shows individual bubbles with a "stacked" badge. Merging them visually
   (collapsing into one bubble) would more accurately reflect what Claude sees.
   Suggest: individual bubbles with badge (Phase 1), optional visual merge (Phase 3).

3. **Should there be a maximum stack depth?**
   If a user sends 20 messages while Claude is on a long tool run, stacking all 20
   into one prompt could be overwhelming. A cap (e.g., 10 messages) with overflow
   starting a new group might be warranted.
   Suggest: no cap in Phase 1, evaluate after real-world usage.

4. **Multi-user: should stacking cross user boundaries?**
   If user A sends a message and user B sends a message while Claude is processing,
   should they be stacked? Probably not — different users have different intents.
   Suggest: only stack messages from the same user (check `ws._clayUser.id`).

5. **Should the `message_stacked` event include enough info to update the UI?**
   Currently just `{ type: "message_stacked" }`. Could include the combined text
   or a count of stacked messages for richer UI.
   Suggest: minimal event in Phase 1, enrich as needed.

---

## Summary

| What | How |
|------|-----|
| Deterministic stacking | `stackLast()` on message queue combines buffered user messages at push time |
| Server setting | `messageStacking: "on"/"off"` in `daemon.json`, GET/PUT API |
| Settings UI | On/Off toggle in Windmills / AI Features section |
| Chain toggle | `#chain-btn` in input bar, visible when processing + stacking on |
| Per-message flag | `stack` field in WS `message` payload, resolved by server |
| Stacked indicator | `.msg-stacked-badge` on combined message bubbles |
| Queued indicator | `.msg-queued` class + left border accent on queued bubbles |
| Phase 2 (deferred) | Per-bubble chain/unchain icons with server-side buffer |

**New files**: `lib/public/modules/message-stack.js`, `lib/public/css/message-stack.css`

**Modified files**: `lib/sdk-bridge.js`, `lib/project.js`, `lib/daemon.js`, `lib/server.js`, `lib/public/index.html`, `lib/public/modules/server-settings.js`, `lib/public/modules/input.js`, `lib/public/app.js`
