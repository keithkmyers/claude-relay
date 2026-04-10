#!/usr/bin/env bash
# verify-features.sh — Static check that all windmill features are present.
# Greps source files for known markers from ENHANCEMENTS.md.
# Exit 0 = all present, exit 1 = something missing.
#
# Usage:
#   scripts/verify-features.sh              # check /opt/clay/app (default)
#   scripts/verify-features.sh /opt/clay/staging   # check another instance

set -euo pipefail

REPO="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PASS=0
FAIL=0

check() {
  local label="$1" file="$2" pattern="$3"
  if grep -q "$pattern" "$REPO/$file" 2>/dev/null; then
    printf '  \033[0;32m✓\033[0m %s\n' "$label"
    PASS=$((PASS + 1))
  else
    printf '  \033[0;31m✗\033[0m %s  (expected "%s" in %s)\n' "$label" "$pattern" "$file"
    FAIL=$((FAIL + 1))
  fi
}

echo "Verifying windmill features in: $REPO"
echo ""

echo "── PID Display ──"
check "PID value element"          "lib/public/app.js"              "info-pid-value"
check "PID copy button"            "lib/public/app.js"              "info-pid-copy"
check "get_claude_pids handler"    "lib/project.js"                 "get_claude_pids"

echo ""
echo "── Restart Claude ──"
check "Restart btn (info popover)" "lib/public/app.js"              "info-restart-btn"
check "Restart text (sidebar)"     "lib/public/modules/sidebar.js"  "Restart Claude"
check "restart_session handler"    "lib/project.js"                 "restart_session"
check "restartSession function"    "lib/sdk-bridge.js"              "restartSession"

echo ""
echo "── Message Navigation ──"
check "initMessageNav import"      "lib/public/app.js"              "initMessageNav"
check "Nav rail class"             "lib/public/modules/message-nav.js" "msg-nav-rail"
check "Nav end button"             "lib/public/modules/message-nav.js" "msg-nav-end"
check "Nav CSS file"               "lib/public/css/message-nav.css" "msg-nav-rail"

echo ""
echo "── Mobile Mode ──"
check "initMobileMode import"      "lib/public/app.js"              "initMobileMode"
check "nav-docked class"           "lib/public/modules/mobile-mode.js" "nav-docked"
check "mobile-typing class"        "lib/public/css/message-nav.css" "mobile-typing"

echo ""
echo "── Scroll Thresholds ──"
check "Break threshold"            "lib/public/app.js"              "80"

echo ""
echo "── Touchend Fix ──"
check "touchend listener"          "lib/public/modules/input.js"    "touchend"

echo ""
echo "── Expandable Command Blocks ──"
check "command block class (JS)"   "lib/public/modules/tools.js"    "tool-command-block"
check "command block class (CSS)"  "lib/public/css/messages.css"    "tool-command-block"

echo ""
echo "── Context Token Tracking ──"
check "lastContextTokens field"    "lib/sdk-bridge.js"              "lastContextTokens"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  %d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
