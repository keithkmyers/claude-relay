/**
 * Test helpers — mock DOM environment for message-nav tests.
 *
 * Provides a fake messagesEl (scroll container) with controllable
 * scroll geometry, mock API objects, and DOM assertion utilities.
 */

/**
 * Create a mock messages container element with controllable scroll geometry.
 * jsdom doesn't implement layout, so we manually wire scrollHeight/scrollTop/etc.
 */
export function createMockMessagesEl() {
  var el = document.createElement("div");
  el.id = "messages";

  // jsdom doesn't compute layout — simulate scroll geometry via backing fields
  var _scrollTop = 0;
  var _scrollHeight = 1000;
  var _clientHeight = 600;
  var _offsetTop = 0;

  Object.defineProperty(el, "scrollTop", {
    get: function () { return _scrollTop; },
    set: function (v) {
      // Clamp like a real browser
      var max = Math.max(0, _scrollHeight - _clientHeight);
      _scrollTop = Math.max(0, Math.min(v, max));
      // Fire scroll event synchronously, as real browsers do when setting scrollTop
      el.dispatchEvent(new Event("scroll"));
    },
    configurable: true,
  });

  Object.defineProperty(el, "scrollHeight", {
    get: function () { return _scrollHeight; },
    set: function (v) { _scrollHeight = v; },
    configurable: true,
  });

  Object.defineProperty(el, "clientHeight", {
    get: function () { return _clientHeight; },
    set: function (v) { _clientHeight = v; },
    configurable: true,
  });

  Object.defineProperty(el, "offsetTop", {
    get: function () { return _offsetTop; },
    set: function (v) { _offsetTop = v; },
    configurable: true,
  });

  // Expose setters for test control
  el._setScrollGeometry = function (opts) {
    if (opts.scrollHeight !== undefined) _scrollHeight = opts.scrollHeight;
    if (opts.clientHeight !== undefined) _clientHeight = opts.clientHeight;
    if (opts.offsetTop !== undefined) _offsetTop = opts.offsetTop;
    if (opts.scrollTop !== undefined) _scrollTop = opts.scrollTop; // bypass event
  };

  el._getScrollTop = function () { return _scrollTop; };

  return el;
}

/**
 * Create a mock turn-start element with controllable offsetTop.
 */
export function createTurnStartEl(offsetTop) {
  var el = document.createElement("div");
  el.className = "msg-assistant msg-turn-start";
  Object.defineProperty(el, "offsetTop", {
    get: function () { return offsetTop; },
    configurable: true,
  });
  // Stub scrollIntoView (jsdom doesn't implement it)
  el.scrollIntoView = vi.fn();
  return el;
}

/**
 * Create the mock API object that initMessageNav() expects.
 */
export function createMockApi(messagesEl) {
  var appEl = document.createElement("div");
  appEl.id = "app";
  document.body.appendChild(appEl);

  return {
    messagesEl: messagesEl,
    $: function (id) { return document.getElementById(id); },
    iconHtml: function (name) {
      return '<svg class="lucide" data-icon="' + name + '"></svg>';
    },
    refreshIcons: vi.fn(),
    setScrollPolicy: vi.fn(),
    forceScrollToBottom: vi.fn(),
  };
}

/**
 * Flush pending setTimeout/setInterval callbacks.
 */
export function flushTimers() {
  vi.runAllTimers();
}

/**
 * Advance timers by a specific duration.
 */
export function advanceTimers(ms) {
  vi.advanceTimersByTime(ms);
}
