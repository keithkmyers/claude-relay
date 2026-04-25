# Clay Windmills — Development Instructions

## What This Is

This is a fork of [chadbyte/claude-relay](https://github.com/chadbyte/claude-relay) (aka **Clay**) with custom enhancements ("windmills") layered on top via patch management. Our changes are never merged upstream — they ride on top of upstream releases.

- **Upstream**: `https://github.com/chadbyte/claude-relay.git`
- **Our fork**: `https://github.com/keithkmyers/claude-relay.git`

## Key Files

| File | Purpose |
|------|---------|
| [`ENHANCEMENTS.md`](../ENHANCEMENTS.md) | **Source of truth** for all custom features. Always update this when adding/changing/removing a windmill. |
| [`BACKLOG.md`](../BACKLOG.md) | Future work and ideas. Move items here to ENHANCEMENTS.md once done. |
| [`.clay-custom/`](../.clay-custom/) | Patch management scripts (`snapshot.sh`, `update-upstream.sh`). |
| [`tests/e2e/`](../tests/e2e/) | Playwright E2E tests that verify windmills render and work in a live instance. |
| [`tests/*.test.js`](../tests/) | Vitest unit tests (jsdom) for component-level logic. |
| [`scripts/verify-features.sh`](../scripts/verify-features.sh) | Fast static grep checker — verifies source markers are present. |
| [`designs/`](../designs/) | Design documents with rationale for features. |

## Adding a New Enhancement

1. Implement the feature.
2. Add an entry to `ENHANCEMENTS.md` — include description, file paths, static markers, and E2E selectors.
3. Add a static check to `scripts/verify-features.sh`.
4. Add a Playwright test to `tests/e2e/windmills.spec.js`.
5. Add a Vitest unit test in `tests/` if the feature has standalone testable logic.
6. Run both test suites:
   ```bash
   npx vitest run                    # unit tests
   CLAY_TEST_URL=http://localhost:PORT npx playwright test   # E2E
   ```
7. Run `.clay-custom/snapshot.sh` to capture the updated patch.

## Deployment / Upstream Update Workflow

**Every upstream upgrade goes through staging**, using the two numbered scripts in `.clay-custom/`. Full details of what each does and its preconditions live in `.clay-custom/README.md`.

### Pre-flight (recommended)

Before staging an upstream upgrade, push prod's current state to origin so there's a remote backup of everything our patch represents. Not enforced by the scripts — just sound housekeeping.

```bash
cd /opt/clay/app
git status                                    # review what's modified / untracked
git add -A
git commit -m "chore: pre-migration snapshot of prod state"
git push origin main
```

This is your safety net. If a migration goes sideways and prod state needs to be reconstructed, origin has it.

### Standard flow

```bash
# 0. Capture current state (only if prod has uncommitted changes)
./.clay-custom/snapshot.sh

# 1. Stage — clones pure upstream at target, applies our patch, starts
#    clay-staging.service on port 2635. Prod (clay.service on 2633) is NOT touched.
./.clay-custom/01_stage_migration.sh                    # latest stable upstream release
#   --channel beta | head     other upstream channels
#   --auto                     Claude resolves patch conflicts on merge
#   --dry-run                  preview target, touch nothing

# 2. Verify + smoke-test on http://localhost:2635
scripts/verify-features.sh                              # static markers
cd /opt/clay/staging && npx vitest run                  # unit tests
CLAY_TEST_URL=http://localhost:2635 npx playwright test # E2E
# — iterate on any bugs directly in /opt/clay/staging in place —

# 3. Promote (atomic swap + restart).
#    Refuses unless staging healthy, staging version > prod version,
#    and no lingering app.retired from a prior unfinished promotion.
./.clay-custom/02_prod_migration.sh

# 4. Once prod is confirmed stable
mv /opt/clay/app.retired /opt/clay/retired/
./.clay-custom/snapshot.sh                              # regenerate patch on new base
```

### What each script does

- **`01_stage_migration.sh`** — clones pure upstream (`chadbyte/claude-relay`) at target tag into `/opt/clay/staging`, copies `.clay-custom/` from prod (patch vehicle), applies `tracked.patch` with `git apply --3way` (or Claude resolution under `--auto`), restores untracked custom files, runs `npm install`, updates the Claude Agent SDK, seeds `$STAGING_CLAY_HOME/daemon.json` with port 2635, installs and starts `clay-staging.service`.
- **`02_prod_migration.sh`** — preflights the four preconditions above, stops both services, atomic `mv` swap (`app → app.retired`, `staging → app`), starts `clay.service`, tears down the staging systemd unit and `.clay-staging` data dir, runs `verify-features.sh` against prod.

### Rollback

If prod is broken after promotion (while `app.retired` still exists):

```bash
systemctl stop clay.service
mv /opt/clay/app /opt/clay/app.broken
mv /opt/clay/app.retired /opt/clay/app
systemctl start clay.service
```

### Aborting a staging pass

If staging is wrong and you want to throw it away without touching prod:

```bash
systemctl stop clay-staging.service
rm -f /etc/systemd/system/clay-staging.service
systemctl daemon-reload
rm -rf /opt/clay/staging /opt/clay/.clay-staging
```

### Manual / full-migration fallback

The two scripts above cover the common case (prod is the only instance with real data; staging is a throwaway shakedown). If you need to merge sessions from multiple live instances before promotion, use the "Full migration" procedure below as a manual override.

### Full migration (when merging sessions from multiple instances)

Use this when staging or other instances have real conversations you want to keep:

```bash
# 1. Stop non-production instances first
systemctl stop clay-test.service clay-staging.service

# 2. Merge conversations into the staging data directory
#    -n = no-clobber (don't overwrite if staging already has a file with the same ID)
for dir in /opt/clay/.clay/sessions/*/; do
  dirname=$(basename "$dir")
  mkdir -p "/opt/clay/.clay-staging/sessions/$dirname"
  cp -n "$dir"*.jsonl "/opt/clay/.clay-staging/sessions/$dirname/" 2>/dev/null
done
# Repeat for .clay-test if it exists
for dir in /opt/clay/.clay-test/sessions/*/; do
  dirname=$(basename "$dir")
  mkdir -p "/opt/clay/.clay-staging/sessions/$dirname"
  cp -n "$dir"*.jsonl "/opt/clay/.clay-staging/sessions/$dirname/" 2>/dev/null
done

# 3. CRITICAL: Restore original file timestamps
#    cp sets mtime to "now", which makes every old session appear as "today"
#    in the sidebar. Restore from the source copies:
for retired_file in /opt/clay/.clay/sessions/*/*.jsonl; do
  rel="${retired_file#/opt/clay/.clay/sessions/}"
  target="/opt/clay/.clay-staging/sessions/$rel"
  [ -f "$target" ] && touch --reference="$retired_file" "$target"
done
for test_file in /opt/clay/.clay-test/sessions/*/*.jsonl; do
  rel="${test_file#/opt/clay/.clay-test/sessions/}"
  target="/opt/clay/.clay-staging/sessions/$rel"
  [ -f "$target" ] && touch --reference="$test_file" "$target"
done

# 4. Copy config and data from primary instance
cp /opt/clay/.clay/daemon.json /opt/clay/.clay-staging/daemon.json
for f in profile.json push-subs.json vapid.json; do
  [ -f "/opt/clay/.clay/$f" ] && cp -n "/opt/clay/.clay/$f" "/opt/clay/.clay-staging/$f"
done
[ -d "/opt/clay/.clay/notes" ] && cp -rn /opt/clay/.clay/notes /opt/clay/.clay-staging/

# 5. Stop production, swap directories
systemctl stop clay.service
mv app app.retired
mv staging app
mv .clay .clay.retired
mv .clay-staging .clay

# 6. Start production (clay.service already points to /opt/clay/app/lib/daemon.js)
systemctl start clay.service

# 7. Tear down staging and old services
systemctl disable clay-test.service clay-staging.service 2>/dev/null
rm -f /etc/systemd/system/clay-test.service /etc/systemd/system/clay-staging.service
systemctl daemon-reload
tailscale serve --https=8443 off 2>/dev/null
tailscale serve --https=8444 off 2>/dev/null

# 8. Final validation — E2E against promoted instance
CLAY_PIN=<pin> CLAY_TEST_URL=http://localhost:2633 npx playwright test

# 9. Once confirmed working, move retired dirs (or remove)
mkdir -p retired && mv app.retired .clay.retired retired/
```

# 10. Push finalized state to our fork
git add -A && git commit -m "feat: upgrade to vX.Y.Z + windmills"
git push origin main
.clay-custom/snapshot.sh   # re-snapshot against the new base
```

**Why timestamp restoration matters:** Clay sorts sessions by file mtime. Without step 3, every migrated session shows as "today", flooding the sidebar and burying your actual recent work under dozens of old sessions.

**JSONL compatibility:** The format is append-only and forward-compatible. Non-windmills fields are ignored by upstream; windmills fields (under the `windmills` namespace in meta lines) are ignored by upstream.

## Backward Compatibility Rule

Any data we persist (JSONL meta fields, localStorage keys, config entries) must be **ignored gracefully** by non-windmills Clay versions:

- Use a `windmills` namespace key in JSONL meta lines for our extensions.
- Never change the meaning of existing upstream fields.
- Always provide fallback defaults when reading our custom fields.
- Test by loading a windmills-augmented session file in a stock upstream instance — it must not crash or behave differently.

## Code Style

Inherited from upstream (see `CLAUDE.md`):

- `var` instead of `const`/`let`. No arrow functions.
- Server-side: CommonJS (`require`). Client-side: ES modules (`import`).
- Angular Commit Convention for commit messages.
