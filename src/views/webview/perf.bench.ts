// @vitest-environment jsdom
import { bench, describe } from 'vitest';
import {
  createState, createRenderer,
  expandMatchedDirs, expandBatchFiles,
} from './shared';
import type { DirNode, FileNode } from './types';

// Mock webview API
(globalThis as any).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
});
(globalThis as any).DEV_MODE = false;

// ── Tree builders ────────────────────────────────────────────────────────

function makeFile(dir: string, i: number): FileNode {
  return {
    path: `${dir}/file${i}.ts`,
    name: `file${i}.ts`,
    langName: 'TypeScript',
    langColor: '#3178c6',
    sizeBytes: 100,
  } as FileNode;
}

/** Wide tree: `width` dirs at each level, `depth` levels deep, `filesPerDir` files per dir. */
function buildTree(width: number, depth: number, filesPerDir: number, prefix = '/ws'): DirNode {
  const files = Array.from({ length: filesPerDir }, (_, i) => makeFile(prefix, i));
  const children: DirNode[] = depth > 0
    ? Array.from({ length: width }, (_, i) => buildTree(width, depth - 1, filesPerDir, `${prefix}/d${i}`))
    : [];
  let totalFiles = files.length;
  for (const c of children) totalFiles += c.totalFiles;
  return {
    path: prefix,
    name: prefix.split('/').pop()!,
    children,
    files,
    totalFiles,
    sizeBytes: totalFiles * 100,
    stats: [{ name: 'TypeScript', color: '#3178c6', count: totalFiles }],
  } as DirNode;
}

/** Collect all file paths from a tree. */
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

// ── Trees ────────────────────────────────────────────────────────────────
// Wide: 5 dirs × 4 levels × 3 files = ~2K files, ~780 dirs
const wideTree = buildTree(5, 4, 3);
const wideFiles = collectFilePaths(wideTree);

// Deep: 2 dirs × 10 levels × 2 files = ~2K files, ~2K dirs
const deepTree = buildTree(2, 10, 2);
const deepFiles = collectFilePaths(deepTree);

// ── dirMatchesSearch benchmarks ──────────────────────────────────────────

describe('dirMatchesSearch — wide tree (~2K files)', () => {
  bench('full tree walk (10% hit rate)', () => {
    const state = createState();
    // 10% of files match
    const matchFiles = wideFiles.filter((_, i) => i % 10 === 0);
    state.searchResults = new Map(matchFiles.map(p => [p, []]));
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    renderer.dirMatchesSearch(wideTree);
  });

  bench('full tree walk (no matches)', () => {
    const state = createState();
    state.searchResults = new Map([['/nonexistent/file.ts', []]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    renderer.dirMatchesSearch(wideTree);
  });

  bench('repeated calls (cache hit)', () => {
    const state = createState();
    const matchFiles = wideFiles.filter((_, i) => i % 10 === 0);
    state.searchResults = new Map(matchFiles.map(p => [p, []]));
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    // First call populates cache
    renderer.dirMatchesSearch(wideTree);
    // Subsequent calls should hit cache
    for (let i = 0; i < 99; i++) renderer.dirMatchesSearch(wideTree);
  });
});

describe('dirMatchesSearch — deep tree (~2K files)', () => {
  bench('full tree walk (10% hit rate)', () => {
    const state = createState();
    const matchFiles = deepFiles.filter((_, i) => i % 10 === 0);
    state.searchResults = new Map(matchFiles.map(p => [p, []]));
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    renderer.dirMatchesSearch(deepTree);
  });
});

// ── expandMatchedDirs benchmarks ─────────────────────────────────────────

describe('expandMatchedDirs — wide tree', () => {
  bench('expand with 10% hit rate', () => {
    const state = createState();
    const matchFiles = wideFiles.filter((_, i) => i % 10 === 0);
    const searchResults = new Map(matchFiles.map(p => [p, []] as [string, any[]]));
    expandMatchedDirs(state, [wideTree], searchResults, new Set());
  });

  bench('expand with 100% hit rate', () => {
    const state = createState();
    const searchResults = new Map(wideFiles.map(p => [p, []] as [string, any[]]));
    expandMatchedDirs(state, [wideTree], searchResults, new Set());
  });
});

describe('expandMatchedDirs — deep tree', () => {
  bench('expand with 10% hit rate', () => {
    const state = createState();
    const matchFiles = deepFiles.filter((_, i) => i % 10 === 0);
    const searchResults = new Map(matchFiles.map(p => [p, []] as [string, any[]]));
    expandMatchedDirs(state, [deepTree], searchResults, new Set());
  });
});

// ── expandBatchFiles benchmarks ──────────────────────────────────────────

describe('expandBatchFiles — wide tree', () => {
  bench('batch of 50 files', () => {
    const state = createState();
    const batch = new Set(wideFiles.slice(0, 50));
    expandBatchFiles(state, [wideTree], batch);
  });

  bench('5 sequential batches of 50 files', () => {
    const state = createState();
    for (let b = 0; b < 5; b++) {
      const batch = new Set(wideFiles.slice(b * 50, (b + 1) * 50));
      expandBatchFiles(state, [wideTree], batch);
    }
  });
});

// ── beforeRender cache reset overhead ────────────────────────────────────

describe('beforeRender + dirMatchesSearch (simulating expand/collapse)', () => {
  bench('10 renders with unchanged searchResults', () => {
    const state = createState();
    const matchFiles = wideFiles.filter((_, i) => i % 10 === 0);
    state.searchResults = new Map(matchFiles.map(p => [p, []]));
    const renderer = makeRenderer(state);
    for (let i = 0; i < 10; i++) {
      renderer.beforeRender();
      renderer.dirMatchesSearch(wideTree);
    }
  });
});

// ── Full pipeline: expand + render (the real-world scenario) ─────────────

describe('full pipeline: expandMatchedDirs + 5 renders with dirMatchesSearch', () => {
  bench('wide tree, 10% hit rate', () => {
    const state = createState();
    const matchFiles = wideFiles.filter((_, i) => i % 10 === 0);
    const searchResults = new Map(matchFiles.map(p => [p, []] as [string, any[]]));
    state.searchResults = searchResults;
    expandMatchedDirs(state, [wideTree], searchResults, new Set());
    const renderer = makeRenderer(state);
    for (let i = 0; i < 5; i++) {
      renderer.beforeRender();
      renderer.dirMatchesSearch(wideTree);
    }
  });

  bench('deep tree, 10% hit rate', () => {
    const state = createState();
    const matchFiles = deepFiles.filter((_, i) => i % 10 === 0);
    const searchResults = new Map(matchFiles.map(p => [p, []] as [string, any[]]));
    state.searchResults = searchResults;
    expandMatchedDirs(state, [deepTree], searchResults, new Set());
    const renderer = makeRenderer(state);
    for (let i = 0; i < 5; i++) {
      renderer.beforeRender();
      renderer.dirMatchesSearch(deepTree);
    }
  });
});
