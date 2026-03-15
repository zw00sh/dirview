// @vitest-environment jsdom
//
// Benchmarks against a real directory tree (test-repos/source, ~3.7K files).
// Measures the actual end-to-end cost of search-related operations.

import { bench, describe, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createState, createRenderer,
  expandMatchedDirs, expandBatchFiles, buildAncestorPaths,
} from './index';
import type { DirNode, FileNode } from './types';

(globalThis as any).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
});
(globalThis as any).DEV_MODE = false;

// ── Build DirNode tree from real filesystem ──────────────────────────────

function scanDir(dirPath: string): DirNode {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const children: DirNode[] = [];
  const files: FileNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      children.push(scanDir(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1);
      const lang = ext === 'ts' ? 'TypeScript' : ext === 'js' ? 'JavaScript' : ext === 'py' ? 'Python' : ext || 'Other';
      files.push({
        path: fullPath,
        name: entry.name,
        langName: lang,
        langColor: '#999',
        sizeBytes: 100,
      } as FileNode);
    }
  }

  let totalFiles = files.length;
  for (const c of children) totalFiles += c.totalFiles;

  return {
    path: dirPath,
    name: path.basename(dirPath),
    children,
    files,
    totalFiles,
    sizeBytes: totalFiles * 100,
    stats: [{ name: 'Mixed', color: '#999', count: totalFiles }],
  } as DirNode;
}

function collectFilePaths(node: DirNode): string[] {
  const paths: string[] = [];
  for (const f of node.files || []) paths.push(f.path);
  for (const c of node.children) paths.push(...collectFilePaths(c));
  return paths;
}

function makeRenderer(state: any) {
  const rootEl = document.createElement('div');
  document.body.appendChild(rootEl);
  const tooltipEl = document.createElement('div');
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);
  return createRenderer(state, {
    vscode: { postMessage: () => {} } as any,
    root: rootEl,
    tooltip: tooltipEl,
    options: { skipDepthZeroGuides: false, barFactor: 0.4, barMaxWidth: 200, barFallbackWidth: 300 },
  });
}

// ── Load real tree ───────────────────────────────────────────────────────

const SOURCE_DIR = '/Users/zachge/projects/dirview/test-repos/source';
let realTree: DirNode;
let allFiles: string[];

beforeAll(() => {
  realTree = scanDir(SOURCE_DIR);
  allFiles = collectFilePaths(realTree);
  console.log(`Real tree: ${allFiles.length} files, scanning ${SOURCE_DIR}`);
});

// ── dirMatchesSearch on real tree ─────────────────────────────────────────

describe(`dirMatchesSearch — real tree (~${3771} files)`, () => {
  bench('with ancestor index (10% hit rate)', () => {
    const state = createState();
    const matchFiles = allFiles.filter((_, i) => i % 10 === 0);
    state.searchResults = new Map(matchFiles.map(p => [p, []]));
    state.searchAncestorPaths = buildAncestorPaths(matchFiles);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    renderer.dirMatchesSearch(realTree);
  });

  bench('without ancestor index, with language filter (10% hit rate)', () => {
    const state = createState();
    const matchFiles = allFiles.filter((_, i) => i % 10 === 0);
    state.searchResults = new Map(matchFiles.map(p => [p, []]));
    state.searchAncestorPaths = buildAncestorPaths(matchFiles);
    state.activeFilters = new Set(['TypeScript']); // forces recursive walk
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    renderer.dirMatchesSearch(realTree);
  });
});

// ── expandMatchedDirs on real tree ────────────────────────────────────────

describe(`expandMatchedDirs — real tree`, () => {
  bench('10% hit rate, no language filter', () => {
    const state = createState();
    const matchFiles = allFiles.filter((_, i) => i % 10 === 0);
    const searchResults = new Map(matchFiles.map(p => [p, []] as [string, any[]]));
    expandMatchedDirs(state, [realTree], searchResults, new Set());
  });

  bench('1% hit rate, no language filter', () => {
    const state = createState();
    const matchFiles = allFiles.filter((_, i) => i % 100 === 0);
    const searchResults = new Map(matchFiles.map(p => [p, []] as [string, any[]]));
    expandMatchedDirs(state, [realTree], searchResults, new Set());
  });
});

// ── expandBatchFiles on real tree ─────────────────────────────────────────

describe(`expandBatchFiles — real tree`, () => {
  bench('batch of 50 files', () => {
    const state = createState();
    expandBatchFiles(state, [realTree], new Set(allFiles.slice(0, 50)));
  });

  bench('10 sequential batches of 50 files', () => {
    const state = createState();
    for (let b = 0; b < 10; b++) {
      expandBatchFiles(state, [realTree], new Set(allFiles.slice(b * 50, (b + 1) * 50)));
    }
  });
});

// ── Full pipeline: expand + repeated renders ─────────────────────────────

describe(`full pipeline — real tree`, () => {
  bench('expand + 10 render cycles (10% hit)', () => {
    const state = createState();
    const matchFiles = allFiles.filter((_, i) => i % 10 === 0);
    const searchResults = new Map(matchFiles.map(p => [p, []] as [string, any[]]));
    state.searchResults = searchResults;
    expandMatchedDirs(state, [realTree], searchResults, new Set());
    const renderer = makeRenderer(state);
    for (let i = 0; i < 10; i++) {
      renderer.beforeRender();
      renderer.dirMatchesSearch(realTree);
    }
  });

  bench('5 batches of 50 + 5 render cycles each', () => {
    const state = createState();
    state.searchResults = new Map();
    const renderer = makeRenderer(state);
    for (let b = 0; b < 5; b++) {
      const batch = allFiles.slice(b * 50, (b + 1) * 50);
      for (const f of batch) state.searchResults.set(f, []);
      expandBatchFiles(state, [realTree], new Set(batch));
      for (let i = 0; i < 5; i++) {
        renderer.beforeRender();
        renderer.dirMatchesSearch(realTree);
      }
    }
  });
});
