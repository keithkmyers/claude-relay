# clay utils

In-repo operational helpers, distributed **with the fork** — every box that runs
this overlay has them (no sidecar to forget to copy). The tools self-locate, so
they work whether this dir is `<root>/app/utils` (in-repo, the norm) or
`<root>/utils` (legacy sidecar).

## `clay-update` — update this box's clay (on-device)

The canonical, **on-device** update: pulls the windmills branch, `npm install`s,
restarts the service, and smoke-tests (retrying while the daemon binds). The
HQ-side `init/install/clay-deploy.sh` is just a thin SSH wrapper around this — so
deploy is never "solely HQ-based"; any box updates itself directly. Per-box
config (`/opt/clay/.clay`) is never touched. First-time install is the standard
`init/install/clay.sh`.

```bash
/opt/clay/app/utils/clay-update                 # update to the current branch
/opt/clay/app/utils/clay-update windmills-2.46  # switch/bump to another branch
```

## `clay-pin` — manage an instance PIN without the web UI

Clay's in-app PIN controls are unreliable on single-user instances (the
*User Settings* PIN form calls a multi-user-only HTTP endpoint that 404s, and
*Server Settings* fires a WebSocket `set_pin` that can die with "connection
lost"). `clay-pin` sidesteps both: it hashes the PIN with the target build's own
`generateAuthToken()` and drives it through the daemon's IPC socket — live, no
restart. If the daemon isn't running it writes the hash into `daemon.json`
instead, so the next start picks it up.

```bash
cd /opt/clay/app/utils

./clay-pin status            # is a PIN set? is the daemon up? which port?
./clay-pin set 444936        # set/replace the PIN (6 digits)
./clay-pin remove            # remove the PIN -> instance is OPEN until you set one
```

### Pointing at another instance

An instance is its **CLAY_HOME** (the data dir with `daemon.json` + `daemon.sock`).
Normally that's all you specify — for a **running** instance the build to hash
with is auto-detected from the daemon's own process, so home and app can never
drift apart:

```bash
# a second instance with its own CLAY_HOME (app auto-detected while it's running):
./clay-pin status --home /opt/clay/.clay-staging
./clay-pin set 123456 --home /opt/clay/.clay-staging
```

`--app` is only needed in one edge case: setting a PIN on an instance that is
**not running** *and* whose build hashes differently from `<root>/app` (Clay has
changed its PIN hash algorithm before). Then point `--app` at that build:

```bash
./clay-pin set 123456 --home /opt/clay/.clay-staging --app /opt/clay/staging
```

`--json` gives machine-readable output. Run as the instance's owner (it
reads/writes `daemon.json` and the root-owned IPC socket).
