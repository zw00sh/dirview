#!/usr/bin/env node
// Evaluate a JS expression in the VSCode extension host via Node inspector on port 9223.
// Usage: node scripts/ext-eval.js 'expression'
// The expression runs in the extension host's global scope.

const expr = process.argv[2];
if (!expr) { console.error('Usage: node scripts/ext-eval.js <expression>'); process.exit(1); }

async function getWsUrl() {
  const resp = await fetch('http://localhost:9223/json');
  const targets = await resp.json();
  return targets[0]?.webSocketDebuggerUrl;
}

async function main() {
  const url = await getWsUrl();
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
