/**
 * Message Navigation — scroll policy, stream indicator, and turn-by-turn nav rail.
 *
 * The index tracks .msg-assistant.msg-turn-start elements — the first AI
 * response block in each conversational turn. Navigation jumps between these.
 *
 * PERF PRINCIPLE: Never read layout properties (offsetTop, getBoundingClientRect)
 * in a hot rendering loop or immediately after DOM mutations. These force
 * synchronous layout reflow. The rail update is debounced and skipped entirely
 * during active streaming.
 */

var _api = null;
var _index = [];       // .msg-assistant.msg-turn-start elements
var _scrollPolicy = "auto";
var _streaming = false;
var _selfScrolling = false; // true while programmatic scrollToBottom is executing
var _railEl = null;
var _prevBtn = null;
var _nextBtn = null;
var _endBtn = null;
var _endBtnIcon = null;
var _posLabel = null;
var _updateTimer = null;
var _UPDATE_DEBOUNCE = 250;
var _SCROLL_THRESHOLD = 150;

// ── MessageIndex ────────────────────────────────────────────────────────
// Tracks .msg-assistant.msg-turn-start — the first AI response in each turn.

function indexAdd(el) {
  if (!el.classList.contains("msg-turn-start")) return;
  _index.push(el);
  scheduleRailUpdate();
}

function indexRebuild() {
  if (!_api) return;
  _index = Array.from(_api.messagesEl.querySelectorAll(".msg-assistant.msg-turn-start"));
  doUpdateRail();
}

function indexClear() {
  _index = [];
  if (_updateTimer) { clearTimeout(_updateTimer); _updateTimer = null; }
  doUpdateRail();
}

/**
 * Returns the index of the element whose top edge is at or above
 * the current scroll position.
 */
function currentIndex() {
  var messagesEl = _api.messagesEl;
  var scrollTop = messagesEl.scrollTop;
  var containerTop = messagesEl.offsetTop;
  var best = -1;
  for (var i = 0; i < _index.length; i++) {
    var elTop = _index[i].offsetTop - containerTop;
    if (elTop <= scrollTop + 80) {
      best = i;
    } else {
      break;
    }
  }
  return best;
}

function isTurnTopVisible(idx) {
  if (idx < 0 || idx >= _index.length) return false;
  var messagesEl = _api.messagesEl;
  var scrollTop = messagesEl.scrollTop;
  var containerTop = messagesEl.offsetTop;
  var elTop = _index[idx].offsetTop - containerTop;
  return (elTop >= scrollTop - 20) && (elTop <= scrollTop + 120);
}

function isAtBottom() {
  var el = _api.messagesEl;
  var distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distFromBottom <= _SCROLL_THRESHOLD;
}

// ── Scroll Policy ───────────────────────────────────────────────────────

function setScrollPolicy(policy) {
  _scrollPolicy = policy;
}

function getScrollPolicy() {
  return _scrollPolicy;
}

// ── Stream Indicator (transforms the end button) ────────────────────────

function showStreamIndicator() {
  if (_streaming) return; // Already showing — cheap no-op
  _streaming = true;
  if (_endBtn) {
    _endBtn.classList.add("streaming");
    _endBtn.innerHTML =
      '<span class="stream-indicator-dot"></span>';
    _endBtn.title = "Follow response (click to re-anchor)";
  }
}

function hideStreamIndicator() {
  _streaming = false;
  if (_endBtn && _endBtnIcon) {
    _endBtn.classList.remove("streaming");
    _endBtn.innerHTML = _endBtnIcon;
    _endBtn.title = "Jump to end (Alt+End)";
    _api.refreshIcons();
  }
  // Refresh at-bottom state now that streaming ended
  scheduleRailUpdate();
}

// ── Navigation Rail ─────────────────────────────────────────────────────

function createRail() {
  var iconHtml = _api.iconHtml;

  _railEl = document.createElement("div");
  _railEl.className = "msg-nav-rail empty";

  _prevBtn = document.createElement("button");
  _prevBtn.className = "msg-nav-btn disabled";
  _prevBtn.type = "button";
  _prevBtn.title = "Previous response (Alt+\u2191)";
  _prevBtn.innerHTML = iconHtml("chevron-up");
  _prevBtn.addEventListener("click", navPrev);

  _posLabel = document.createElement("div");
  _posLabel.className = "msg-nav-pos";
  _posLabel.textContent = "";

  _nextBtn = document.createElement("button");
  _nextBtn.className = "msg-nav-btn disabled";
  _nextBtn.type = "button";
  _nextBtn.title = "Next response (Alt+\u2193)";
  _nextBtn.innerHTML = iconHtml("chevron-down");
  _nextBtn.addEventListener("click", navNext);

  var sep = document.createElement("div");
  sep.className = "msg-nav-sep";

  _endBtn = document.createElement("button");
  _endBtn.className = "msg-nav-btn msg-nav-end";
  _endBtn.type = "button";
  _endBtn.title = "Jump to end (Alt+End)";
  _endBtn.innerHTML = iconHtml("chevrons-down");
  _endBtnIcon = _endBtn.innerHTML;
  _endBtn.addEventListener("click", navEnd);

  _railEl.appendChild(_prevBtn);
  _railEl.appendChild(_posLabel);
  _railEl.appendChild(_nextBtn);
  _railEl.appendChild(sep);
  _railEl.appendChild(_endBtn);

  var appEl = _api.$("app");
  if (appEl) appEl.appendChild(_railEl);

  _api.refreshIcons();
}

function navPrev() {
  var cur = currentIndex();
  if (cur < 0) return;

  if (!isTurnTopVisible(cur)) {
    scrollToTurn(cur);
  } else if (cur > 0) {
    scrollToTurn(cur - 1);
  }
}

function navNext() {
  var cur = currentIndex();
  if (cur < _index.length - 1) {
    scrollToTurn(cur + 1);
  } else if (cur >= 0) {
    // On the last message — jump to bottom and engage lock
    navEnd();
  }
}

function navEnd() {
  if (_streaming) {
    _scrollPolicy = "auto";
    if (_api.setScrollPolicy) _api.setScrollPolicy("auto");
  }
  if (_api.forceScrollToBottom) {
    _api.forceScrollToBottom();
  }
}

function scrollToTurn(idx) {
  var el = _index[idx];
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.style.transition = "background 0.15s";
  el.style.background = "rgba(var(--overlay-rgb), 0.06)";
  setTimeout(function () {
    el.style.background = "";
  }, 600);
}

function scheduleRailUpdate() {
  if (_updateTimer) return;
  _updateTimer = setTimeout(function () {
    _updateTimer = null;
    doUpdateRail();
  }, _UPDATE_DEBOUNCE);
}

function doUpdateRail() {
  if (!_railEl) return;
  var count = _index.length;

  if (count === 0) {
    _railEl.classList.add("empty");
    return;
  }
  _railEl.classList.remove("empty");

  var cur = currentIndex();

  // Prev button
  if (cur < 0) {
    _prevBtn.classList.add("disabled");
  } else if (cur === 0 && isTurnTopVisible(0)) {
    _prevBtn.classList.add("disabled");
  } else {
    _prevBtn.classList.remove("disabled");
  }

  // Next button — enabled unless already at the very bottom
  if (cur >= count - 1 && isAtBottom()) {
    _nextBtn.classList.add("disabled");
  } else {
    _nextBtn.classList.remove("disabled");
  }

  // Position label
  if (count > 0 && cur >= 0) {
    _posLabel.textContent = (cur + 1) + "/" + count;
  } else {
    _posLabel.textContent = "";
  }

  // End button: accent emphasis when locked to bottom, grey when not.
  // Independent of streaming state — the two combine visually.
  if (isAtBottom()) {
    _endBtn.classList.add("at-bottom");
  } else {
    _endBtn.classList.remove("at-bottom");
  }
}

function updateRail() {
  scheduleRailUpdate();
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────

function handleKeyDown(e) {
  if (e.altKey && (e.key === "ArrowUp" || e.key === "k")) {
    e.preventDefault();
    navPrev();
    return;
  }
  if (e.altKey && (e.key === "ArrowDown" || e.key === "j")) {
    e.preventDefault();
    navNext();
    return;
  }
  if (e.altKey && e.key === "End") {
    e.preventDefault();
    navEnd();
    return;
  }
}

// ── Init ────────────────────────────────────────────────────────────────

export function initMessageNav(api) {
  _api = api;

  createRail();

  _api.messagesEl.addEventListener("scroll", function () {
    if (_streaming) {
      // Skip scroll events caused by our own scrollToBottom() — these fire
      // ~60/sec during auto-follow and each would force a layout read via
      // isAtBottom(). Only react to genuine user-initiated scrolls.
      if (_selfScrolling) return;

      var atBottom = isAtBottom();
      if (_scrollPolicy === "auto" && !atBottom) {
        // User scrolled up during auto-follow — break the lock
        _scrollPolicy = "pinned";
        if (_api.setScrollPolicy) _api.setScrollPolicy("pinned");
      } else if (_scrollPolicy === "pinned" && atBottom) {
        // User scrolled back to bottom — re-engage auto-follow
        _scrollPolicy = "auto";
        if (_api.setScrollPolicy) _api.setScrollPolicy("auto");
      }
      // Update at-bottom visual state on the end button
      if (_endBtn) {
        if (atBottom) { _endBtn.classList.add("at-bottom"); }
        else { _endBtn.classList.remove("at-bottom"); }
      }
    }

    // Debounced rail update — skip during active streaming to avoid layout thrashing
    if (!_streaming) {
      scheduleRailUpdate();
    }
  });

  document.addEventListener("keydown", handleKeyDown);

  // Mobile keyboard/typing-mode handling is now in modules/mobile-mode.js.
  // It applies .mobile-typing on #app, which CSS uses to hide the rail.
}

function setSelfScrolling(v) { _selfScrolling = v; }

export var msgNav = {
  indexAdd: indexAdd,
  indexRebuild: indexRebuild,
  indexClear: indexClear,
  showStreamIndicator: showStreamIndicator,
  hideStreamIndicator: hideStreamIndicator,
  setScrollPolicy: setScrollPolicy,
  getScrollPolicy: getScrollPolicy,
  setSelfScrolling: setSelfScrolling,
  updateRail: updateRail
};
