/**
 * Mobile Mode & Docked Nav — reading vs typing mode detection, plus
 * panel-aware docking for the message navigation rail.
 *
 * The nav rail docks into the input box as a "sidecar" in two cases:
 *
 *   1. Mobile viewport (max-width: 768px) — always docked.
 *   2. Right-hand panel open (terminal or file viewer) — the chat column
 *      shrinks and the floating rail's absolute positioning would land it
 *      over the panel.  Docking anchors it safely to the input box.
 *
 * When docked, `.nav-docked` is set on #app so CSS can apply sidecar
 * styles.  On mobile, `.mobile-typing` hides the sidecar when the input
 * is focused for comfortable text entry.
 *
 * A MutationObserver watches the panel elements for class changes
 * (`.hidden` toggled) so terminal.js / filebrowser.js don't need to
 * know about this module — zero cross-module coupling.
 */

var _api = null;
var _isMobile = false;
var _inputFocused = false;
var _panelOpen = false;
var _railEl = null;
var _railOriginalParent = null;

/**
 * Returns true when the rail should be docked into the input box.
 */
function _shouldDock() {
  return _isMobile || _panelOpen;
}

function _update() {
  var appEl = _api ? _api.$("app") : null;
  if (!appEl) return;

  // Docked sidecar mode (mobile or panel open)
  if (_shouldDock()) {
    appEl.classList.add("nav-docked");
  } else {
    appEl.classList.remove("nav-docked");
  }

  // Typing mode — mobile only
  var typing = _isMobile && _inputFocused;

  if (typing) {
    appEl.classList.add("mobile-typing");
  } else {
    appEl.classList.remove("mobile-typing");
  }
}

/**
 * Move the nav rail between #app (floating) and #input-wrapper (docked).
 * When docked the rail becomes a sidecar physically inside the input area.
 */
function _updateRailPlacement() {
  // Lazy-find the rail (it's created by initMessageNav before us)
  if (!_railEl) {
    _railEl = document.querySelector(".msg-nav-rail");
    if (_railEl) _railOriginalParent = _railEl.parentElement;
  }
  if (!_railEl) return;

  var inputWrapper = document.getElementById("input-wrapper");

  if (_shouldDock() && inputWrapper) {
    if (_railEl.parentElement !== inputWrapper) {
      inputWrapper.appendChild(_railEl);
    }
  } else if (_railOriginalParent) {
    if (_railEl.parentElement !== _railOriginalParent) {
      _railOriginalParent.appendChild(_railEl);
    }
  }
}

/**
 * Watch #file-viewer and #terminal-container for .hidden class changes.
 * When either panel is visible, _panelOpen becomes true.
 */
function _watchPanels() {
  var panels = [
    document.getElementById("file-viewer"),
    document.getElementById("terminal-container")
  ];

  function check() {
    var anyOpen = false;
    for (var i = 0; i < panels.length; i++) {
      if (panels[i] && !panels[i].classList.contains("hidden")) {
        anyOpen = true;
        break;
      }
    }
    if (anyOpen !== _panelOpen) {
      _panelOpen = anyOpen;
      _updateRailPlacement();
      _update();
    }
  }

  var observer = new MutationObserver(check);
  var opts = { attributes: true, attributeFilter: ["class"] };
  for (var i = 0; i < panels.length; i++) {
    if (panels[i]) observer.observe(panels[i], opts);
  }

  // Initial check in case a panel is already open at init time
  check();
}

// ── Init ────────────────────────────────────────────────────────────────

export function initMobileMode(api) {
  _api = api;
  _inputFocused = false;
  _panelOpen = false;
  _railEl = null;             // Re-discover on each init (DOM may have changed)
  _railOriginalParent = null;

  // Match the same breakpoint used by CSS @media rules
  var mql = window.matchMedia("(max-width: 768px)");
  _isMobile = mql.matches;

  // Place the rail in the correct parent and apply classes on init
  _updateRailPlacement();
  _update();

  mql.addEventListener("change", function (e) {
    _isMobile = e.matches;
    _updateRailPlacement();
    _update();
  });

  // Focus / blur on the main input textarea
  var inputEl = _api.inputEl;
  if (inputEl) {
    inputEl.addEventListener("focus", function () {
      _inputFocused = true;
      _update();
    });
    inputEl.addEventListener("blur", function () {
      _inputFocused = false;
      _update();
    });
  }

  // Watch right-hand panels for open/close
  _watchPanels();
}

// ── Public queries ──────────────────────────────────────────────────────

/** True when on a mobile-width viewport (≤768px). */
export function isMobile() {
  return _isMobile;
}

/** True when mobile AND input is focused (typing mode active). */
export function isTypingMode() {
  return _isMobile && _inputFocused;
}

/** True when a right-hand panel (terminal, file viewer) is visible. */
export function isPanelOpen() {
  return _panelOpen;
}
