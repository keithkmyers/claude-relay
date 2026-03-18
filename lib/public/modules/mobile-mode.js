/**
 * Mobile Mode — reading vs typing mode detection for mobile devices.
 *
 * On mobile (max-width: 768px), the UI operates in one of two modes:
 *
 *   • Reading mode (default) — browsing messages. The nav rail is reparented
 *     into #input-wrapper as a visual "sidecar" bolted onto the input box.
 *
 *   • Typing mode — input focused. Nav rail hides and the input box
 *     reclaims its full width for comfortable text entry.
 *
 * The module applies `.mobile-typing` on #app when typing mode is active.
 * All mobile behavior differences key off this single class via CSS.
 *
 * On desktop the rail stays in #app (its original parent) with its own
 * absolute positioning — this module does not interfere.
 *
 * Exported helpers `isMobile()` and `isTypingMode()` let other modules
 * query the current state without ad-hoc viewport measurements.
 */

var _api = null;
var _isMobile = false;
var _inputFocused = false;
var _railEl = null;
var _railOriginalParent = null;

function _update() {
  var appEl = _api ? _api.$("app") : null;
  if (!appEl) return;

  var typing = _isMobile && _inputFocused;

  if (typing) {
    appEl.classList.add("mobile-typing");
  } else {
    appEl.classList.remove("mobile-typing");
  }
}

/**
 * Move the nav rail between #app (desktop) and #input-wrapper (mobile).
 * On mobile the rail becomes a sidecar physically inside the input area.
 */
function _updateRailPlacement() {
  // Lazy-find the rail (it's created by initMessageNav before us)
  if (!_railEl) {
    _railEl = document.querySelector(".msg-nav-rail");
    if (_railEl) _railOriginalParent = _railEl.parentElement;
  }
  if (!_railEl) return;

  var inputWrapper = document.getElementById("input-wrapper");

  if (_isMobile && inputWrapper) {
    if (_railEl.parentElement !== inputWrapper) {
      inputWrapper.appendChild(_railEl);
    }
  } else if (_railOriginalParent) {
    if (_railEl.parentElement !== _railOriginalParent) {
      _railOriginalParent.appendChild(_railEl);
    }
  }
}

// ── Init ────────────────────────────────────────────────────────────────

export function initMobileMode(api) {
  _api = api;
  _inputFocused = false;
  _railEl = null;             // Re-discover on each init (DOM may have changed)
  _railOriginalParent = null;

  // Match the same breakpoint used by CSS @media rules
  var mql = window.matchMedia("(max-width: 768px)");
  _isMobile = mql.matches;

  // Place the rail in the correct parent on init
  _updateRailPlacement();

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
