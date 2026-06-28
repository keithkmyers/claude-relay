#!/usr/bin/env node
'use strict';
//
// clay-restart — bounce the Clay service ONLY when it's quiet, so a restart
// never brains a live session. Polls the daemon's `get_status` IPC for any
// project that is processing (or waiting on a permission); waits until quiet,
// then runs `systemctl restart clay`. Meant to be run in the BACKGROUND.
//
//   clay-restart                      wait for quiet, then restart
//   clay-restart --ignore hq          ignore the project you're driving from
//   clay-restart --now                restart immediately (old behaviour)
//   clay-restart --dry-run            report busy/quiet, do NOT restart
//   clay-restart --timeout 3600 --force   wait up to 1h, then restart anyway
//
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
function takeOpt(n, d) { const i = argv.indexOf(n); if (i >= 0 && i + 1 < argv.length) { const v = argv[i + 1]; argv.splice(i, 2); return v; } return d; }
function takeFlag(n) { const i = argv.indexOf(n); if (i >= 0) { argv.splice(i, 1); return true; } return false; }
function takeMulti(n) { const o = []; let i; while ((i = argv.indexOf(n)) >= 0 && i + 1 < argv.length) { o.push(argv[i + 1]); argv.splice(i, 2); } return o; }

const NOW = takeFlag('--now');
const DRY = takeFlag('--dry-run');
const FORCE = takeFlag('--force');
const JSONOUT = takeFlag('--json');
const interval = Math.max(1, parseInt(takeOpt('--interval', '5'), 10)) * 1000;
const settle = Math.max(1, parseInt(takeOpt('--settle', '2'), 10));   // consecutive quiet polls before firing
const timeout = Math.max(0, parseInt(takeOpt('--timeout', '1800'), 10)) * 1000;
const ignore = new Set(takeMulti('--ignore'));

function clayRoot() { for (const up of ['..', '../..']) { const c = path.resolve(__dirname, up); if (fs.existsSync(path.join(c, '.clay')) || fs.existsSync(path.join(c, 'app'))) return c; } return path.resolve(__dirname, '..'); }
const ROOT = clayRoot();
const home = path.resolve(takeOpt('--home', process.env.CLAY_HOME || path.join(ROOT, '.clay')));
const sockPath = path.join(home, 'daemon.sock');

function log(s) { if (!JSONOUT) console.log(s); }

function getStatus() {
  return new Promise((resolve) => {
    const c = net.connect(sockPath);
    let buf = '', done = false;
    const t = setTimeout(() => { if (!done) { done = true; c.destroy(); resolve(null); } }, 3000);
    c.on('connect', () => c.write(JSON.stringify({ cmd: 'get_status' }) + '\n'));
    c.on('data', d => { buf += d; const i = buf.indexOf('\n'); if (i >= 0 && !done) { done = true; clearTimeout(t); let r = null; try { r = JSON.parse(buf.slice(0, i)); } catch (e) {} c.destroy(); resolve(r); } });
    c.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
  });
}

// null = no daemon; else { busy, active:[project,…] }
async function activity() {
  const s = await getStatus();
  if (!s || !s.ok) return null;
  const active = (s.projects || []).filter(p => !ignore.has(p.slug) && (p.isProcessing || (p.pendingPermissions || 0) > 0));
  return { busy: active.length > 0, active };
}
function describe(active) { return active.map(p => p.slug + (p.pendingPermissions ? '(awaiting-permission)' : '(processing)')).join(', '); }

function doRestart(reason) {
  if (DRY) { log('clay-restart: [dry-run] WOULD restart (' + reason + ').'); process.exit(0); }
  try { execFileSync('systemctl', ['restart', 'clay'], { stdio: 'inherit' }); }
  catch (e) { console.error('clay-restart: restart failed: ' + e.message); process.exit(1); }
  if (JSONOUT) console.log(JSON.stringify({ ok: true, restarted: true, reason }));
  else log('clay-restart: ✓ restarted (' + reason + ').');
  process.exit(0);
}

(async () => {
  const first = await activity();

  if (DRY) {
    if (first === null) return void log('clay-restart: [dry-run] daemon not running → would restart (clean start).');
    if (!first.busy) return void log('clay-restart: [dry-run] QUIET → would restart now.');
    return void log('clay-restart: [dry-run] BUSY: ' + describe(first.active) + ' → would wait.');
  }
  if (first === null) return doRestart('daemon not running');
  if (NOW) { if (first.busy) log('clay-restart: --now with ' + first.active.length + ' active (' + describe(first.active) + ') — braining them.'); return doRestart('--now'); }

  const start = Date.now();
  let quiet = 0;
  log('clay-restart: waiting for clay to go quiet' + (ignore.size ? ' (ignoring: ' + [...ignore].join(',') + ')' : '') + ' …');
  const tick = async () => {
    const a = await activity();
    if (a === null) return doRestart('daemon gone');
    if (!a.busy) { if (++quiet >= settle) return doRestart('quiet for ' + (settle * interval / 1000) + 's'); return void setTimeout(tick, interval); }
    quiet = 0;
    const elapsed = Date.now() - start;
    if (timeout && elapsed > timeout) {
      if (FORCE) return doRestart('timeout reached, --force, still busy: ' + describe(a.active));
      log('clay-restart: still busy after ' + Math.round(elapsed / 1000) + 's (' + describe(a.active) + ') — giving up. Raise --timeout, or use --force / --now.');
      process.exit(2);
    }
    log('clay-restart: busy (' + describe(a.active) + ') — waiting …');
    setTimeout(tick, interval);
  };
  setTimeout(tick, interval);
})();
