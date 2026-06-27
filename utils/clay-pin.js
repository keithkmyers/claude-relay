#!/usr/bin/env node
'use strict';
//
// clay-pin — set / remove / inspect a Clay instance PIN without the (single-user-
// broken) web UI and without restarting the daemon.
//
// An instance is identified by its CLAY_HOME (the data dir holding daemon.json +
// daemon.sock). To hash a PIN we use the *target build's* generateAuthToken() so
// the hash always matches that build's verifier (Clay has changed its hash algo
// before — SHA256 -> scrypt). For a RUNNING instance the app dir is discovered
// from the daemon's own process, so you normally pass only --home. --app is an
// override for offline instances or odd layouts.
//
// Change is driven through the daemon's IPC `set_pin` (live + persisted, no
// restart). If the daemon isn't running, the hash is written into daemon.json so
// the next start picks it up.

const net = require('net');
const fs = require('fs');
const path = require('path');

// ---- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
function takeOpt(name, def) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) { const v = argv[i + 1]; argv.splice(i, 2); return v; }
  return def;
}
const JSONOUT = (() => { const i = argv.indexOf('--json'); if (i >= 0) { argv.splice(i, 1); return true; } return false; })();
const appOverride = takeOpt('--app', null);                          // explicit --app always wins
// Resolve the clay root robustly: this tool may live at <root>/utils/ (sidecar)
// or <root>/app/utils/ (in-repo). The root is the dir holding .clay and/or app.
function clayRoot() {
  for (const up of ['..', '../..']) {
    const cand = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(cand, '.clay')) || fs.existsSync(path.join(cand, 'app'))) return cand;
  }
  return path.resolve(__dirname, '..');
}
const ROOT = clayRoot();
const defaultApp = path.join(ROOT, 'app');                          // fallback if offline & no --app
const home = path.resolve(takeOpt('--home', process.env.CLAY_HOME || path.join(ROOT, '.clay')));
const cmd = argv[0];
const arg1 = argv[1];

const sockPath = path.join(home, 'daemon.sock');
const cfgPath = path.join(home, 'daemon.json');

// ---- helpers ---------------------------------------------------------------
function emit(obj, human) { if (JSONOUT) console.log(JSON.stringify(obj)); else if (human != null) console.log(human); }
function die(msg) { if (JSONOUT) console.log(JSON.stringify({ ok: false, error: msg })); else console.error('clay-pin: ' + msg); process.exit(1); }

function ipc(message, cb) {
  if (!fs.existsSync(sockPath)) return cb(new Error('no socket'));
  const c = net.connect(sockPath);
  let buf = '', done = false;
  const timer = setTimeout(() => { if (!done) { done = true; c.destroy(); cb(new Error('timeout')); } }, 3000);
  c.on('connect', () => c.write(JSON.stringify(message) + '\n'));
  c.on('data', d => {
    buf += d; const i = buf.indexOf('\n');
    if (i >= 0 && !done) {
      done = true; clearTimeout(timer);
      let r; try { r = JSON.parse(buf.slice(0, i)); } catch (e) { r = { ok: false, error: 'bad response' }; }
      c.destroy(); cb(null, r);
    }
  });
  c.on('error', e => { if (!done) { done = true; clearTimeout(timer); cb(e); } });
}

function probe(cb) { ipc({ cmd: 'get_status' }, (err, r) => cb(!err && r && r.ok === true ? r : null)); }
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { return null; } }

// Discover the app dir from the running daemon's process (its <app>/lib/daemon.js
// arg), so a live instance always hashes with its own build.
function appFromPid(pid) {
  try {
    const parts = fs.readFileSync('/proc/' + pid + '/cmdline').toString('utf8').split('\0').filter(Boolean);
    for (const p of parts) if (/(^|\/)daemon\.js$/.test(p)) return path.dirname(path.dirname(path.resolve(p)));
  } catch (e) { /* not Linux / no access -> fall through */ }
  return null;
}
function resolveApp(status) {
  if (appOverride) return { dir: path.resolve(appOverride), src: '--app' };
  if (status && status.pid) { const a = appFromPid(status.pid); if (a) return { dir: a, src: 'running build' }; }
  return { dir: path.resolve(defaultApp), src: 'default' };
}
function hashPin(pin, appDir) {
  const authPath = path.join(appDir, 'lib', 'server-auth.js');
  let mod;
  try { mod = require(authPath); }
  catch (e) { die('cannot load hasher from ' + authPath + ' (' + e.message + ') — pass --app at the right build'); }
  if (!mod || typeof mod.generateAuthToken !== 'function') die('this build does not export generateAuthToken (' + authPath + ')');
  return mod.generateAuthToken(pin);
}

// makeHash(appDir) -> hash string, or null to remove the PIN
function applyPin(makeHash, verb) {
  if (!fs.existsSync(home)) die('no clay instance at ' + home + ' (use --home)');
  probe(status => {
    const hashOrNull = makeHash ? makeHash(resolveApp(status).dir) : null;
    if (status) {
      ipc({ cmd: 'set_pin', pinHash: hashOrNull }, (err, r) => {
        if (err || !r || !r.ok) return die('set_pin over IPC failed: ' + (err ? err.message : JSON.stringify(r)));
        emit({ ok: true, mode: 'live', pinEnabled: !!hashOrNull, home }, verb + ' (live — no restart needed)');
      });
    } else {
      const cfg = readCfg();
      if (!cfg) die('daemon not running and no readable daemon.json at ' + cfgPath);
      cfg.pinHash = hashOrNull;
      try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n'); }
      catch (e) { return die('could not write ' + cfgPath + ': ' + e.message); }
      emit({ ok: true, mode: 'offline', pinEnabled: !!hashOrNull, home }, verb + ' (daemon not running — written to daemon.json; effective next start)');
    }
  });
}

function showStatus() {
  const cfg = readCfg();
  probe(status => {
    const app = resolveApp(status);
    const info = {
      home, app: app.dir, appSource: app.src,
      running: !!status, pid: status ? status.pid : null,
      port: cfg ? cfg.port : (status ? status.port : null),
      host: cfg ? cfg.host : null,
      pinEnabled: !!(cfg && cfg.pinHash),
    };
    if (JSONOUT) return emit(info);
    console.log('clay instance: ' + home);
    console.log('  app:     ' + app.dir + ' (' + app.src + ')');
    console.log('  running: ' + (info.running ? 'yes (pid ' + info.pid + ')' : 'no'));
    console.log('  address: ' + (info.host || '?') + ':' + (info.port || '?'));
    console.log('  PIN:     ' + (info.pinEnabled ? 'set — locked' : 'none — OPEN'));
  });
}

const HELP = `clay-pin — set / remove / inspect a Clay instance PIN (no web UI, no restart)

usage:
  clay-pin status                 show PIN state + instance info
  clay-pin set <6-digits>         set or replace the PIN
  clay-pin remove                 remove the PIN (open access)

options:
  --home <dir>   CLAY_HOME data dir   (default: $CLAY_HOME or <clay>/.clay)
  --app  <dir>   build to hash with   (default: the running daemon's own build;
                 falls back to <clay>/app when the instance isn't running)
  --json         machine-readable output

examples:
  clay-pin status
  clay-pin set 444936
  clay-pin remove
  clay-pin status --home /opt/clay/.clay-staging      # second instance; app auto-detected if it's running
`;

switch (cmd) {
  case 'set':
    if (!/^\d{6}$/.test(arg1 || '')) die('usage: clay-pin set <6-digits>');
    applyPin(appDir => hashPin(arg1, appDir), 'PIN set');
    break;
  case 'remove':
  case 'rm':
  case 'clear':
    applyPin(null, 'PIN removed (instance is now OPEN — set one to re-lock)');
    break;
  case 'status':
  case 'st':
    showStatus();
    break;
  case 'help': case '-h': case '--help': case undefined:
    process.stdout.write(HELP); process.exit(cmd ? 0 : 1);
    break;
  default:
    die("unknown command '" + cmd + "' — try: clay-pin help");
}
