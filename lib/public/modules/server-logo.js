// Server logo customization module
// Lets users replace the Clay logo to distinguish different server instances.
// Stores server-wide in $CONFIG_DIR/server-logo.json
// Gallery: default Clay logo, custom upload, big scrollable emoji icon palette.
// Each emoji icon renders on a user-chosen background color.

import { refreshIcons } from './icons.js';
import { showAvatarPositioner } from './profile.js';

var STORAGE_KEY = 'clay-server-logo';
var COLOR_KEY = 'clay-server-color';

var currentLogo = { type: 'default', url: '', emoji: '', color: '#4f46e5' };
var popoverEl = null;

// --- Color utilities ---
function hexToRgb(hex) {
  var h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function relativeLuminance(rgb) {
  var rs = rgb.r / 255, gs = rgb.g / 255, bs = rgb.b / 255;
  var r = rs <= 0.03928 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
  var g = gs <= 0.03928 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
  var b = bs <= 0.03928 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isLightColor(hex) {
  return relativeLuminance(hexToRgb(hex)) > 0.4;
}

// Dark-mode-friendly palette — muted, max channel ~60-65 so they're
// noticeable but never glaring. Roughly: red, orange, amber, yellow-green,
// green, teal, cyan, blue, indigo, violet, purple, magenta, rose, slate.
var LOGO_COLORS = [
  '#420202', '#3d1600', '#3b2500', '#2a3000',
  '#03300a', '#042e22', '#022e3b', '#030242',
  '#1a0042', '#2d0042', '#3b034d', '#40021e',
  '#1c1c2e', '#0f172a', '#2a1215', '#162016',
];

// Curated icon palette — objects, not people
var ICON_CATEGORIES = [
  { name: 'Tech', icons: [
    '\uD83D\uDCBB', '\uD83D\uDDA5\uFE0F', '\u2328\uFE0F', '\uD83D\uDDB2\uFE0F',
    '\uD83D\uDCBE', '\uD83D\uDCE1', '\uD83E\uDD16', '\u2699\uFE0F',
    '\uD83D\uDD27', '\uD83D\uDD0C', '\uD83D\uDCF1', '\uD83D\uDCA1',
    '\uD83E\uDDF2', '\uD83D\uDD0B', '\uD83D\uDCF6',
  ]},
  { name: 'Science', icons: [
    '\uD83D\uDD2C', '\uD83E\uDDEA', '\uD83E\uDDEC', '\uD83D\uDD2D',
    '\u2697\uFE0F', '\uD83E\uDDEB', '\uD83E\uDDEE', '\uD83D\uDCCF',
    '\uD83E\uDE90', '\uD83D\uDCC8', '\uD83D\uDCCA', '\u269B\uFE0F',
  ]},
  { name: 'Nature', icons: [
    '\uD83C\uDF3F', '\uD83C\uDF40', '\uD83C\uDF3A', '\uD83C\uDF3B',
    '\uD83C\uDF32', '\uD83C\uDF0A', '\uD83C\uDFD4\uFE0F', '\uD83C\uDF19',
    '\u2B50', '\uD83D\uDD25', '\uD83C\uDF08', '\uD83C\uDF41',
    '\uD83C\uDF35', '\u2744\uFE0F', '\uD83C\uDF3E', '\u2600\uFE0F',
  ]},
  { name: 'Transport', icons: [
    '\uD83D\uDE80', '\u26F5', '\uD83D\uDE82', '\u2708\uFE0F',
    '\uD83D\uDEF8', '\uD83C\uDFCE\uFE0F', '\uD83D\uDE81', '\uD83D\uDEF0\uFE0F',
    '\uD83D\uDEA2', '\uD83D\uDEB2', '\u26F5', '\uD83D\uDEE5\uFE0F',
  ]},
  { name: 'Books', icons: [
    '\uD83D\uDCDA', '\uD83D\uDCD6', '\uD83D\uDCDD', '\u270F\uFE0F',
    '\uD83D\uDD8A\uFE0F', '\uD83D\uDCCE', '\uD83D\uDCCC', '\uD83D\uDDC2\uFE0F',
    '\uD83D\uDCCB', '\uD83D\uDCD3', '\uD83D\uDCD1', '\uD83D\uDCF0',
  ]},
  { name: 'Animals', icons: [
    '\uD83D\uDC26', '\uD83E\uDD8A', '\uD83D\uDC38', '\uD83E\uDD81',
    '\uD83D\uDC3A', '\uD83E\uDD89', '\uD83D\uDC19', '\uD83E\uDD8B',
    '\uD83D\uDC1D', '\uD83D\uDC22', '\uD83D\uDC2C', '\uD83E\uDD85',
  ]},
  { name: 'Objects', icons: [
    '\uD83D\uDC8E', '\uD83C\uDFC6', '\uD83C\uDFAF', '\uD83C\uDFA8',
    '\uD83C\uDFAD', '\uD83D\uDD11', '\uD83D\uDEE1\uFE0F', '\u2694\uFE0F',
    '\uD83E\uDDED', '\uD83C\uDFB2', '\u265F\uFE0F', '\uD83C\uDFE0',
    '\uD83C\uDFAA', '\uD83E\uDE81', '\uD83D\uDD2E', '\uD83C\uDFB5',
  ]},
  { name: 'Symbols', icons: [
    '\u26A1', '\uD83D\uDC9C', '\u2764\uFE0F', '\uD83D\uDD37',
    '\u2660\uFE0F', '\u2666\uFE0F', '\u262F\uFE0F', '\u267E\uFE0F',
    '\uD83D\uDD36', '\u2B55', '\u2716\uFE0F', '\u269D\uFE0F',
  ]},
];

// --- Canvas rendering: emoji on colored background ---
function renderIconCanvas(emoji, bgColor, size) {
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');

  // Rounded rect background
  var r = size * 0.22; // corner radius
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = bgColor;
  ctx.fill();

  // Emoji centered
  var fontSize = Math.round(size * 0.58);
  ctx.font = fontSize + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.03);

  return canvas.toDataURL('image/png');
}

// --- API ---
function fetchServerLogo() {
  return fetch('/api/server-logo').then(function (r) { return r.json(); });
}

function saveServerLogo(data) {
  return fetch('/api/server-logo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(function (r) { return r.json(); });
}

function uploadServerLogo(blob) {
  return blob.arrayBuffer().then(function (ab) {
    return fetch('/api/server-logo/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(ab),
    }).then(function (r) { return r.json(); });
  });
}

// --- DOM updates ---
function getEffectiveUrl() {
  if (currentLogo.type === 'custom' && currentLogo.url) return currentLogo.url;
  if (currentLogo.type === 'emoji' && currentLogo.emoji) {
    return renderIconCanvas(currentLogo.emoji, currentLogo.color || '#4f46e5', 76);
  }
  return '';
}

function getEffectiveFaviconUrl() {
  if (currentLogo.type === 'custom' && currentLogo.url) return currentLogo.url;
  if (currentLogo.type === 'emoji' && currentLogo.emoji) {
    return renderIconCanvas(currentLogo.emoji, currentLogo.color || '#4f46e5', 32);
  }
  return '';
}

// --- Top bar color band + icon-strip home background ---
function applyServerColor(color) {
  var topBar = document.getElementById('top-bar');
  var homeIcon = document.querySelector('.icon-strip-home');
  if (color) {
    // Top bar
    if (topBar) {
      topBar.style.background = color;
      var light = isLightColor(color);
      topBar.classList.toggle('server-color-light', light);
      topBar.classList.toggle('server-color-dark', !light);
      topBar.classList.add('server-color-active');
    }
    // Icon-strip home background (the ::before pseudo-element)
    if (homeIcon) {
      homeIcon.style.setProperty('--server-color', color);
      homeIcon.classList.add('server-color-active');
    }
    localStorage.setItem(COLOR_KEY, color);
  } else {
    if (topBar) {
      topBar.style.background = '';
      topBar.classList.remove('server-color-light', 'server-color-dark', 'server-color-active');
    }
    if (homeIcon) {
      homeIcon.style.removeProperty('--server-color');
      homeIcon.classList.remove('server-color-active');
    }
    localStorage.removeItem(COLOR_KEY);
  }
}

function applyLogo() {
  var url = getEffectiveUrl();
  var faviconUrl = getEffectiveFaviconUrl();

  // Update icon-strip logo
  var logoImg = document.querySelector('.icon-strip-logo');
  if (logoImg) logoImg.src = url || 'icon-banded-76.png';

  // Update mobile home button icon
  var mobileIcon = document.querySelector('.mobile-home-icon');
  if (mobileIcon) mobileIcon.src = url ? url : '/icon-banded-76.png';

  // Update favicon
  applyFavicon(faviconUrl);

  // Update top bar color band
  applyServerColor(currentLogo.color);

  // Cache data URL in localStorage for instant load on next visit
  if (faviconUrl) {
    localStorage.setItem(STORAGE_KEY, faviconUrl);
    // Also cache the logo-size version
    localStorage.setItem(STORAGE_KEY + '-logo', url);
  } else {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY + '-logo');
  }

  // Notify app.js about favicon change
  window.dispatchEvent(new CustomEvent('server-logo-changed', { detail: { url: faviconUrl } }));
}

function applyFavicon(url) {
  var faviconEl = document.querySelector('link[rel="icon"]');
  if (!faviconEl) return;
  if (url) {
    faviconEl.setAttribute('type', 'image/png');
    faviconEl.href = url;
  } else {
    faviconEl.setAttribute('type', 'image/png');
    faviconEl.href = 'favicon-banded.png';
  }
}

// --- Public getters ---
export function getServerLogoUrl() {
  return getEffectiveUrl();
}

export function getServerFaviconUrl() {
  var url = getEffectiveFaviconUrl();
  return url || 'favicon-banded.png';
}

// --- Popover ---
function showPopover() {
  if (popoverEl) {
    hidePopover();
    return;
  }

  popoverEl = document.createElement('div');
  popoverEl.className = 'server-logo-popover';

  var html = '';
  html += '<div class="server-logo-header">';
  html += '<span class="server-logo-title">Server Icon</span>';
  html += '<button class="server-logo-close-btn">&times;</button>';
  html += '</div>';

  html += '<div class="server-logo-body">';

  // Preview
  html += '<div class="server-logo-preview-row">';
  var previewUrl = getEffectiveUrl() || 'icon-banded-76.png';
  html += '<div class="server-logo-preview-wrap">';
  html += '<img class="server-logo-preview-img" src="' + previewUrl + '" alt="Current logo" width="52" height="52">';
  html += '</div>';
  html += '<div class="server-logo-preview-hint">Right-click the Clay logo anytime to change it</div>';
  html += '</div>';

  // Background color picker (shown first — affects the emoji previews)
  html += '<div class="server-logo-field">';
  html += '<label class="server-logo-field-label">Color</label>';
  html += '<div class="server-logo-color-grid">';
  var isCustomColor = currentLogo.color && LOGO_COLORS.indexOf(currentLogo.color) === -1;
  for (var k = 0; k < LOGO_COLORS.length; k++) {
    var c = LOGO_COLORS[k];
    var activeC = (currentLogo.color === c) ? ' server-logo-color-active' : '';
    html += '<button class="server-logo-color-swatch' + activeC + '" data-color="' + c + '" style="background:' + c + '"></button>';
  }
  // Custom color picker swatch
  var pickerActive = isCustomColor ? ' server-logo-color-active' : '';
  var pickerBg = isCustomColor ? currentLogo.color : '#333';
  html += '<div class="server-logo-color-picker-wrap' + pickerActive + '">';
  html += '<input type="color" class="server-logo-color-input" value="' + (currentLogo.color || '#1a0042') + '" title="Pick custom color">';
  html += '<div class="server-logo-color-picker-swatch" style="background:' + pickerBg + '"></div>';
  html += '</div>';
  html += '</div>';
  html += '</div>';

  // Default + Upload row
  html += '<div class="server-logo-field">';
  html += '<label class="server-logo-field-label">Icon</label>';
  html += '<div class="server-logo-top-row">';
  var defaultActive = currentLogo.type === 'default' ? ' server-logo-option-active' : '';
  html += '<button class="server-logo-option server-logo-option-default' + defaultActive + '" data-type="default" title="Default Clay">';
  html += '<img src="icon-banded-76.png" alt="Default">';
  html += '</button>';
  var uploadActive = currentLogo.type === 'custom' ? ' server-logo-option-active' : '';
  html += '<button class="server-logo-option server-logo-upload' + uploadActive + '" title="Upload image">';
  if (currentLogo.type === 'custom' && currentLogo.url) {
    html += '<img src="' + currentLogo.url + '" alt="Custom" class="server-logo-custom-preview">';
  } else {
    html += '<span class="server-logo-upload-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></span>';
  }
  html += '</button>';
  html += '<input type="file" id="server-logo-file" accept="image/*" style="display:none">';
  html += '</div>';
  html += '</div>';

  // Scrollable emoji palette
  html += '<div class="server-logo-palette">';
  for (var ci = 0; ci < ICON_CATEGORIES.length; ci++) {
    var cat = ICON_CATEGORIES[ci];
    html += '<div class="server-logo-cat-label">' + cat.name + '</div>';
    html += '<div class="server-logo-emoji-grid">';
    for (var ei = 0; ei < cat.icons.length; ei++) {
      var icon = cat.icons[ei];
      var emojiActive = (currentLogo.type === 'emoji' && currentLogo.emoji === icon) ? ' server-logo-emoji-active' : '';
      html += '<button class="server-logo-emoji' + emojiActive + '" data-emoji="' + icon + '" title="' + icon + '">' + icon + '</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  html += '</div>'; // body

  popoverEl.innerHTML = html;

  // --- Events ---
  popoverEl.querySelector('.server-logo-close-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    hidePopover();
  });

  // Default Clay logo
  var defaultBtn = popoverEl.querySelector('.server-logo-option-default');
  if (defaultBtn) {
    defaultBtn.addEventListener('click', function () {
      currentLogo.type = 'default';
      currentLogo.url = '';
      currentLogo.emoji = '';
      currentLogo.color = '';
      applyLogo();
      updatePopoverPreview();
      clearAllActive();
      defaultBtn.classList.add('server-logo-option-active');
      // Also clear color selection in the UI
      popoverEl.querySelectorAll('.server-logo-color-swatch').forEach(function (b) {
        b.classList.remove('server-logo-color-active');
      });
      var pw = popoverEl.querySelector('.server-logo-color-picker-wrap');
      if (pw) pw.classList.remove('server-logo-color-active');
      saveServerLogo(currentLogo);
    });
  }

  // Upload button
  var uploadBtn = popoverEl.querySelector('.server-logo-upload');
  var fileInput = popoverEl.querySelector('#server-logo-file');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var img = new Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function () {
        showAvatarPositioner(img, objectUrl, function (croppedBlob) {
          URL.revokeObjectURL(objectUrl);
          uploadServerLogo(croppedBlob).then(function (data) {
            if (data.ok) {
              currentLogo.type = 'custom';
              currentLogo.url = data.url;
              currentLogo.emoji = '';
              applyLogo();
              updatePopoverPreview();
              clearAllActive();
              uploadBtn.classList.add('server-logo-option-active');
              uploadBtn.innerHTML = '<img src="' + data.url + '" alt="Custom" class="server-logo-custom-preview">';
              saveServerLogo(currentLogo);
            }
          });
        });
      };
      img.src = objectUrl;
    });
  }

  // Emoji buttons
  popoverEl.querySelectorAll('.server-logo-emoji').forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentLogo.type = 'emoji';
      currentLogo.emoji = btn.dataset.emoji;
      currentLogo.url = '';
      applyLogo();
      updatePopoverPreview();
      clearAllActive();
      btn.classList.add('server-logo-emoji-active');
      // Reset upload btn visual if needed
      resetUploadBtn();
      saveServerLogo(currentLogo);
    });
  });

  // Color swatches — always apply to top bar + icon; re-render emoji if active
  function activateColor(color) {
    currentLogo.color = color;
    applyServerColor(color);
    if (currentLogo.type === 'emoji') {
      applyLogo();
      updatePopoverPreview();
    }
    saveServerLogo(currentLogo);
  }

  popoverEl.querySelectorAll('.server-logo-color-swatch').forEach(function (btn) {
    btn.addEventListener('click', function () {
      // Clear all active states (swatches + custom picker)
      popoverEl.querySelectorAll('.server-logo-color-swatch').forEach(function (b) {
        b.classList.remove('server-logo-color-active');
      });
      var pickerWrap = popoverEl.querySelector('.server-logo-color-picker-wrap');
      if (pickerWrap) pickerWrap.classList.remove('server-logo-color-active');
      btn.classList.add('server-logo-color-active');
      activateColor(btn.dataset.color);
    });
  });

  // Custom color picker input
  var colorInput = popoverEl.querySelector('.server-logo-color-input');
  var pickerWrap = popoverEl.querySelector('.server-logo-color-picker-wrap');
  if (colorInput && pickerWrap) {
    colorInput.addEventListener('input', function () {
      var val = colorInput.value;
      // Update the visual swatch behind the picker
      var swatch = pickerWrap.querySelector('.server-logo-color-picker-swatch');
      if (swatch) swatch.style.background = val;
      // Clear preset active states, mark picker active
      popoverEl.querySelectorAll('.server-logo-color-swatch').forEach(function (b) {
        b.classList.remove('server-logo-color-active');
      });
      pickerWrap.classList.add('server-logo-color-active');
      activateColor(val);
    });
  }

  // Prevent clicks inside from propagating
  popoverEl.addEventListener('click', function (e) { e.stopPropagation(); });

  document.body.appendChild(popoverEl);
  refreshIcons();

  // Position near the logo
  positionPopover();

  setTimeout(function () {
    document.addEventListener('click', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
  }, 0);
}

function clearAllActive() {
  if (!popoverEl) return;
  popoverEl.querySelectorAll('.server-logo-option-active').forEach(function (b) {
    b.classList.remove('server-logo-option-active');
  });
  popoverEl.querySelectorAll('.server-logo-emoji-active').forEach(function (b) {
    b.classList.remove('server-logo-emoji-active');
  });
}

function resetUploadBtn() {
  if (!popoverEl) return;
  var upBtn = popoverEl.querySelector('.server-logo-upload');
  if (upBtn && currentLogo.type !== 'custom') {
    upBtn.classList.remove('server-logo-option-active');
    if (!upBtn.querySelector('.server-logo-upload-icon')) {
      upBtn.innerHTML = '<span class="server-logo-upload-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></span>';
    }
  }
}

function positionPopover() {
  if (!popoverEl) return;
  var homeIcon = document.querySelector('.icon-strip-home');
  if (!homeIcon) return;
  var rect = homeIcon.getBoundingClientRect();
  popoverEl.style.left = (rect.right + 8) + 'px';
  popoverEl.style.top = rect.top + 'px';

  // Ensure it doesn't go below viewport
  requestAnimationFrame(function () {
    if (!popoverEl) return;
    var popRect = popoverEl.getBoundingClientRect();
    if (popRect.bottom > window.innerHeight - 8) {
      popoverEl.style.top = Math.max(8, window.innerHeight - popRect.height - 8) + 'px';
    }
  });
}

function updatePopoverPreview() {
  if (!popoverEl) return;
  var img = popoverEl.querySelector('.server-logo-preview-img');
  if (img) img.src = getEffectiveUrl() || 'icon-banded-76.png';
}

function closeOnOutside(e) {
  if (popoverEl && !popoverEl.contains(e.target)) {
    hidePopover();
  }
}

function closeOnEscape(e) {
  if (e.key === 'Escape' && popoverEl) {
    hidePopover();
  }
}

function hidePopover() {
  if (popoverEl) {
    popoverEl.remove();
    popoverEl = null;
  }
  document.removeEventListener('click', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
}

// --- Init ---
export function initServerLogo() {
  // Attach right-click handler to logo
  var homeIcon = document.querySelector('.icon-strip-home');
  if (homeIcon) {
    homeIcon.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showPopover();
    });
  }

  // Also support right-click on mobile home button
  var mobileHome = document.getElementById('mobile-home-btn');
  if (mobileHome) {
    mobileHome.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showPopover();
    });
  }

  // Update tooltip to hint about right-click
  if (homeIcon) {
    homeIcon.title = 'Clay \u00b7 Right-click to change icon';
  }

  // Fetch current setting from server
  fetchServerLogo().then(function (data) {
    if (!data) return;
    currentLogo.type = data.type || 'default';
    currentLogo.url = data.url || '';
    currentLogo.emoji = data.emoji || '';
    currentLogo.color = data.color || '';
    // Apply icon if non-default
    if (currentLogo.type !== 'default') {
      applyLogo();
    }
    // Always apply top bar color if set (even with default icon)
    if (currentLogo.color) {
      applyServerColor(currentLogo.color);
    }
  }).catch(function (err) {
    console.warn('[ServerLogo] Failed to load:', err);
  });
}
