# Project Rules

- Never add `Co-Authored-By` lines to git commit messages.
- Use `var` instead of `const`/`let`. No arrow functions.
- Server-side: CommonJS (`require`). Client-side: ES modules (`import`).
- Never commit, create PRs, merge, or comment on issues automatically. Only do these when explicitly asked.
- All user-facing messages, code comments, and commit messages must be in English only.
- Commit messages must follow Angular Commit Convention (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `perf:`, `test:`, `style:`, `ci:`, `build:`). Use `!` or `BREAKING CHANGE:` footer for breaking changes. Always use the `angular-commit` skill when committing.

## Development Guide

For full development instructions, the enhancement registry, deployment workflow, and backward-compatibility rules, see **[`docs/INSTRUCTIONS.md`](docs/INSTRUCTIONS.md)**. For the authoritative list of all custom features, see **[`ENHANCEMENTS.md`](ENHANCEMENTS.md)**. For future work, see **[`BACKLOG.md`](BACKLOG.md)**.

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
- **Tests** (`tests/message-nav.test.js`, `tests/mobile-mode.test.js`, `tests/scroll-integration.test.js`, `vitest.config.js`) — full test suites for the above.

## Upstream Update Workflow (`.clay-custom/`)

The `.clay-custom/` directory contains scripts for managing our fork's relationship with upstream. This is the key workflow:

### 1. Snapshot current customizations

```bash
.clay-custom/snapshot.sh
```

Captures all our changes (committed + uncommitted) as a diff against the upstream base into `tracked.patch`. Also archives any untracked custom files. Run this after making changes so the update script has the latest patch.

**Outputs:**
- `tracked.patch` — diff of all our modifications vs upstream base
- `base-ref` — the upstream commit SHA the patch was generated against
- `untracked-files.list` — list of files we added that aren't in upstream
- `untracked.tar.gz` — archive of those files (if any)

### 2. Update to a new upstream release

```bash
.clay-custom/update-upstream.sh [options]
```

Fetches upstream, resets to clean state, merges to target release, re-applies our patch, installs deps, and restarts the service.

**Options:**
- `--channel stable` (default) — latest stable tag (e.g. v2.14.0)
- `--channel beta` — latest tag including betas
- `--channel head` — upstream/main HEAD
- `--dry-run` — just show what's new, don't change anything
- `--auto` — if patch conflicts, invoke Claude (`claude -p`) to resolve them intelligently

**The dance:**
1. Resets working tree to clean upstream state
2. Merges forward to the target upstream release
3. Re-applies `tracked.patch` with `git apply --3way`
4. If conflicts + `--auto`: Claude resolves them
5. Runs `npm install` and updates the Agent SDK
6. Syntax-checks `app.js`
7. Restarts `clay.service`

## Service Architecture

- **Production**: `clay.service` → `/opt/clay/app/lib/daemon.js`, port 2633, `CLAY_HOME=/opt/clay/.clay`
- **Test instance** (when running): `clay-test.service` → port 2634, `CLAY_HOME=/opt/clay/.clay-test`
- Tailscale Serve handles HTTPS termination; Clay runs plain HTTP behind it
- Config lives at `$CLAY_HOME/daemon.json`
