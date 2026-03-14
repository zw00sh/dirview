#!/usr/bin/env node
// Reads a webview debug script from a file and evaluates it via __dirviewDebugEval.
// Usage: node scripts/run-debug-script.js <script-file>

const fs = require('fs');
const scriptFile = process.argv[2];
if (!scriptFile) { console.error('Usage: node scripts/run-debug-script.js <script-file>'); process.exit(1); }

const scriptContent = fs.readFileSync(scriptFile, 'utf8');
const expr = `globalThis.__dirviewDebugEval(${JSON.stringify(scriptContent)})`;

async function main() {
  const resp = await fetch('http://localhost:9223/json');
  const targets = await resp.json();
  const url = targets[0]?.webSocketDebuggerUrl;
  if (!url) { console.error('No extension host inspector found on port 9223'); process.exit(1); }

  const ws = new WebSocket(url);
  let id = 0;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({
      id: ++id,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id === id) {
      const r = msg.result?.result;
      if (r?.type === 'string') console.log(r.value);
      else console.log(JSON.stringify(r, null, 2));
      ws.close();
      process.exit(0);
    }
  });

  setTimeout(() => { console.error('timeout'); process.exit(1); }, 10000);
}

main();
