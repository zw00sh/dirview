#!/usr/bin/env node
// Automated benchmark runner using CDP (Chrome DevTools Protocol).
// Usage: node bench/bench.mjs [fixture-path]
// Requires: npm install --save-dev chrome-launcher chrome-remote-interface

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamic imports for optional CDP dependencies
let launch, CDP;
try {
  launch = (await import('chrome-launcher')).launch;
  CDP = (await import('chrome-remote-interface')).default;
} catch {
  console.error('Missing dependencies. Install them with:');
  console.error('  npm install --save-dev chrome-launcher chrome-remote-interface');
  process.exit(1);
}

const fixturePath = process.argv[2] || 'fixtures/source.json';
const harnessFile = path.resolve(__dirname, 'harness.html');
const harnessUrl = `file://${harnessFile}?fixture=${fixturePath}&autorun`;

console.log(`Launching Chromium...`);
const chrome = await launch({
  chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,900'],
});

console.log(`Connecting to CDP on port ${chrome.port}...`);
const client = await CDP({ port: chrome.port });
const { Page, Runtime } = client;

await Page.enable();
await Runtime.enable();

console.log(`Navigating to harness (fixture: ${fixturePath})...`);
await Page.navigate({ url: harnessUrl });
await Page.loadEventFired();

// Wait for benchmark to complete (polls window.__benchResults)
console.log('Waiting for benchmark to complete...');
let results = null;
for (let i = 0; i < 300; i++) { // 30 second timeout
  await new Promise(r => setTimeout(r, 100));
  const { result } = await Runtime.evaluate({
    expression: 'window.__benchResults ? JSON.stringify(window.__benchResults) : null',
    returnByValue: true,
  });
  if (result.value) {
    results = JSON.parse(result.value);
    break;
  }
}

await client.close();
await chrome.kill();

if (!results) {
  console.error('Benchmark timed out');
  process.exit(1);
}

// Format and display results
function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    mean: arr.reduce((a, b) => a + b, 0) / arr.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

console.log('\n  Benchmark Results');
console.log('  ' + '='.repeat(60));
const rows = [];
for (const [label, values] of Object.entries(results)) {
  const s = stats(values);
  rows.push({ label, median: s.median.toFixed(1), mean: s.mean.toFixed(1), min: s.min.toFixed(1), max: s.max.toFixed(1) });
}
console.log('  ' + 'Test'.padEnd(16) + 'Median'.padStart(10) + 'Mean'.padStart(10) + 'Min'.padStart(10) + 'Max'.padStart(10));
console.log('  ' + '-'.repeat(56));
for (const r of rows) {
  console.log('  ' + r.label.padEnd(16) + (r.median + 'ms').padStart(10) + (r.mean + 'ms').padStart(10) + (r.min + 'ms').padStart(10) + (r.max + 'ms').padStart(10));
}
console.log();

// Output JSON for CI consumption
const jsonOut = path.resolve(__dirname, 'results.json');
const fs = await import('fs');
fs.writeFileSync(jsonOut, JSON.stringify({ fixture: fixturePath, results, timestamp: new Date().toISOString() }, null, 2));
console.log(`  Results written to ${jsonOut}`);
