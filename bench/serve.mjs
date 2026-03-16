#!/usr/bin/env node
// Serves the bench harness and project assets on a local HTTP server.
// Usage: node bench/serve.mjs [--port N]
//
// Serves:
//   /bench/*          → bench/ directory (harness.html, fixtures/)
//   /out/*            → out/ directory (compiled webview bundles + CSS)
//
// Open: http://localhost:8787/bench/harness.html?fixture=fixtures/source.json

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
let port = 8787;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');

  // Only serve bench/ and out/ directories
  if (!relPath.startsWith('bench/') && !relPath.startsWith('out/')) {
    // Redirect root to harness
    if (relPath === '' || relPath === 'bench' || relPath === 'bench/') {
      res.writeHead(302, { Location: '/bench/harness.html' });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const absPath = path.join(projectRoot, relPath);

  // Prevent directory traversal
  if (!absPath.startsWith(projectRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(absPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Bench server: http://localhost:${port}/bench/harness.html`);
  console.log(`Press Ctrl+C to stop\n`);
  console.log('Available fixtures:');
  const fixturesDir = path.join(__dirname, 'fixtures');
  if (fs.existsSync(fixturesDir)) {
    for (const f of fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'))) {
      const size = (fs.statSync(path.join(fixturesDir, f)).size / 1024 / 1024).toFixed(1);
      console.log(`  http://localhost:${port}/bench/harness.html?fixture=fixtures/${f}  (${size} MB)`);
    }
  }
});
