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
    const result = S.sortFiles(files, 'files');
    expect(result.map(f => f.name)).toEqual(['alpha.ts', 'Middle.ts', 'zebra.ts']);
  });

  it('does not mutate input', () => {
    const original = [...files];
    S.sortFiles(files, 'files');
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
