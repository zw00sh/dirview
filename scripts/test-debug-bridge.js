#!/usr/bin/env node
// Verify syntax highlighting colors and debug bridge after CSS fix

async function getWsUrl() {
  const resp = await fetch('http://localhost:9223/json');
  const targets = await resp.json();
  return targets[0]?.webSocketDebuggerUrl;
}

function evalInHost(ws, expression) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        resolve(msg.result?.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
}

async function debugEval(ws, script) {
  const r = await evalInHost(ws, `globalThis.__dirviewDebugEval(${JSON.stringify(script)})`);
  return r?.value;
}

async function main() {
  const url = await getWsUrl();
  if (!url) { console.error('No extension host inspector on port 9223'); process.exit(1); }

  const ws = new WebSocket(url);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  ws.send(JSON.stringify({ id: 0, method: 'Runtime.enable' }));
  await new Promise(r => setTimeout(r, 2000));

  // Check bridge still works with data-debug gate
  console.log('--- Test 1: Bridge connectivity ---');
  const r1 = await debugEval(ws, 'document.title');
  console.log('title:', r1);
  if (!r1 || r1.includes('timeout')) {
    console.error('FAIL: bridge not working');
    ws.close();
    process.exit(1);
  }

  // Check data-debug attribute is present
  console.log('\n--- Test 2: data-debug attribute ---');
  const r2 = await debugEval(ws, 'document.body.hasAttribute("data-debug")');
  console.log('data-debug present:', r2);

  // Verify CSS variables now use hardcoded colors
  console.log('\n--- Test 3: Shiki CSS variables (should be hardcoded Dark+ colors) ---');
  const r3 = await debugEval(ws, `JSON.stringify({
    keyword: getComputedStyle(document.documentElement).getPropertyValue("--shiki-token-keyword").trim(),
    string: getComputedStyle(document.documentElement).getPropertyValue("--shiki-token-string").trim(),
    fn: getComputedStyle(document.documentElement).getPropertyValue("--shiki-token-function").trim(),
    comment: getComputedStyle(document.documentElement).getPropertyValue("--shiki-token-comment").trim(),
    constant: getComputedStyle(document.documentElement).getPropertyValue("--shiki-token-constant").trim(),
    parameter: getComputedStyle(document.documentElement).getPropertyValue("--shiki-token-parameter").trim(),
    foreground: getComputedStyle(document.documentElement).getPropertyValue("--shiki-foreground").trim()
  }, null, 2)`);
  console.log(r3);

  // Trigger search and check colored spans
  console.log('\n--- Test 4: Search and check syntax colors ---');
  await debugEval(ws, `(() => {
    const mainInput = document.querySelector(".search-main-input");
    mainInput.value = "ImmutableList";
    mainInput.dispatchEvent(new Event("input", {bubbles:true}));
    return "triggered";
  })()`);
  await new Promise(r => setTimeout(r, 3000));

  const r4 = await debugEval(ws, `(() => {
    const highlights = document.querySelectorAll(".match-highlight");
    if (highlights.length === 0) return "no highlights";

    // Find first match in a Java file (should have colorful tokens)
    for (const hl of highlights) {
      const li = hl.closest("li");
      if (!li) continue;
      const spans = li.querySelectorAll("span[style*='color']");
      if (spans.length < 3) continue;

      const info = [];
      for (const s of spans) {
        const computed = getComputedStyle(s);
        info.push({
          text: s.textContent?.slice(0, 30),
          color: computed.color,
          cssVar: s.style.color,
        });
      }
      return JSON.stringify(info, null, 2);
    }
    return "no multi-span matches found";
  })()`);
  console.log(r4);

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
