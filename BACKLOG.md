# Clay Windmills — Backlog

Future enhancements and infrastructure work. Move items to `ENHANCEMENTS.md` once implemented and verified.

---

## Next Up

- [ ] **Message stacking**
  When multiple messages are sent while Claude is processing, combine them into a
  single prompt instead of generating a separate full turn for each.
  Server-side `stackLast()` on the SDK message queue, Windmills on/off setting
  (default off), chain-link toggle in input bar, stacked badge on bubbles.
  Design doc: `designs/message-stacking.md`.

- [ ] **Per-session Plan/Act mode persistence**
  Plan mode state remembered per session instead of globally. Switching from
  session A (plan mode) to session B should not flip B into plan mode.
  Store in JSONL meta line under a `windmills` namespace key:
  `{"type":"meta", ..., "windmills": {"planMode": true}}`.
  Non-windmills versions ignore unknown keys — backward-compatible by default.

- [ ] **Per-session model selection persistence**
  Same approach — `windmills.model` in the JSONL meta line. On session switch,
  read the preference and send it to the SDK bridge. Falls back to server
  default if absent.

## Integration Infrastructure

- [ ] **Playwright E2E test suite** — initial suite created, expand coverage
      as new features land. Run against any instance via `CLAY_TEST_URL`.
- [ ] **CI workflow for fork** — GitHub Actions: on push to main, run
      `verify-features.sh`, `vitest run`, and `playwright test` against a
      headless instance.
- [ ] **Post-apply test gate in `update-upstream.sh`** — after patch apply,
      automatically run static verifier + E2E suite before restarting service.
      Fail loudly if any feature is missing.

## Future Ideas

- [ ] Session conversation export (markdown/PDF)
- [ ] Per-project model defaults
- [ ] Feature flag system for windmills (toggle individual enhancements)
- [ ] Conversation search across all projects
