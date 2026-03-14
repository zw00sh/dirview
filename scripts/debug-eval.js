#!/usr/bin/env node
// Unified webview debug eval script. Reads /tmp/dirview-debug.js and evaluates it in the
// specified frame via the extension host Node inspector (port 9223).
//
// Usage: node scripts/debug-eval.js [target]
//   target: sidebar | tab | languages | search | host | all (default: all)
//
// Recommended: npm run debug-eval [-- target]
//   The 'npm run:*' permission covers all variants — no per-invocation prompts needed.
//
// Workflow:
//   1. Write your script to /tmp/dirview-debug.js (use the Write tool)
//   2. Run: npm run debug-eval -- sidebar
//   3. The script runs inside the target webview frame and prints the result.
//
// 'host' target evals directly in the extension host's Node context (no webview bridge).
// All other targets route through globalThis.__dirviewDebugEval(script, target).
// The extension host must be running with --inspect-extensions=9223 (launch-cdp.sh).

const fs = require('fs');
const SCRIPT_PATH = '/tmp/dirview-debug.js';
const VALID_TARGETS = new Set(['sidebar', 'tab', 'languages', 'search', 'host', 'all']);

const target = process.argv[2] || 'all';
if (!VALID_TARGETS.has(target)) {
  console.error(`Unknown target: ${target}`);
  console.error(`Valid targets: ${[...VALID_TARGETS].join(' | ')}`);
  process.exit(1);
}

let scriptContent;
try {
  scriptContent = fs.readFileSync(SCRIPT_PATH, 'utf8');
} catch (err) {
  console.error(`Could not read ${SCRIPT_PATH}: ${err.message}`);
  console.error('Write your debug script to that path first, then run this again.');
  process.exit(1);
}

// For 'host' target: eval the script directly in the extension host Node context.
// For all other targets: call __dirviewDebugEval(script, target) to route through the
// webview postMessage bridge. The webview eval result is returned as a string.
const expr = target === 'host'
  ? scriptContent
  : `globalThis.__dirviewDebugEval(${JSON.stringify(scriptContent)}, ${JSON.stringify(target)})`;

async function main() {
  let resp;
  try {
    resp = await fetch('http://localhost:9223/json');
  } catch {
    console.error('Could not reach Node inspector on port 9223.');
    console.error('Is the extension host running? Launch with: ./scripts/launch-cdp.sh');
    process.exit(1);
  }

  const targets = await resp.json();
  const url = targets[0]?.webSocketDebuggerUrl;
  if (!url) {
    console.error('No extension host inspector target found on port 9223.');
    process.exit(1);
  }

  const ws = new WebSocket(url);
  let msgId = 0;
  let evalId;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }));
    evalId = ++msgId;
    ws.send(JSON.stringify({
      id: evalId,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== evalId) { return; }
    const r = msg.result?.result;
    if (r?.type === 'string') {
      console.log(r.value);
    } else if (r) {
      console.log(JSON.stringify(r, null, 2));
    }
    if (msg.result?.exceptionDetails) {
      console.error('Exception:', msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text);
    }
    ws.close();
    process.exit(0);
  });

  ws.addEventListener('error', (err) => {
    console.error('WebSocket error:', err.message || err);
    process.exit(1);
  });

  setTimeout(() => {
    console.error('Timeout waiting for result (10s).');
    process.exit(1);
  }, 10000);
}

main();
