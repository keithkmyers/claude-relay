# Project Rules

- Never add `Co-Authored-By` lines to git commit messages.
- Use `var` instead of `const`/`let`. No arrow functions.
- Server-side: CommonJS (`require`). Client-side: ES modules (`import`).
- Never commit, create PRs, merge, or comment on issues automatically. Only do these when explicitly asked.
- Never restart the Clay service (`clay.service`, `clay-test.service`) without explicit approval from the user first. Restarts disconnect all active sessions.
- All user-facing messages, code comments, and commit messages must be in English only.
- Commit messages must follow Angular Commit Convention (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `perf:`, `test:`, `style:`, `ci:`, `build:`). Use `!` or `BREAKING CHANGE:` footer for breaking changes. Always use the `angular-commit` skill when committing.

## Development Guide

Foundational docs — always loaded into context:
- @docs/INSTRUCTIONS.md — development, staging, deployment, promotion paths
- @ENHANCEMENTS.md — source of truth for all custom features
- @.clay-custom/README.md — patch & migration tooling (`.clay-custom/` is gitignored local state; the README explains its role)

### RRD Reference Docs

**RRD** = "Read Relevant Documents" — read these in full when the current task touches their subject, not on every session:
- `BACKLOG.md` — future work and unscheduled ideas (read when planning new features or triaging backlog)
- `designs/scroll-behavior-and-message-navigation.md` — rationale for nav rail + scroll thresholds (read when touching message-nav or scroll code)

# About This Repo

This is a **fork** of [chadbyte/claude-relay](https://github.com/chadbyte/claude-relay) (aka Clay).
- **Upstream remote**: `upstream` → `https://github.com/chadbyte/claude-relay.git`
- **Our fork**: `origin` → `https://github.com/keithkmyers/claude-relay.git`

We maintain custom patches on top of upstream releases. Our changes are never merged upstream — they ride on top via a patch-based workflow.

## Our Custom Features (on top of upstream)

- **Message navigation rail** (`lib/public/modules/message-nav.js`, `lib/public/css/message-nav.css`) — prev/next/end buttons for navigating between AI response turns, keyboard shortcuts (Alt+Up/Down/End), streaming indicator dot, offset-from-end position counter.
- **Mobile mode & panel-aware docking** (`lib/public/modules/mobile-mode.js`) — sidecar nav rail that docks into the input box on mobile or when a right-hand panel (terminal, file viewer) is open. Uses MutationObserver for zero cross-module coupling. `.nav-docked` / `.mobile-typing` CSS classes.
- **Refined scroll thresholds** (`lib/public/app.js`, `lib/public/modules/message-nav.js`) — dual threshold system: 80px to break auto-follow (easier to escape), 15px to re-engage (must scroll all the way back), 200ms grace period to prevent bounce re-engage.
- **Mobile touchend send fix** (`lib/public/modules/input.js`) — handles `touchend` before `blur` to prevent keyboard-close layout shift from swallowing taps on the send button.
- **Design doc** (`designs/scroll-behavior-and-message-navigation.md`) — detailed rationale for the scroll and nav features.
- **Server logo customization** (`lib/public/modules/server-logo.js`, `lib/public/css/server-logo.css`) — right-click the Clay logo to choose a custom server icon from a scrollable emoji palette (8 categories), upload a custom image, or pick a background color (16 dark-mode-friendly presets + native color picker). Color applies to icon background, top bar band, and browser favicon for at-a-glance server identification.
- **Tests** (`tests/message-nav.test.js`, `tests/mobile-mode.test.js`, `tests/scroll-integration.test.js`, `tests/server-logo.test.js`, `vitest.config.js`) — full test suites for the above.

## Upstream Update Workflow (`.clay-custom/`)

The `.clay-custom/` directory (gitignored, local-only) holds the patch vehicle and migration tooling. Full details in `.clay-custom/README.md`. Summary:

### Capture current state
```bash
./.clay-custom/snapshot.sh
```
Regenerates `tracked.patch`, `base-ref`, `untracked.tar.gz`. Run after changes before a migration.

### Upgrade to a new upstream release (two numbered scripts)
```bash
./.clay-custom/01_stage_migration.sh          # stage to /opt/clay/staging, start clay-staging.service on :2635
# → test on http://localhost:2635
./.clay-custom/02_prod_migration.sh           # atomic swap + restart prod
```

`01_` supports `--channel [stable|beta|head]`, `--auto` (Claude conflict resolution), `--dry-run`.
`02_` refuses unless staging is healthy and its version > prod's.

## Service Architecture

- **Production**: `clay.service` → `/opt/clay/app/lib/daemon.js`, port 2633, `CLAY_HOME=/opt/clay/.clay`
- **Test instance** (when running): `clay-test.service` → port 2634, `CLAY_HOME=/opt/clay/.clay-test`
- Tailscale Serve handles HTTPS termination; Clay runs plain HTTP behind it
- Config lives at `$CLAY_HOME/daemon.json`
