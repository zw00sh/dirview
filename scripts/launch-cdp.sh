#!/bin/bash
# Launch a separate VSCode instance with Chrome DevTools Protocol enabled.
# Uses a temporary user-data-dir so it doesn't conflict with the main VSCode.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
USER_DATA_DIR="/tmp/vscode-cdp-debug"

# Build first
npm --prefix "$PROJECT_DIR" run compile

# Launch isolated VSCode instance with CDP on port 9222
exec /Applications/Visual\ Studio\ Code.app/Contents/MacOS/Code \
  --user-data-dir="$USER_DATA_DIR" \
  --extensionDevelopmentPath="$PROJECT_DIR" \
  --remote-debugging-port=9222
