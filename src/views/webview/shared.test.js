// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

let S; // DirviewShared

beforeAll(() => {
  const code = readFileSync(join(__dirname, 'shared.js'), 'utf-8');
  // Execute the IIFE which sets window.DirviewShared
  // eslint-disable-next-line no-new-func
  Function(code)();
  S = window.DirviewShared;
});

// --- escHtml ---
describe('escHtml', () => {
  it('escapes &', () => expect(S.escHtml('a&b')).toBe('a&amp;b'));
  it('escapes <', () => expect(S.escHtml('a<b')).toBe('a&lt;b'));
  it('escapes >', () => expect(S.escHtml('a>b')).toBe('a&gt;b'));
  it('escapes "', () => expect(S.escHtml('a"b')).toBe('a&quot;b'));
  it('leaves plain strings unchanged', () => expect(S.escHtml('hello')).toBe('hello'));
  it('escapes all entities in one string', () => {
    expect(S.escHtml('<script src="x.js">alert(1)&done</script>'))
      .toBe('&lt;script src=&quot;x.js&quot;&gt;alert(1)&amp;done&lt;/script&gt;');
  });
});

// --- formatBytes ---
describe('formatBytes', () => {
  it('returns "0 B" for 0', () => expect(S.formatBytes(0)).toBe('0 B'));
  it('returns bytes for < 1024', () => expect(S.formatBytes(512)).toBe('512 B'));
  it('returns KB for 1024', () => expect(S.formatBytes(1024)).toBe('1 KB'));
  it('returns KB for values in KB range', () => expect(S.formatBytes(1536)).toBe('2 KB'));
  it('returns MB for 1024*1024', () => expect(S.formatBytes(1024 * 1024)).toBe('1 MB'));
  it('returns MB for values in MB range', () => expect(S.formatBytes(2 * 1024 * 1024)).toBe('2 MB'));
});

// --- sortDirs ---
describe('sortDirs', () => {
  const dirs = [
    { name: 'b', totalFiles: 5, sizeBytes: 200 },
    { name: 'a', totalFiles: 10, sizeBytes: 100 },
    { name: 'c', totalFiles: 1, sizeBytes: 300 },
  ];

  it('sorts by file count desc in "files" mode', () => {
    const result = S.sortDirs(dirs, 'files');
    expect(result.map(d => d.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts alphabetically in "name" mode', () => {
    const result = S.sortDirs(dirs, 'name');
    expect(result.map(d => d.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by size desc in "size" mode', () => {
    const result = S.sortDirs(dirs, 'size');
    expect(result.map(d => d.name)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate input', () => {
    const original = [...dirs];
    S.sortDirs(dirs, 'files');
    expect(dirs).toEqual(original);
  });
});

// --- sortFiles ---
describe('sortFiles', () => {
  const files = [
    { name: 'zebra.ts' },
    { name: 'alpha.ts' },
    { name: 'Middle.ts' },
  ];

  it('sorts alphabetically', () => {
    const result = S.sortFiles(files);
    expect(result.map(f => f.name)).toEqual(['alpha.ts', 'Middle.ts', 'zebra.ts']);
  });

  it('does not mutate input', () => {
    const original = [...files];
    S.sortFiles(files);
    expect(files).toEqual(original);
  });
});

// --- computeMaxMetric ---
describe('computeMaxMetric', () => {
  function makeNode(totalFiles, sizeBytes, children = []) {
    return { totalFiles, sizeBytes, children };
  }

  it('returns max totalFiles among non-root nodes', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(60, 600, []),
        makeNode(40, 400, []),
      ]),
    ];
    expect(S.computeMaxMetric(roots, 'files')).toBe(60);
  });

  it('returns max sizeBytes in size mode', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(60, 600, []),
        makeNode(40, 900, []),
      ]),
    ];
    expect(S.computeMaxMetric(roots, 'size')).toBe(900);
  });

  it('walks nested children', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(50, 500, [
          makeNode(30, 300, []),
          makeNode(20, 200, []),
        ]),
      ]),
    ];
    expect(S.computeMaxMetric(roots, 'files')).toBe(50);
  });

  it('returns 1 when all children have 0 files', () => {
    const roots = [makeNode(0, 0, [makeNode(0, 0, [])])];
    expect(S.computeMaxMetric(roots, 'files')).toBe(1);
  });

  it('skips root nodes (they are always 100%)', () => {
    const roots = [makeNode(999, 99999, [makeNode(10, 100, [])])];
    expect(S.computeMaxMetric(roots, 'files')).toBe(10);
  });

  it('returns cached value for same roots/sortMode reference', () => {
    const roots = [makeNode(50, 500, [makeNode(20, 200, [])])];
    const first = S.computeMaxMetric(roots, 'files');
    // Mutate a child — if caching works, result won't change
    roots[0].children[0].totalFiles = 999;
    const second = S.computeMaxMetric(roots, 'files');
    expect(second).toBe(first);
  });
});

// --- groupEmptyDirs ---
describe('groupEmptyDirs', () => {
  function dir(name, totalFiles) { return { name, totalFiles, children: [] }; }

  it('passes through non-empty dirs unchanged', () => {
    const input = [dir('a', 5), dir('b', 3)];
    const result = S.groupEmptyDirs(input);
    expect(result).toEqual([
      { type: 'dir', node: input[0] },
      { type: 'dir', node: input[1] },
    ]);
  });

  it('groups 2+ consecutive empty dirs', () => {
    const input = [dir('a', 0), dir('b', 0), dir('c', 5)];
    const result = S.groupEmptyDirs(input);
    expect(result[0].type).toBe('emptyGroup');
    expect(result[0].nodes).toHaveLength(2);
    expect(result[1]).toEqual({ type: 'dir', node: input[2] });
  });

  it('does not group a single empty dir', () => {
    const input = [dir('a', 0), dir('b', 5)];
    const result = S.groupEmptyDirs(input);
    expect(result[0]).toEqual({ type: 'dir', node: input[0] });
    expect(result[1]).toEqual({ type: 'dir', node: input[1] });
  });

  it('handles all empty dirs', () => {
    const input = [dir('a', 0), dir('b', 0), dir('c', 0)];
    const result = S.groupEmptyDirs(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('emptyGroup');
    expect(result[0].nodes).toHaveLength(3);
  });

  it('handles empty input', () => {
    expect(S.groupEmptyDirs([])).toEqual([]);
  });
});

// --- computeStats ---
describe('computeStats', () => {
  function makeRoot(stats, totalFiles) { return { stats, totalFiles }; }

  it('aggregates counts across roots', () => {
    const roots = [
      makeRoot([{ name: 'TypeScript', color: '#3178c6', count: 10 }], 10),
      makeRoot([{ name: 'TypeScript', color: '#3178c6', count: 5 }, { name: 'CSS', color: '#563d7c', count: 3 }], 8),
    ];
    const result = S.computeStats(roots);
    const ts = result.find(r => r.name === 'TypeScript');
    expect(ts.count).toBe(15);
    const css = result.find(r => r.name === 'CSS');
    expect(css.count).toBe(3);
  });

  it('sorts by count descending', () => {
    const roots = [
      makeRoot([
        { name: 'A', color: '#aaa', count: 3 },
        { name: 'B', color: '#bbb', count: 10 },
      ], 13),
    ];
    const result = S.computeStats(roots);
    expect(result[0].name).toBe('B');
    expect(result[1].name).toBe('A');
  });

  it('computes percentage strings', () => {
    const roots = [makeRoot([{ name: 'JS', color: '#f1e05a', count: 1 }], 2)];
    const result = S.computeStats(roots);
    expect(result[0].pct).toBe('50.0');
  });

  it('handles empty roots', () => {
    expect(S.computeStats([])).toEqual([]);
  });
});

// --- dir hover action buttons ---

function makeDir(path, name, { children = [], files = [], totalFiles = 0, sizeBytes = 0, stats = [] } = {}) {
  return { path, name, children, files, totalFiles, sizeBytes, stats };
}

function makeRenderer(state) {
  const vscode = { postMessage: () => {} };
  const rootEl = document.createElement('div');
  document.body.appendChild(rootEl);
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'bar-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);
  const renderer = S.createRenderer(state, {
    vscode,
    root: rootEl,
    tooltip: tooltipEl,
    options: { skipDepthZeroGuides: false, barFactor: 0.4, barMaxWidth: 200, barFallbackWidth: 300 },
  });
  return renderer;
}

describe('dir hover action buttons', () => {
  it('expand button expands the dir itself and direct children when not all children are expanded', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];

    // Two grandchildren each so neither child compacts — compaction requires exactly 1 child
    const gc1 = makeDir('/r/a/x', 'x', { totalFiles: 2, stats: [] });
    const gc2 = makeDir('/r/a/y', 'y', { totalFiles: 3, stats: [] });
    const child1 = makeDir('/r/a', 'a', { children: [gc1, gc2], totalFiles: 5, stats: [] });
    const gc3 = makeDir('/r/b/p', 'p', { totalFiles: 1, stats: [] });
    const gc4 = makeDir('/r/b/q', 'q', { totalFiles: 2, stats: [] });
    const child2 = makeDir('/r/b', 'b', { children: [gc3, gc4], totalFiles: 3, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 8, stats: [] });
    // child1 expanded, child2 not — so not all expandable children are expanded
    state.expanded.set('/r/a', true);

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);
    li.querySelector('.dir-action-btn[title="Expand children"]').click();

    expect(state.expanded.get('/r')).toBe(true);
    expect(state.expanded.get('/r/a')).toBe(true);
    expect(state.expanded.get('/r/b')).toBe(true);
    // Grandchildren should NOT be expanded — only direct children
    expect(state.expanded.get('/r/a/x')).toBeFalsy();
    expect(state.expanded.get('/r/a/y')).toBeFalsy();
    expect(state.render).toHaveBeenCalledOnce();
  });

  it('expand button triggers recursive expand even when some children are leaves (no sub-dirs)', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];

    const gc1 = makeDir('/r/a/x', 'x', { totalFiles: 2, stats: [] });
    const gc2 = makeDir('/r/a/y', 'y', { totalFiles: 3, stats: [] });
    const child1 = makeDir('/r/a', 'a', { children: [gc1, gc2], totalFiles: 5, stats: [] });
    // child2 is a leaf — no sub-directories, only files
    const child2 = makeDir('/r/b', 'b', {
      files: [{ name: 'f.js', path: '/r/b/f.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 10 }],
      totalFiles: 1, stats: [],
    });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 6, stats: [] });
    // child1 is expanded; child2 is a leaf so it can't be expanded
    state.expanded.set('/r/a', true);

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);
    li.querySelector('.dir-action-btn[title="Expand children"]').click();

    // child2 being a leaf should not block recursive expand
    expect(state.expanded.get('/r/a/x')).toBe(true);
    expect(state.expanded.get('/r/a/y')).toBe(true);
  });

  it('expand button recursively expands all descendants when all direct children are already expanded', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];

    const gc1 = makeDir('/r/a/x', 'x', { totalFiles: 2, stats: [] });
    const gc2 = makeDir('/r/a/y', 'y', { totalFiles: 3, stats: [] });
    const child1 = makeDir('/r/a', 'a', { children: [gc1, gc2], totalFiles: 5, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 3, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 8, stats: [] });
    // Both direct children already expanded
    state.expanded.set('/r/a', true);
    state.expanded.set('/r/b', true);

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);
    li.querySelector('.dir-action-btn[title="Expand children"]').click();

    // Grandchildren should now also be expanded
    expect(state.expanded.get('/r/a/x')).toBe(true);
    expect(state.expanded.get('/r/a/y')).toBe(true);
    expect(state.render).toHaveBeenCalledOnce();
  });

  it('collapse button sets each direct child path to collapsed and calls render', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];
    state.expanded.set('/r', true);
    state.expanded.set('/r/a', true);
    state.expanded.set('/r/b', true);

    const child1 = makeDir('/r/a', 'a', { totalFiles: 5, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 3, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 8, stats: [] });

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);

    const collapseBtn = li.querySelector('.dir-action-btn[title="Collapse children"]');
    expect(collapseBtn).not.toBeNull();
    collapseBtn.click();

    expect(state.expanded.get('/r/a')).toBe(false);
    expect(state.expanded.get('/r/b')).toBe(false);
    expect(state.render).toHaveBeenCalledOnce();
  });

  it('collapse button does not collapse the dir itself when some children are expanded', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];
    state.expanded.set('/r', true);
    state.expanded.set('/r/a', true);
    // /r/b is not expanded

    const child1 = makeDir('/r/a', 'a', { totalFiles: 5, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 3, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 8, stats: [] });

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);
    li.querySelector('.dir-action-btn[title="Collapse children"]').click();

    // Children collapsed, but parent stays expanded
    expect(state.expanded.get('/r/a')).toBe(false);
    expect(state.expanded.get('/r/b')).toBe(false);
    expect(state.expanded.get('/r')).toBe(true);
  });

  it('collapse button also collapses the dir itself when all children are already collapsed', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];
    state.expanded.set('/r', true);
    // Both children already collapsed (not in expanded map → falsy)

    const child1 = makeDir('/r/a', 'a', { totalFiles: 5, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 3, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 8, stats: [] });

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);
    li.querySelector('.dir-action-btn[title="Collapse children"]').click();

    expect(state.expanded.get('/r')).toBe(false);
  });

  it('open-in-tab button posts openDirInTab message with directory path', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];

    // Two children so parent doesn't compact — displayNode stays as parent
    const child1 = makeDir('/r/a', 'a', { totalFiles: 3, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 2, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 5, stats: [] });

    const postMessage = vi.fn();
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    const tooltipEl = document.createElement('div');
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    const renderer = S.createRenderer(state, {
      vscode: { postMessage },
      root: rootEl,
      tooltip: tooltipEl,
      options: { skipDepthZeroGuides: false, barFactor: 0.4, barMaxWidth: 200, barFallbackWidth: 300 },
    });
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);

    const openInTabBtn = li.querySelector('.dir-action-btn[title="Open in new tab"]');
    expect(openInTabBtn).not.toBeNull();
    openInTabBtn.click();

    expect(postMessage).toHaveBeenCalledWith({ command: 'openDirInTab', path: '/r' });
    // No re-render — just posts message to host
    expect(state.render).not.toHaveBeenCalled();
  });

  it('shows all three buttons when dir has child dirs', () => {
    const state = S.createState();
    state.render = () => {};
    state.lastRoots = [];

    // Two children so parent doesn't compact — displayNode stays as parent
    const child1 = makeDir('/r/a', 'a', { totalFiles: 3, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 2, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 5, stats: [] });

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);

    // Scope to the parent's own row, not child rows
    const btns = li.querySelectorAll(':scope > .dir-row .dir-action-btn');
    expect(btns).toHaveLength(3);
    const titles = Array.from(btns).map(b => b.title);
    expect(titles).toContain('Expand children');
    expect(titles).toContain('Collapse children');
    expect(titles).toContain('Open in new tab');
  });

  it('shows only open-in-tab button when dir has no child dirs', () => {
    const state = S.createState();
    state.render = () => {};
    state.lastRoots = [];

    // Dir with files but no child dirs
    const leaf = makeDir('/r', 'r', {
      files: [{ name: 'a.js', path: '/r/a.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 }],
      totalFiles: 1,
      stats: [{ name: 'JavaScript', color: '#f1e05a', count: 1 }],
    });

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(leaf, 0, 10, [], 300);

    const btns = li.querySelectorAll(':scope > .dir-row .dir-action-btn');
    expect(btns).toHaveLength(1);
    expect(btns[0].title).toBe('Open in new tab');
  });

  it('expand button does not trigger row click (stopPropagation)', () => {
    // The row's own click handler toggles the current dir's expansion.
    // Clicking the expand-children button should NOT toggle the current dir.
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];
    // Pre-mark parent as expanded
    state.expanded.set('/r', true);

    // Two children so parent doesn't compact — expand/collapse buttons are present
    const child1 = makeDir('/r/a', 'a', { totalFiles: 3, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 2, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 5, stats: [] });

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(parent, 0, 10, [], 300);

    const expandBtn = li.querySelector('.dir-action-btn[title="Expand children"]');
    expandBtn.click();

    // Parent's own expanded state should be unchanged (still true)
    expect(state.expanded.get('/r')).toBe(true);
  });

  it('expand children on a dir whose child compacts sets the compacted path', () => {
    // P has child A; A has one child B and no files → A compacts to B.
    // Expanding P's children should expand A/B (the compacted displayNode), not just A.
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];

    const grandchild = makeDir('/p/a/b', 'b', { totalFiles: 5, stats: [] });
    // A: single child, no files → will compact to B
    const childA = makeDir('/p/a', 'a', { children: [grandchild], totalFiles: 5, stats: [] });
    // P: has file so P itself doesn't compact
    const P = makeDir('/p', 'p', {
      children: [childA],
      files: [{ name: 'p.txt', path: '/p/p.txt', langName: 'Text', langColor: '#aaa', sizeBytes: 10 }],
      totalFiles: 6,
      stats: [],
    });

    const renderer = makeRenderer(state);
    const li = renderer.renderDirNode(P, 0, 10, [], 300);

    const expandBtn = li.querySelector('.dir-action-btn[title="Expand children"]');
    expandBtn.click();

    // The compacted displayNode path for A is B (/p/a/b), not A (/p/a).
    // renderDirNode(A) will compact to B and check state.expanded.get('/p/a/b').
    expect(state.expanded.get('/p/a/b')).toBe(true);
  });
});

// --- tieredExpandAll ---
// Workspace folder nodes (roots) are always-visible containers; their CHILDREN are
// the first expandable items in the tree. Tests model this correctly:
// makeWorkspace() returns a workspace node whose children are the top-level items.

describe('tieredExpandAll', () => {
  // ws → [a → [ax, ay], b → [bp, bq]] (both a and b have 2 children so neither compacts)
  function makeWorkspace() {
    const ax = makeDir('/ws/a/x', 'x', { totalFiles: 1 });
    const ay = makeDir('/ws/a/y', 'y', { totalFiles: 1 });
    const bp = makeDir('/ws/b/p', 'p', { totalFiles: 1 });
    const bq = makeDir('/ws/b/q', 'q', { totalFiles: 1 });
    const a = makeDir('/ws/a', 'a', { children: [ax, ay], totalFiles: 2 });
    const b = makeDir('/ws/b', 'b', { children: [bp, bq], totalFiles: 2 });
    const ws = makeDir('/ws', 'ws', { children: [a, b], totalFiles: 4 });
    return { ws, a, b, ax, ay, bp, bq };
  }

  it('tier 1: expands top-level items when none are expanded', () => {
    const { ws } = makeWorkspace();
    const state = S.createState();
    S.tieredExpandAll(state, [ws]);
    expect(state.expanded.get('/ws/a')).toBe(true);
    expect(state.expanded.get('/ws/b')).toBe(true);
    // 2nd-level should NOT be expanded
    expect(state.expanded.get('/ws/a/x')).toBeFalsy();
    expect(state.expanded.get('/ws/b/p')).toBeFalsy();
  });

  it('tier 1: expands all top-level items even when only some are expanded', () => {
    const { ws } = makeWorkspace();
    const state = S.createState();
    state.expanded.set('/ws/a', true); // a expanded, b not
    S.tieredExpandAll(state, [ws]);
    expect(state.expanded.get('/ws/a')).toBe(true);
    expect(state.expanded.get('/ws/b')).toBe(true);
    // 2nd-level should NOT be expanded (still tier 1)
    expect(state.expanded.get('/ws/a/x')).toBeFalsy();
  });

  it('tier 2: recursively expands all when all top-level are expanded', () => {
    // ws → [a → [a1 → [a1_x, a1_y]]]
    const a1x = makeDir('/ws/a/a1/x', 'x', { totalFiles: 1 });
    const a1y = makeDir('/ws/a/a1/y', 'y', { totalFiles: 1 });
    const a1 = makeDir('/ws/a/a1', 'a1', { children: [a1x, a1y], totalFiles: 2 });
    const a2 = makeDir('/ws/a/a2', 'a2', { totalFiles: 1 }); // leaf
    const a = makeDir('/ws/a', 'a', { children: [a1, a2], totalFiles: 3 });
    const ws = makeDir('/ws', 'ws', { children: [a], totalFiles: 3 });
    const state = S.createState();
    state.expanded.set('/ws/a', true); // top-level expanded → tier 2
    S.tieredExpandAll(state, [ws]);
    // Tier 2: walkExpand — all descendants should now be expanded
    expect(state.expanded.get('/ws/a/a1')).toBe(true);
    expect(state.expanded.get('/ws/a/a1/x')).toBe(true);
    expect(state.expanded.get('/ws/a/a1/y')).toBe(true);
  });

  it('top-level leaf items count as already expanded for tier promotion', () => {
    // ws → [a → [a1 → [a1x, a1y], a2 → [a2p, a2q]], b (leaf)]
    // a has 2 children → NOT compacted; a1/a2 each have 2 children.
    // b is a leaf — counts as already expanded so tier 2 fires instead of re-doing tier 1.
    const a1x = makeDir('/ws/a/a1/x', 'x', { totalFiles: 1 });
    const a1y = makeDir('/ws/a/a1/y', 'y', { totalFiles: 1 });
    const a2p = makeDir('/ws/a/a2/p', 'p', { totalFiles: 1 });
    const a2q = makeDir('/ws/a/a2/q', 'q', { totalFiles: 1 });
    const a1 = makeDir('/ws/a/a1', 'a1', { children: [a1x, a1y], totalFiles: 2 });
    const a2 = makeDir('/ws/a/a2', 'a2', { children: [a2p, a2q], totalFiles: 2 });
    const a = makeDir('/ws/a', 'a', { children: [a1, a2], totalFiles: 4 });
    const b = makeDir('/ws/b', 'b', { totalFiles: 1 }); // leaf
    const ws = makeDir('/ws', 'ws', { children: [a, b], totalFiles: 5 });
    const state = S.createState();
    state.expanded.set('/ws/a', true); // a expanded (2 children → path stays '/ws/a')
    // b is leaf → counts as expanded → allTopExpanded = true → tier 2 fires
    S.tieredExpandAll(state, [ws]);
    // Tier 2: walkExpand — all descendants recursively expanded
    expect(state.expanded.get('/ws/a/a1')).toBe(true);
    expect(state.expanded.get('/ws/a/a2')).toBe(true);
    expect(state.expanded.get('/ws/a/a1/x')).toBe(true);
    expect(state.expanded.get('/ws/a/a2/p')).toBe(true);
  });

  it('works with multiple workspace roots', () => {
    const a1 = makeDir('/ws1/a', 'a', { totalFiles: 1 });
    const a2 = makeDir('/ws1/b', 'b', { totalFiles: 1 });
    const ws1 = makeDir('/ws1', 'ws1', { children: [a1, a2], totalFiles: 2 });
    const b1 = makeDir('/ws2/c', 'c', { totalFiles: 1 });
    const ws2 = makeDir('/ws2', 'ws2', { children: [b1], totalFiles: 1 });
    const state = S.createState();
    S.tieredExpandAll(state, [ws1, ws2]);
    // Leaves — none have children — tier 1 has nothing to expand since all are leaves
    // (leaves count as already expanded in tier checks, so tier 2 fires but is a no-op)
    // No errors thrown
  });
});

// --- tieredCollapseAll ---

describe('tieredCollapseAll', () => {
  // ws → [a → [ax → [ax_deep, ax_other]], b → [bx, by]]
  // a: 1 child ax, no files → compacts to ax. ax: 2 children → NOT compacted (prevents chain).
  // compactedNode(a) = ax, compactedPath(a) = '/ws/a/ax'.
  function makeWorkspace() {
    const ax_deep = makeDir('/ws/a/ax/deep', 'deep', { totalFiles: 1 });
    const ax_other = makeDir('/ws/a/ax/other', 'other', { totalFiles: 1 });
    const ax = makeDir('/ws/a/ax', 'ax', { children: [ax_deep, ax_other], totalFiles: 2 });
    const a = makeDir('/ws/a', 'a', { children: [ax], totalFiles: 2 }); // 1 child → compacts to ax
    const bx = makeDir('/ws/b/x', 'x', { totalFiles: 1 });
    const by = makeDir('/ws/b/y', 'y', { totalFiles: 1 });
    const b = makeDir('/ws/b', 'b', { children: [bx, by], totalFiles: 2 });
    const ws = makeDir('/ws', 'ws', { children: [a, b], totalFiles: 4 });
    return { ws, a, b, ax, ax_deep, bx, by };
  }

  it('tier 3 (no-op): does nothing when no top-level items are expanded', () => {
    const { ws } = makeWorkspace();
    const state = S.createState();
    S.tieredCollapseAll(state, [ws]);
    expect(state.expanded.get('/ws/a/ax')).toBeFalsy();
    expect(state.expanded.get('/ws/b')).toBeFalsy();
  });

  it('tier 2: collapses all top-level items when none have expanded descendants', () => {
    const { ws } = makeWorkspace();
    const state = S.createState();
    // a compacts to ax → compacted path = '/ws/a/ax'
    // b has 2 children → NOT compacted, path = '/ws/b'
    state.expanded.set('/ws/a/ax', true);
    state.expanded.set('/ws/b', true);
    S.tieredCollapseAll(state, [ws]);
    expect(state.expanded.get('/ws/a/ax')).toBe(false);
    expect(state.expanded.get('/ws/b')).toBe(false);
  });

  it('tier 1: collapses deeper descendants only, keeping top-level items open', () => {
    const { ws } = makeWorkspace();
    const state = S.createState();
    state.expanded.set('/ws/a/ax', true);       // top-level (a compacted to ax)
    state.expanded.set('/ws/a/ax/deep', true);  // deeper descendant (child of ax)
    S.tieredCollapseAll(state, [ws]);
    // Top-level (/ws/a/ax) should stay open
    expect(state.expanded.get('/ws/a/ax')).toBe(true);
    // Deeper node should be collapsed
    expect(state.expanded.get('/ws/a/ax/deep')).toBe(false);
  });

  it('tier 1 applies when any top-level item has a deeper descendant', () => {
    const { ws } = makeWorkspace();
    const state = S.createState();
    state.expanded.set('/ws/a/ax', true);       // a → ax (compacted)
    state.expanded.set('/ws/b', true);          // b expanded, no deeper descendants
    state.expanded.set('/ws/a/ax/deep', true);  // deeper under a
    S.tieredCollapseAll(state, [ws]);
    // Both top-level items stay open (tier 1 preserves them)
    expect(state.expanded.get('/ws/a/ax')).toBe(true);
    expect(state.expanded.get('/ws/b')).toBe(true);
    // Only the deeper node under a is collapsed
    expect(state.expanded.get('/ws/a/ax/deep')).toBe(false);
  });

  it('works with multiple workspace roots', () => {
    const a = makeDir('/ws1/a', 'a', { totalFiles: 1 });
    const ws1 = makeDir('/ws1', 'ws1', { children: [a], totalFiles: 1 });
    const b = makeDir('/ws2/b', 'b', { totalFiles: 1 });
    const ws2 = makeDir('/ws2', 'ws2', { children: [b], totalFiles: 1 });
    const state = S.createState();
    state.expanded.set('/ws1/a', true);
    state.expanded.set('/ws2/b', true);
    S.tieredCollapseAll(state, [ws1, ws2]);
    expect(state.expanded.get('/ws1/a')).toBe(false);
    expect(state.expanded.get('/ws2/b')).toBe(false);
  });
});
