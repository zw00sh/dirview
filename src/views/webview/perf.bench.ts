// @vitest-environment jsdom
import { bench, describe } from 'vitest';
import {
  createState, createRenderer,
  expandMatchedDirs, expandBatchFiles,
  renderTree, patchTreeChildren,
} from './index';
import type { DirNode, FileNode } from './types';

// Mock webview API
(globalThis as any).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
});

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
  const renderer = createRenderer(state, {
    vscode: { postMessage: () => {} } as any,
    root: rootEl,
    tooltip: tooltipEl,
    options: { skipDepthZeroGuides: false, barFactor: 0.4, barMaxWidth: 200, barFallbackWidth: 300 },
  }) as any;
  renderer._rootEl = rootEl;
  return renderer;
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

// ── DOM rendering benchmarks ─────────────────────────────────────────────

// Smaller tree for render benchmarks (DOM creation is expensive in jsdom)
// 4 dirs × 3 levels × 5 files = ~500 files, ~84 dirs
const renderTree4x3 = buildTree(4, 3, 5);

describe('renderDirNode — full tree render', () => {
  bench('84 dirs, all expanded (first render)', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    // Expand all dirs so the full tree is rendered
    function expandAll(node: DirNode) {
      state.expanded.set(node.path, true);
      for (const c of node.children) expandAll(c);
    }
    expandAll(renderTree4x3);
    renderer.beforeRender();
    renderer.renderDirNode(renderTree4x3, 0, 500, [], 300);
  });

  bench('84 dirs, depth 0+1 expanded only', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    state.expanded.set(renderTree4x3.path, true);
    for (const c of renderTree4x3.children) state.expanded.set(c.path, true);
    renderer.beforeRender();
    renderer.renderDirNode(renderTree4x3, 0, 500, [], 300);
  });
});

describe('renderTree + patchTreeChildren (incremental update)', () => {
  bench('full renderTree with patching (simulating rescan)', () => {
    const state = createState();
    state.lastRoots = [renderTree4x3];
    state.render = () => {};
    state.rerender = () => {};
    const renderer = makeRenderer(state);
    // Expand top 2 levels
    state.expanded.set(renderTree4x3.path, true);
    for (const c of renderTree4x3.children) state.expanded.set(c.path, true);
    const rootEl = renderer._rootEl;
    // First render — creates the tree
    renderTree(state, renderer, rootEl);
    // Subsequent renders — patch against existing tree
    renderTree(state, renderer, rootEl);
  });
});

describe('renderFileNode', () => {
  bench('100 file nodes', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const files = Array.from({ length: 100 }, (_, i) => makeFile('/ws', i));
    for (const f of files) renderer.renderFileNode(f, 3, []);
  });
});

describe('renderMatchLine — highlighted HTML + dedent', () => {
  bench('50 match lines with highlightedHtml', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/ws/a.ts', name: 'a.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 } as FileNode;
    const match = {
      line: 10,
      column: 8,
      matchLength: 5,
      lineText: '        const value = something;',
      highlightedHtml: '<span class="hl-kw">const</span> <span class="hl-var">value</span> = something;',
    };
    for (let i = 0; i < 50; i++) {
      renderer.renderMatchLine(file, [{ ...match, line: i + 1 }], 2, [], 4);
    }
  });

  bench('50 match lines plain text (no HTML)', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/ws/a.ts', name: 'a.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 } as FileNode;
    const match = {
      line: 10,
      column: 8,
      matchLength: 5,
      lineText: '        const value = something;',
    };
    for (let i = 0; i < 50; i++) {
      renderer.renderMatchLine(file, [{ ...match, line: i + 1 }], 2, [], 4);
    }
  });
});
