#!/usr/bin/env node
/**
 * Scanner performance benchmark: measures scan time with and without line counting.
 *
 * Compares two modes:
 *   1. "stat-only" — getFileMetrics returns { sizeBytes, lineCount: 0 } (stat only, no read)
 *   2. "with-lines" — getFileMetrics reads file contents and counts newlines (current impl)
 *
 * Usage:
 *   node bench/bench-scan.mjs <dir> [--iterations N]
 *
 * Example:
 *   node bench/bench-scan.mjs test-repos/source
 *   node bench/bench-scan.mjs ~/projects/linux --iterations 3
 */

import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
let targetDir = null;
let iterations = 5;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--iterations' && args[i + 1]) { iterations = parseInt(args[++i], 10); }
  else if (!args[i].startsWith('-')) { targetDir = args[i]; }
}

if (!targetDir) {
  console.error('Usage: node bench/bench-scan.mjs <dir> [--iterations N]');
  process.exit(1);
}

const absDir = path.resolve(targetDir);
if (!fs.existsSync(absDir)) {
  console.error(`Directory not found: ${absDir}`);
  process.exit(1);
}

const workerPath = path.resolve('out/scanWorker.js');
if (!fs.existsSync(workerPath)) {
  console.error('Run `npm run compile` first — out/scanWorker.js not found');
  process.exit(1);
}

// Spawn a fresh worker for each scan to avoid caching effects.
function runScan(folder) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    const id = 1;
    worker.on('message', (msg) => {
      if (msg.type === 'result' && msg.id === id) {
        worker.terminate();
        resolve({ totalFiles: msg.totalFiles, roots: msg.roots });
      } else if (msg.type === 'error' && msg.id === id) {
        worker.terminate();
        reject(new Error(msg.message));
      }
    });
    worker.postMessage({
      type: 'scan',
      id,
      folders: [{ fsPath: folder, name: path.basename(folder) }],
      maxDepth: 0,
      showIgnored: true,
      filesExcludePatterns: [[]],
    });
  });
}

// Stat-only scan: patches the worker to skip file reads.
// We do this by creating a thin wrapper that replaces getFileMetrics.
function runStatOnlyScan(folder) {
  return new Promise((resolve, reject) => {
    // We'll use a worker with a wrapper script that overrides getFileMetrics
    const wrapperCode = `
      const { parentPort } = require('worker_threads');
      const fs = require('fs');
      const path = require('path');

      const { IgnoreFilterBase } = (() => {
        // Minimal inline filter that accepts everything
        class IgnoreFilterBase {
          async initFromPatterns() {}
          shouldExcludeDirSync(name) { return name === '.git' || name === '.hg' || name === '.svn'; }
          shouldExcludeFileSync() { return false; }
          async loadLocalIgnoreByPath() { return { ignores: () => false, add: () => ({}) }; }
        }
        return { IgnoreFilterBase };
      })();

      async function parallelMap(items, fn, limit) {
        const results = new Array(items.length);
        let idx = 0;
        async function next() {
          while (idx < items.length) {
            const i = idx++;
            results[i] = await fn(items[i], i);
          }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
        return results;
      }

      async function getStatOnly(files) {
        return parallelMap(files, async ({ entryPath }) => {
          try { return { sizeBytes: (await fs.promises.stat(entryPath)).size, lineCount: 0 }; }
          catch { return { sizeBytes: 0, lineCount: 0 }; }
        }, 50);
      }

      function getLangInfo(filename) {
        return { name: 'Other', color: '#8b8b8b' };
      }

      const VCS = new Set(['.git', '.hg', '.svn', '.bzr', '_darcs']);

      async function scanDir(dirPath, name, relPath, visited, depth, maxDepth) {
        const key = dirPath;
        if (visited.has(key)) return { name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, totalLines: 0, files: [], children: [] };
        visited.add(key);
        const node = { name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, totalLines: 0, files: [], children: [] };
        if (maxDepth > 0 && depth > maxDepth) return node;
        let entries;
        try { entries = await fs.promises.readdir(dirPath, { withFileTypes: true }); } catch { return node; }
        const pendingDirs = [];
        const pendingFiles = [];
        for (const entry of entries) {
          const entryRelPath = relPath ? relPath + '/' + entry.name : entry.name;
          if (entry.isDirectory()) {
            if (VCS.has(entry.name)) continue;
            pendingDirs.push({ entryName: entry.name, entryRelPath, entryPath: path.join(dirPath, entry.name) });
          } else if (entry.isFile()) {
            pendingFiles.push({ entryName: entry.name, entryPath: path.join(dirPath, entry.name) });
          }
        }
        const childResults = await parallelMap(pendingDirs, ({ entryName, entryRelPath, entryPath }) =>
          scanDir(entryPath, entryName, entryRelPath, visited, depth + 1, maxDepth), 20);
        for (const child of childResults) {
          node.children.push(child);
          node.totalFiles += child.totalFiles;
          node.sizeBytes += child.sizeBytes;
        }
        const metrics = await getStatOnly(pendingFiles);
        for (let i = 0; i < pendingFiles.length; i++) {
          node.totalFiles++;
          node.sizeBytes += metrics[i].sizeBytes;
          node.files.push({ name: pendingFiles[i].entryName, path: pendingFiles[i].entryPath, langName: 'Other', langColor: '#8b8b8b', sizeBytes: metrics[i].sizeBytes, lineCount: 0 });
        }
        node.children.sort((a, b) => a.name.localeCompare(b.name));
        node.files.sort((a, b) => a.name.localeCompare(b.name));
        return node;
      }

      parentPort.on('message', async (msg) => {
        if (msg.type === 'scan') {
          try {
            const roots = await Promise.all(msg.folders.map(f => scanDir(f.fsPath, f.name, '', new Set(), 0, msg.maxDepth)));
            let totalFiles = 0;
            for (const r of roots) totalFiles += r.totalFiles;
            parentPort.postMessage({ type: 'result', id: msg.id, roots, totalFiles });
          } catch (err) {
            parentPort.postMessage({ type: 'error', id: msg.id, message: err.message });
          }
        }
      });
    `;

    const worker = new Worker(wrapperCode, { eval: true });
    const id = 1;
    worker.on('message', (msg) => {
      if (msg.type === 'result' && msg.id === id) {
        worker.terminate();
        resolve({ totalFiles: msg.totalFiles, roots: msg.roots });
      } else if (msg.type === 'error' && msg.id === id) {
        worker.terminate();
        reject(new Error(msg.message));
      }
    });
    worker.postMessage({
      type: 'scan',
      id,
      folders: [{ fsPath: folder, name: path.basename(folder) }],
      maxDepth: 0,
      showIgnored: true,
      filesExcludePatterns: [[]],
    });
  });
}

async function benchmark(label, fn, iters) {
  // Warmup
  await fn();

  const times = [];
  for (let i = 0; i < iters; i++) {
    const start = performance.now();
    const result = await fn();
    const elapsed = performance.now() - start;
    times.push(elapsed);
    if (i === 0) {
      console.log(`  ${label}: ${result.totalFiles} files`);
    }
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const min = times[0];
  const max = times[times.length - 1];
  return { label, median, mean, min, max, times };
}

console.log(`\nScanner benchmark: ${absDir}`);
console.log(`Iterations: ${iterations}\n`);

const statOnly = await benchmark('stat-only (no line counting)', () => runStatOnlyScan(absDir), iterations);
const withLines = await benchmark('with-lines (always-on)',       () => runScan(absDir), iterations);

console.log('\n── Results ──────────────────────────────────────────');
console.log(`${'Mode'.padEnd(35)} ${'Median'.padStart(8)} ${'Mean'.padStart(8)} ${'Min'.padStart(8)} ${'Max'.padStart(8)}`);
for (const r of [statOnly, withLines]) {
  console.log(`${r.label.padEnd(35)} ${r.median.toFixed(0).padStart(7)}ms ${r.mean.toFixed(0).padStart(7)}ms ${r.min.toFixed(0).padStart(7)}ms ${r.max.toFixed(0).padStart(7)}ms`);
}

const overhead = ((withLines.median / statOnly.median) - 1) * 100;
console.log(`\nLine counting overhead: ${overhead.toFixed(0)}% slower (median)`);
console.log(`Absolute difference: +${(withLines.median - statOnly.median).toFixed(0)}ms`);
