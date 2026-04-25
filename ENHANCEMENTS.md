# Clay Windmills — Custom Enhancements

All custom features layered on top of upstream [chadbyte/claude-relay](https://github.com/chadbyte/claude-relay). This file is the **source of truth** — keep it up to date whenever adding, modifying, or removing a feature. Both the static verifier (`scripts/verify-features.sh`) and the Playwright E2E suite (`tests/e2e/`) are derived from this list.

---

## Active Features

### PID Display (Session Info Popover)
- **Description**: Shows the Claude subprocess PID in the session info popover with a copy-to-clipboard button.
- **Files**: `lib/public/app.js`, `lib/project.js`
- **Server handler**: `get_claude_pids` message type in `lib/project.js`
- **Static marker**: `id="info-pid-value"` in `app.js`
- **E2E selector**: `#info-pid-value` visible after clicking `#header-info-btn`
- **Added**: 2025-03 (original), re-ported 2026-04

### Restart Claude (Info Popover)
- **Description**: "Restart Claude" button inside the header session info dropdown. Sends `restart_session` to the server which tears down and respawns the SDK subprocess.
- **Files**: `lib/public/app.js`, `lib/sdk-bridge.js`
- **Static marker**: `info-restart-btn` class in `app.js`
- **E2E selector**: `.info-restart-btn` visible after clicking `#header-info-btn`
- **Added**: 2025-03 (original), re-ported 2026-04

### Restart Claude (Sidebar Context Menu)
- **Description**: "Restart Claude" option in the right-click context menu on sessions in the sidebar.
- **Files**: `lib/public/modules/sidebar.js`, `lib/project.js`
- **Static markers**: `Restart Claude` text in `sidebar.js`, `restart_session` handler in `project.js`
- **E2E selector**: Session context menu item containing "Restart Claude"
- **Added**: 2025-03 (original), re-ported 2026-04

### Restart Session Backend
- **Description**: Server-side `restartSession()` async function that kills the Claude subprocess and respawns it for the active session.
- **Files**: `lib/sdk-bridge.js`, `lib/project.js`
- **Static markers**: `restartSession` function in `sdk-bridge.js`, `restart_session` handler in `project.js`
- **E2E**: Covered by the info-popover restart button test (click triggers server handler)
- **Added**: 2025-03 (original), re-ported 2026-04

### Message Navigation Rail
- **Description**: Floating vertical rail with prev/next/end buttons for navigating between AI response turns. Keyboard shortcuts Alt+Up, Alt+Down, Alt+End. Shows a streaming indicator dot and an offset-from-end position counter (e.g. "3/10").
- **Files**: `lib/public/modules/message-nav.js`, `lib/public/css/message-nav.css`, `lib/public/app.js` (init call)
- **Static markers**: `initMessageNav` import in `app.js`, `msg-nav-rail` class in `message-nav.js`
- **E2E selectors**: `.msg-nav-rail` container, `.msg-nav-btn` buttons, `.msg-nav-end`, `.msg-nav-pos`
- **Design doc**: `designs/scroll-behavior-and-message-navigation.md`
- **Unit tests**: `tests/message-nav.test.js`
- **Added**: 2025-03

### Mobile Mode & Panel-Aware Docking
- **Description**: Nav rail is **always docked** as a sidecar beside the input box (never floats). This avoids fragile absolute-positioning that broke in upstream's channel/wide-view mode. On mobile, `.mobile-typing` hides the sidecar during active typing. Uses MutationObserver for zero cross-module coupling.
- **Files**: `lib/public/modules/mobile-mode.js`, `lib/public/css/message-nav.css` (docked styles)
- **Static marker**: `initMobileMode` import in `app.js`
- **E2E selectors**: `.nav-docked` class on `#app` at all viewport sizes, rail parent is `#input-wrapper`
- **Unit tests**: `tests/mobile-mode.test.js`
- **Added**: 2025-03, **updated**: 2026-04 (always-docked, removed floating mode)

### Scroll Threshold Refinement
- **Description**: Dual-threshold scroll system — 80px to break auto-follow (easier to escape during streaming), 15px to re-engage (must scroll nearly all the way back down), 200ms grace period to prevent bounce re-engage.
- **Files**: `lib/public/app.js`, `lib/public/modules/message-nav.js`
- **Static markers**: `80` threshold value in scroll handler
- **Design doc**: `designs/scroll-behavior-and-message-navigation.md`
- **Unit tests**: `tests/scroll-integration.test.js`
- **Added**: 2025-03

### Mobile Touchend Send Fix
- **Description**: Handles `touchend` event on the send button before `blur` fires, preventing keyboard-close layout shift from swallowing taps.
- **Files**: `lib/public/modules/input.js`
- **Static marker**: `touchend` listener in `input.js`
- **E2E**: Touch event simulation on send button (mobile viewport)
- **Added**: 2025-03

### Expandable Command Blocks
- **Description**: Bash tool calls display in a styled, scrollable command preview block (max 4 lines) with tooltip showing full command.
- **Files**: `lib/public/modules/tools.js`, `lib/public/css/messages.css`
- **Static markers**: `tool-command-block` class in `tools.js` and `messages.css`
- **E2E selector**: `.tool-command-block` elements within tool call messages
- **Added**: 2026-03

### Context Token Tracking Improvements
- **Description**: Per-API-call `lastContextTokens` tracking in SDK bridge. Preserves user's model variant string (e.g. `"opus[1m]"`) instead of overwriting with CLI's base model name. Known context-window overrides checked before falling back to SDK value.
- **Files**: `lib/sdk-bridge.js`
- **Static marker**: `lastContextTokens` in `sdk-bridge.js`
- **E2E**: Context bar displays accurate token count after a response
- **Added**: 2026-03

### Server Logo Customization
- **Description**: Right-click the Clay logo (top-left) to open a popover for choosing a custom server icon. Includes a scrollable emoji palette (8 categories: Tech, Science, Nature, Transport, Books, Animals, Objects, Symbols), custom image upload with crop tool, and a dark-mode-friendly color picker (16 muted presets + native color input). The selected color is applied as the icon background, the `#top-bar` background band (for at-a-glance server identification), and the browser tab favicon. Settings persist server-wide in `$CONFIG_DIR/server-logo.json`.
- **Files**: `lib/public/modules/server-logo.js`, `lib/public/css/server-logo.css`, `lib/public/app.js` (init call + event listener), `lib/server.js` (API routes)
- **Static markers**: `initServerLogo` import in `app.js`, `ICON_CATEGORIES` and `applyServerColor` in `server-logo.js`, `server-logo-color-input` in `server-logo.js`, `server-color-dark` class in `server-logo.css`
- **E2E selectors**: `.server-logo-popover`, `.server-logo-emoji`, `.server-logo-color-swatch`, `.server-logo-color-input`, `.server-logo-palette`
- **Unit tests**: `tests/server-logo.test.js` (36 tests)
- **Added**: 2026-04

### Session Status (Sidebar)
- **Description**: Mark sessions with a status (currently "done"). Right-click a session in the sidebar → "Mark Done" to toggle a green ✓ checkmark icon next to the session title. Done sessions have slightly dimmed text when not active. Status is persisted in the JSONL meta line and survives restarts. Architecture supports future status values.
- **Files**: `lib/sessions.js`, `lib/project.js`, `lib/public/modules/sidebar.js`, `lib/public/css/admin.css`
- **Server handler**: `set_session_status` message type in `lib/project.js`
- **Static markers**: `setSessionStatus` in `sessions.js`, `set_session_status` in `project.js`, `session-status-icon` in `sidebar.js`, `session-status-icon` in `admin.css`
- **E2E selectors**: `.session-ctx-item` containing "Mark Done", `.session-status-icon.done` after marking
- **Added**: 2026-04

---

## Integration Infrastructure

| Component | Path | Purpose |
|-----------|------|---------|
| Static verifier | `scripts/verify-features.sh` | Greps source for all static markers |
| E2E tests | `tests/e2e/windmills.spec.js` | Playwright tests against running instance |
| Vitest unit tests | `tests/*.test.js` | DOM-level unit tests (jsdom) |
| Patch management | `.clay-custom/` | Snapshot + two-script migration flow (`01_stage_migration.sh` → test → `02_prod_migration.sh`). See `.clay-custom/README.md`. |
| Design docs | `designs/` | Feature rationale and specs |
| Instructions | `docs/INSTRUCTIONS.md` | Dev guide, deployment steps |
| Backlog | `BACKLOG.md` | Future work queue |

---

## Adding a New Enhancement

1. Implement the feature.
2. Add an entry to this file with all fields (description, files, static markers, E2E selectors).
3. Add a static check to `scripts/verify-features.sh`.
4. Add a Playwright test to `tests/e2e/windmills.spec.js`.
5. Add a Vitest unit test in `tests/` if the feature has testable logic.
6. Run `npx playwright test` and `npx vitest run` — both must pass.
7. Run `.clay-custom/snapshot.sh` to update the patch.
