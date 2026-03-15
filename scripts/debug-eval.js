#!/usr/bin/env node
// Webview debug eval script. Reads /tmp/dirview-debug.js and evaluates it
// directly in the target webview frame via CDP (Chrome DevTools Protocol).
//
// Usage: node scripts/debug-eval.js [target] [script-path]
//   target: sidebar | tab | languages | host (default: tab)
//   script-path: path to JS file to evaluate (default: /tmp/dirview-debug.js)
//
// Recommended: npm run debug-eval [-- target [script-path]]
//
// Workflow:
//   1. Launch VSCode with CDP: ./scripts/launch-cdp.sh
//   2. Write your script to a file (e.g. /tmp/debug-script-foo.js)
//   3. Run: npm run debug-eval -- tab /tmp/debug-script-foo.js
//   4. The script runs inside the target webview frame and prints the result.
//
// How it works:
//   - Connects to CDP on port 9222 and finds webview iframe targets
//   - Identifies the inner content frame (where the extension's JS runs)
//   - Evaluates the script directly via Runtime.evaluate with awaitPromise
//   - No 3-second timeout limitation; async scripts work natively
//
// 'host' target evals in the extension host's Node context via port 9223.

const fs = require('fs');
const DEFAULT_SCRIPT_PATH = '/tmp/dirview-debug.js';
const CDP_PORT = 9222;
const HOST_PORT = 9223;
const VALID_TARGETS = new Set(['sidebar', 'tab', 'languages', 'host']);

// Extension IDs used to identify webview targets in CDP
const EXTENSION_ID = 'zwoosh.dirview';

const target = process.argv[2] || 'tab';
const scriptPath = process.argv[3] || DEFAULT_SCRIPT_PATH;
if (!VALID_TARGETS.has(target)) {
  console.error(`Unknown target: ${target}`);
  console.error(`Valid targets: ${[...VALID_TARGETS].join(' | ')}`);
  process.exit(1);
}

let scriptContent;
try {
  scriptContent = fs.readFileSync(scriptPath, 'utf8');
} catch (err) {
  console.error(`Could not read ${scriptPath}: ${err.message}`);
  console.error('Write your debug script to that path first, then run this again.');
  process.exit(1);
}

async function evalInHost() {
  let resp;
  try {
    resp = await fetch(`http://localhost:${HOST_PORT}/json`);
  } catch {
    console.error(`Could not reach Node inspector on port ${HOST_PORT}.`);
    console.error('Is the extension host running? Launch with: ./scripts/launch-cdp.sh');
    process.exit(1);
  }
  const targets = await resp.json();
  const url = targets[0]?.webSocketDebuggerUrl;
  if (!url) {
    console.error('No extension host inspector target found.');
    process.exit(1);
  }
  return evalViaWebSocket(url, scriptContent);
}

async function evalInWebview() {
  // 1. Find the webview iframe target
  let resp;
  try {
    resp = await fetch(`http://localhost:${CDP_PORT}/json`);
  } catch {
    console.error(`Could not reach CDP on port ${CDP_PORT}.`);
    console.error('Is VSCode running with CDP? Launch with: ./scripts/launch-cdp.sh');
    process.exit(1);
  }
  const targets = await resp.json();
  const dirviewIframes = targets.filter(t =>
    t.type === 'iframe' && t.url?.includes(EXTENSION_ID)
  );
  if (dirviewIframes.length === 0) {
    console.error(`No dirview webview iframe found. Is the ${target} view open?`);
    console.error('Available targets:', targets.map(t => `${t.type}: ${t.url?.slice(0, 60)}`).join('\n  '));
    process.exit(1);
  }
  // Tab panels (WebviewPanel) lack purpose=webviewView in the URL;
  // sidebar/languages views (WebviewViewProvider) include it.
  let iframeTarget;
  if (target === 'tab') {
    iframeTarget = dirviewIframes.find(t => !t.url.includes('purpose=webviewView'));
    if (!iframeTarget) {
      console.error('No tab iframe found. Is the Breakdown tab open?');
      process.exit(1);
    }
  } else {
    // sidebar and languages are both webviewView — pick by index:
    // they appear in registration order (sidebar first, languages second).
    const viewIframes = dirviewIframes.filter(t => t.url.includes('purpose=webviewView'));
    const idx = target === 'languages' ? 1 : 0;
    iframeTarget = viewIframes[idx];
    if (!iframeTarget) {
      console.error(`No ${target} iframe found. Is the ${target} view visible?`);
      process.exit(1);
    }
  }

  // 2. Connect to the iframe target and find the inner content frame
  const wsUrl = iframeTarget.webSocketDebuggerUrl;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    let innerContextId = null;
    let frameTreeId = null;
    let evalId = null;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: ++msgId, method: 'Page.enable' }));
      frameTreeId = ++msgId;
      ws.send(JSON.stringify({ id: frameTreeId, method: 'Page.getFrameTree' }));
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);

      // Get the inner frame ID from the frame tree
      if (msg.id === frameTreeId && msg.result?.frameTree?.childFrames) {
        const innerFrame = msg.result.frameTree.childFrames.find(
          f => f.frame.name === 'active-frame'
        );
        if (!innerFrame) {
          console.error('No active-frame found in webview frame tree.');
          ws.close();
          process.exit(1);
        }
        // The inner context may already have been reported via executionContextCreated
        // If not, we wait for it
        const innerFrameId = innerFrame.frame.id;

        // Check if we already captured the context
        if (innerContextId) {
          doEval(ws, msgId, innerContextId);
        } else {
          // Store the frame ID and wait for context
          ws._innerFrameId = innerFrameId;
        }
      }

      // Capture execution contexts — match by inner frame ID
      if (msg.method === 'Runtime.executionContextCreated') {
        const ctx = msg.params.context;
        if (ctx.auxData?.frameId === ws._innerFrameId ||
            (ctx.auxData?.isDefault && !innerContextId && ctx.origin?.includes('vscode-webview'))) {
          innerContextId = ctx.id;
          // If frame tree already returned, eval now
          if (ws._innerFrameId) {
            doEval(ws, msgId, innerContextId);
          }
        }
      }

      // Handle eval result
      if (evalId && msg.id === evalId) {
        const r = msg.result?.result;
        if (msg.result?.exceptionDetails) {
          console.error('ERROR:', msg.result.exceptionDetails.exception?.description ||
            msg.result.exceptionDetails.text);
        } else if (r?.type === 'string') {
          console.log(r.value);
        } else if (r?.value !== undefined) {
          console.log(JSON.stringify(r.value, null, 2));
        } else if (r) {
          console.log(JSON.stringify(r, null, 2));
        }
        ws.close();
        resolve();
      }
    });

    function doEval(ws, currentId, contextId) {
      if (evalId) return; // already sent
      evalId = currentId + 1;
      ws.send(JSON.stringify({
        id: evalId,
        method: 'Runtime.evaluate',
        params: {
          expression: scriptContent,
          contextId,
          returnByValue: true,
          awaitPromise: true,
        },
      }));
    }

    ws.addEventListener('error', (err) => {
      console.error('WebSocket error:', err.message || err);
      process.exit(1);
    });

    const timer = setTimeout(() => {
      console.error('Timeout waiting for result (30s).');
      ws.close();
      process.exit(1);
    }, 30000);
    timer.unref();
  });
}

async function evalViaWebSocket(url, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let msgId = 0;
    let evalId;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }));
      evalId = ++msgId;
      ws.send(JSON.stringify({
        id: evalId,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== evalId) return;
      const r = msg.result?.result;
      if (msg.result?.exceptionDetails) {
        console.error('ERROR:', msg.result.exceptionDetails.exception?.description ||
          msg.result.exceptionDetails.text);
      } else if (r?.type === 'string') {
        console.log(r.value);
      } else if (r?.value !== undefined) {
        console.log(JSON.stringify(r.value, null, 2));
      } else if (r) {
        console.log(JSON.stringify(r, null, 2));
      }
      ws.close();
      resolve();
    });

    ws.addEventListener('error', (err) => {
      console.error('WebSocket error:', err.message || err);
      process.exit(1);
    });

    const timer = setTimeout(() => {
      console.error('Timeout waiting for result (30s).');
      ws.close();
      process.exit(1);
    }, 30000);
    timer.unref();
  });
}

if (target === 'host') {
  evalInHost();
} else {
  evalInWebview();
}
