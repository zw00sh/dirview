// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

let S; // DirviewShared

beforeAll(() => {
  // Load all shared modules in dependency order — each IIFE writes to its own
  // window._Dirview* namespace, and shared.js assembles window.DirviewShared.
  const files = [
    'shared-icons.js',
    'shared-utils.js',
    'shared-state.js',
    'shared-renderer.js',
    'shared.js',
  ];
  for (const file of files) {
    const code = readFileSync(join(__dirname, file), 'utf-8');
    // eslint-disable-next-line no-new-func
    Function(code)();
  }
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

// --- renderLegend ---
describe('renderLegend', () => {
  function makeStats() {
    return [
      { name: 'TypeScript', color: '#3178c6', count: 3, pct: '75.0' },
      { name: 'CSS', color: '#563d7c', count: 1, pct: '25.0' },
    ];
  }

  it('shows raw counts by default', () => {
    const el = document.createElement('div');
    S.renderLegend(el, makeStats(), new Set(), () => {});
    const counts = el.querySelectorAll('.legend-count');
    expect(counts[0].textContent).toBe('3');
    expect(counts[1].textContent).toBe('1');
  });

  it('shows percentages when showPct is true', () => {
    const el = document.createElement('div');
    S.renderLegend(el, makeStats(), new Set(), () => {}, true);
    const counts = el.querySelectorAll('.legend-count');
    expect(counts[0].textContent).toBe('75.0%');
    expect(counts[1].textContent).toBe('25.0%');
  });

  it('shows raw counts when showPct is false', () => {
    const el = document.createElement('div');
    S.renderLegend(el, makeStats(), new Set(), () => {}, false);
    const counts = el.querySelectorAll('.legend-count');
    expect(counts[0].textContent).toBe('3');
    expect(counts[1].textContent).toBe('1');
  });
});

// --- dir hover action buttons ---

function makeDir(path, name, { children = [], files = [], totalFiles = 0, sizeBytes = 0, stats = [] } = {}) {
  return { path, name, children, files, totalFiles, sizeBytes, stats };
}

function makeRenderer(state, { onExpandChanged, onNavigate } = {}) {
  const vscode = { postMessage: vi.fn() };
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
    onExpandChanged,
    onNavigate,
  });
  // Expose rootEl and vscode so tests can append rendered elements and verify messages.
  renderer._rootEl = rootEl;
  renderer._vscode = vscode;
  return renderer;
}

/** Await two animation frames (matches state.rerender's double-rAF pattern). */
async function awaitRerender() {
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
}

describe('dir hover action buttons', () => {
  it('expand button expands the dir itself and direct children when not all children are expanded', async () => {
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
    renderer._rootEl.appendChild(li);
    li.querySelector('.dir-action-btn[title="Expand children"]').click();

    expect(state.expanded.get('/r')).toBe(true);
    expect(state.expanded.get('/r/a')).toBe(true);
    expect(state.expanded.get('/r/b')).toBe(true);
    // Grandchildren should NOT be expanded — only direct children
    expect(state.expanded.get('/r/a/x')).toBeFalsy();
    expect(state.expanded.get('/r/a/y')).toBeFalsy();
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
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
    renderer._rootEl.appendChild(li);
    li.querySelector('.dir-action-btn[title="Expand children"]').click();

    // child2 being a leaf should not block recursive expand
    expect(state.expanded.get('/r/a/x')).toBe(true);
    expect(state.expanded.get('/r/a/y')).toBe(true);
  });

  it('expand button recursively expands all descendants when all direct children are already expanded', async () => {
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
    renderer._rootEl.appendChild(li);
    li.querySelector('.dir-action-btn[title="Expand children"]').click();

    // Grandchildren should now also be expanded
    expect(state.expanded.get('/r/a/x')).toBe(true);
    expect(state.expanded.get('/r/a/y')).toBe(true);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    expect(state.render).toHaveBeenCalledOnce();
  });

  it('collapse button sets each direct child path to collapsed and calls render', async () => {
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
    renderer._rootEl.appendChild(li);

    const collapseBtn = li.querySelector('.dir-action-btn[title="Collapse children"]');
    expect(collapseBtn).not.toBeNull();
    collapseBtn.click();

    expect(state.expanded.get('/r/a')).toBe(false);
    expect(state.expanded.get('/r/b')).toBe(false);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
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
    renderer._rootEl.appendChild(li);
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
    renderer._rootEl.appendChild(li);
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
    rootEl.appendChild(li);

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
    renderer._rootEl.appendChild(li);

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
    renderer._rootEl.appendChild(li);

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

// ── patchTreeChildren / patchDirLi ───────────────────────────────────────────

function makeLi(path, barWidth, countText, childPaths = []) {
  const li = document.createElement('li');
  li.dataset.nodePath = path;

  const row = document.createElement('div');
  row.className = 'dir-row';

  if (barWidth > 0) {
    const barWrap = document.createElement('div');
    barWrap.className = 'bar-wrap';
    barWrap.style.width = barWidth + 'px';
    const bar = document.createElement('div');
    bar.className = 'bar';
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
  }

  const count = document.createElement('span');
  count.className = 'file-count';
  count.textContent = countText;
  row.appendChild(count);

  li.appendChild(row);

  if (childPaths.length) {
    const ul = document.createElement('ul');
    ul.className = 'children open';
    for (const cp of childPaths) { ul.appendChild(makeLi(cp, 10, '1')); }
    li.appendChild(ul);
  }

  return li;
}

function makeTree(items) {
  const ul = document.createElement('ul');
  ul.className = 'tree';
  for (const [path, barWidth, count, children] of items) {
    ul.appendChild(makeLi(path, barWidth, String(count), children || []));
  }
  return ul;
}

describe('patchTreeChildren', () => {
  it('does not duplicate unkeyed (file) children on re-patch', () => {
    const container = document.createElement('div');
    // Old tree: one dir with data-node-path, two plain <li>s (like file rows)
    const oldTree = document.createElement('ul');
    oldTree.className = 'tree';
    const dirLi = makeLi('/a', 50, '5');
    const fileLi1 = document.createElement('li');
    fileLi1.textContent = 'file1.ts';
    const fileLi2 = document.createElement('li');
    fileLi2.textContent = 'file2.ts';
    oldTree.appendChild(dirLi);
    oldTree.appendChild(fileLi1);
    oldTree.appendChild(fileLi2);
    container.appendChild(oldTree);

    // New tree: same dir (updated count) + same two files
    const newTree = document.createElement('ul');
    newTree.className = 'tree';
    newTree.appendChild(makeLi('/a', 60, '6'));
    const newFile1 = document.createElement('li');
    newFile1.textContent = 'file1.ts';
    const newFile2 = document.createElement('li');
    newFile2.textContent = 'file2.ts';
    newTree.appendChild(newFile1);
    newTree.appendChild(newFile2);

    S.patchTreeChildren(oldTree, newTree);

    // Must have exactly 3 children, not 5 (which would indicate duplication)
    expect(oldTree.children.length).toBe(3);
    expect(oldTree.querySelector('[data-node-path="/a"]')).toBeTruthy();
    expect(oldTree.querySelector('.file-count').textContent).toBe('6');
  });

  it('updates bar width and count for matching paths', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5']]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 80, '8']]);
    S.patchTreeChildren(oldTree, newTree);

    const li = oldTree.querySelector('[data-node-path="/a"]');
    expect(li).toBeTruthy();
    expect(li.querySelector('.bar-wrap').style.width).toBe('80px');
    expect(li.querySelector('.file-count').textContent).toBe('8');
  });

  it('inserts new nodes that did not previously exist', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5']]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 50, '5'], ['/b', 30, '3']]);
    S.patchTreeChildren(oldTree, newTree);

    expect(oldTree.querySelectorAll('[data-node-path]')).toHaveLength(2);
    expect(oldTree.querySelector('[data-node-path="/b"]')).toBeTruthy();
  });

  it('removes nodes that no longer exist in the new tree', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5'], ['/b', 30, '3']]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 50, '5']]);
    S.patchTreeChildren(oldTree, newTree);

    expect(oldTree.querySelectorAll('[data-node-path]')).toHaveLength(1);
    expect(oldTree.querySelector('[data-node-path="/b"]')).toBeNull();
  });

  it('reuses the same DOM node for matching paths', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5']]);
    container.appendChild(oldTree);
    const originalLi = oldTree.querySelector('[data-node-path="/a"]');

    const newTree = makeTree([['/a', 60, '6']]);
    S.patchTreeChildren(oldTree, newTree);

    const patchedLi = oldTree.querySelector('[data-node-path="/a"]');
    expect(patchedLi).toBe(originalLi); // same DOM node — not replaced
  });

  it('recurses into children <ul>', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5', ['/a/x']]]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 60, '6', ['/a/x', '/a/y']]]);
    S.patchTreeChildren(oldTree, newTree);

    const childUl = oldTree.querySelector('[data-node-path="/a"] > ul.children');
    expect(childUl).toBeTruthy();
    expect(childUl.querySelectorAll('[data-node-path]')).toHaveLength(2);
  });

  it('handles adding a bar where none existed', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 0, '—']]); // no bar (empty dir)
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 40, '4']]); // now has files
    S.patchTreeChildren(oldTree, newTree);

    const li = oldTree.querySelector('[data-node-path="/a"]');
    expect(li.querySelector('.bar-wrap')).toBeTruthy();
    expect(li.querySelector('.bar-wrap').style.width).toBe('40px');
  });

  it('handles removing a bar when dir becomes empty', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 40, '4']]); // has bar
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 0, '—']]); // no bar
    S.patchTreeChildren(oldTree, newTree);

    const li = oldTree.querySelector('[data-node-path="/a"]');
    expect(li.querySelector('.bar-wrap')).toBeNull();
  });
});

// --- Delegated click handler interaction tests ---
// These tests simulate the full cycle: render → click DOM element → delegated handler fires →
// state updates → rerender → DOM reflects new state. This catches stale-closure and
// event-delegation bugs that attribute-only tests miss.

describe('delegated click handler', () => {
  // -- Data-action attribute presence --

  describe('data-action attributes', () => {
    it('renderTruncatedRow has data-action="expandTruncated" and data-dir-path', () => {
      const state = S.createState();
      const renderer = makeRenderer(state);
      const hiddenFiles = [
        { name: 'a.js', path: '/d/a.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
      ];
      const li = renderer.renderTruncatedRow(hiddenFiles, 1, [{ path: '/d' }], '/d', 10, 300);
      const row = li.querySelector('.truncated-row');
      expect(row.dataset.action).toBe('expandTruncated');
      expect(row.dataset.dirPath).toBe('/d');
    });

    it('renderEmptyGroupNode has data-action="expandEmptyGroup" and data-group-key', () => {
      const state = S.createState();
      const renderer = makeRenderer(state);
      const nodes = [makeDir('/r/empty1', 'empty1'), makeDir('/r/empty2', 'empty2')];
      const li = renderer.renderEmptyGroupNode(nodes, 0, 10, []);
      const row = li.querySelector('.empty-group-row');
      expect(row.dataset.action).toBe('expandEmptyGroup');
      expect(row.dataset.groupKey).toBe('/r/empty1');
    });

    it('renderFileNode has data-action="openFile" and data-path when no search matches', () => {
      const state = S.createState();
      const renderer = makeRenderer(state);
      const li = renderer.renderFileNode(
        { name: 'foo.js', path: '/r/foo.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 42 },
        0, [],
      );
      const row = li.querySelector('.file-row');
      expect(row.dataset.action).toBe('openFile');
      expect(row.dataset.path).toBe('/r/foo.js');
    });

    it('indent guides have data-action="collapseGuide" and data-guide-path', () => {
      const state = S.createState();
      const renderer = makeRenderer(state);
      const ancestor = { path: '/r' };
      const li = renderer.renderFileNode(
        { name: 'f.js', path: '/r/f.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 1 },
        1, [ancestor],
      );
      const guide = li.querySelector('.indent-guide');
      expect(guide.dataset.action).toBe('collapseGuide');
      expect(guide.dataset.guidePath).toBe('/r');
    });
  });

  // -- Truncated row bar segment weights --

  describe('renderTruncatedRow bar segment weights', () => {
    it('uses file count for segment widths when sort mode is "files"', () => {
      const state = S.createState();
      state.currentSortMode = 'files';
      const renderer = makeRenderer(state);
      // JS: 3 files, 100 bytes each; CSS: 1 file, 900 bytes
      const hiddenFiles = [
        { name: 'a.js', path: '/d/a.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'b.js', path: '/d/b.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'c.js', path: '/d/c.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'd.css', path: '/d/d.css', langName: 'CSS', langColor: '#563d7c', sizeBytes: 900 },
      ];
      const li = renderer.renderTruncatedRow(hiddenFiles, 0, [], '/d', 10, 300);
      const segments = li.querySelectorAll('.bar-segment');
      // By count: JS=75%, CSS=25%
      expect(segments[0].style.width).toBe('75%');
      expect(segments[1].style.width).toBe('25%');
    });

    it('uses byte size for segment widths when sort mode is "size"', () => {
      const state = S.createState();
      state.currentSortMode = 'size';
      const renderer = makeRenderer(state);
      // JS: 3 files, 100 bytes each (300 total); CSS: 1 file, 900 bytes
      const hiddenFiles = [
        { name: 'a.js', path: '/d/a.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'b.js', path: '/d/b.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'c.js', path: '/d/c.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'd.css', path: '/d/d.css', langName: 'CSS', langColor: '#563d7c', sizeBytes: 900 },
      ];
      const li = renderer.renderTruncatedRow(hiddenFiles, 0, [], '/d', 1200, 300);
      const segments = li.querySelectorAll('.bar-segment');
      // By size: CSS=75% (900/1200), JS=25% (300/1200) — CSS is larger so sorted first
      expect(segments[0].style.width).toBe('75%');
      expect(segments[1].style.width).toBe('25%');
    });

    it('sorts langs by size descending when sort mode is "size"', () => {
      const state = S.createState();
      state.currentSortMode = 'size';
      const renderer = makeRenderer(state);
      const hiddenFiles = [
        { name: 'a.js', path: '/d/a.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'b.css', path: '/d/b.css', langName: 'CSS', langColor: '#563d7c', sizeBytes: 900 },
      ];
      const li = renderer.renderTruncatedRow(hiddenFiles, 0, [], '/d', 1000, 300);
      const segments = li.querySelectorAll('.bar-segment');
      // CSS (900B) should be first segment (larger)
      expect(segments[0].style.backgroundColor).toBe('rgb(86, 61, 124)'); // CSS color
      expect(segments[1].style.backgroundColor).toBe('rgb(241, 224, 90)'); // JS color
    });
  });

  // -- File open --

  describe('openFile action', () => {
    it('clicking a file row posts openFile message', () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      const file = { name: 'foo.js', path: '/r/foo.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 42 };
      const parent = makeDir('/r', 'r', { files: [file], totalFiles: 1, stats: [{ name: 'JavaScript', color: '#f1e05a', count: 1 }] });
      state.expanded.set('/r', true);
      renderer.beforeRender();
      const li = renderer.renderDirNode(parent, 0, 1, [], 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.file-row').click();

      expect(renderer._vscode.postMessage).toHaveBeenCalledWith({ command: 'openFile', path: '/r/foo.js' });
    });

    it('clicking a file row does not toggle the parent dir', () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      const file = { name: 'foo.js', path: '/r/foo.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 42 };
      const parent = makeDir('/r', 'r', { files: [file], totalFiles: 1, stats: [{ name: 'JavaScript', color: '#f1e05a', count: 1 }] });
      state.expanded.set('/r', true);
      renderer.beforeRender();
      const li = renderer.renderDirNode(parent, 0, 1, [], 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.file-row').click();

      // Parent should still be expanded
      expect(state.expanded.get('/r')).toBe(true);
    });
  });

  // -- Indent guide collapse --

  describe('collapseGuide action', () => {
    it('clicking an indent guide collapses the ancestor dir and rerenders', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);

      // Two grandchildren so child doesn't compact
      const gc1 = makeDir('/r/a/x', 'x', { totalFiles: 1, stats: [] });
      const gc2 = makeDir('/r/a/y', 'y', { totalFiles: 1, stats: [] });
      const child = makeDir('/r/a', 'a', { children: [gc1, gc2], totalFiles: 2, stats: [] });
      const root = makeDir('/r', 'r', { children: [child], totalFiles: 2, stats: [] });
      state.expanded.set('/r', true);
      state.expanded.set('/r/a', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 2, [], 300);
      renderer._rootEl.appendChild(li);

      // Grandchild row has an indent guide pointing at '/r/a'
      const guides = li.querySelectorAll('.indent-guide[data-guide-path="/r/a"]');
      expect(guides.length).toBeGreaterThan(0);
      guides[0].click();

      expect(state.expanded.get('/r/a')).toBe(false);
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });

    it('clicking an indent guide does nothing when filters are active', () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      state.activeFilters.add('JavaScript');
      const renderer = makeRenderer(state);

      const gc1 = makeDir('/r/a/x', 'x', { totalFiles: 1, stats: [{ name: 'JavaScript', color: '#f1e05a', count: 1 }] });
      const gc2 = makeDir('/r/a/y', 'y', { totalFiles: 1, stats: [{ name: 'JavaScript', color: '#f1e05a', count: 1 }] });
      const child = makeDir('/r/a', 'a', { children: [gc1, gc2], totalFiles: 2, stats: [{ name: 'JavaScript', color: '#f1e05a', count: 2 }] });
      const root = makeDir('/r', 'r', { children: [child], totalFiles: 2, stats: [{ name: 'JavaScript', color: '#f1e05a', count: 2 }] });
      state.expanded.set('/r', true);
      state.expanded.set('/r/a', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 2, [], 300);
      renderer._rootEl.appendChild(li);

      const guide = li.querySelector('.indent-guide[data-guide-path="/r/a"]');
      if (guide) { guide.click(); }

      // Should still be expanded — guide click is a no-op with filters active
      expect(state.expanded.get('/r/a')).toBe(true);
    });
  });

  // -- Dir row toggle (no action element) --

  describe('dir row toggle', () => {
    it('clicking a dir row toggles chevron and children visibility without rerender', () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      // Two children prevent folder compaction, keeping displayNode.path = '/r'
      const child1 = makeDir('/r/a', 'a', { totalFiles: 1, stats: [{ name: 'JS', color: '#f1e05a', count: 1 }] });
      const child2 = makeDir('/r/b', 'b', { totalFiles: 1, stats: [{ name: 'JS', color: '#f1e05a', count: 1 }] });
      const root = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 2, stats: [{ name: 'JS', color: '#f1e05a', count: 2 }] });
      state.expanded.set('/r', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 2, [], 300);
      renderer._rootEl.appendChild(li);

      const dirRow = li.querySelector('.dir-row[data-path="/r"]');
      const chevron = dirRow.querySelector('.chevron');
      expect(chevron.className).toBe('chevron open');

      // Click dir row label area (not a button) to collapse
      dirRow.querySelector('.dir-name').click();

      expect(state.expanded.get('/r')).toBe(false);
      expect(chevron.className).toBe('chevron');
      // Fast-path: no rerender call
      expect(state.render).not.toHaveBeenCalled();
    });

    it('clicking a dir row fires onExpandChanged callback', () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const onExpandChanged = vi.fn();
      const renderer = makeRenderer(state, { onExpandChanged });
      const child1 = makeDir('/r/a', 'a', { totalFiles: 1, stats: [] });
      const child2 = makeDir('/r/b', 'b', { totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 2, stats: [] });
      state.expanded.set('/r', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 2, [], 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.dir-row[data-path="/r"]').querySelector('.dir-name').click();

      expect(onExpandChanged).toHaveBeenCalled();
    });

    it('does not toggle leaf dirs (no children)', () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      // Leaf dir: has files but no child dirs
      const root = makeDir('/r', 'r', {
        files: [{ name: 'f.js', path: '/r/f.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 }],
        totalFiles: 1,
        stats: [{ name: 'JS', color: '#f1e05a', count: 1 }],
      });

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 1, [], 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.dir-row[data-path="/r"]').click();

      // Should remain falsy — leaf dirs can't expand
      expect(state.expanded.get('/r')).toBeFalsy();
    });

    it('double-click on dir row does not toggle (e.detail >= 2)', () => {
      // Regression: after an action button (e.g. expand-children) triggers a rerender,
      // the rebuilt dir-row loses hover state so its action buttons become display:none.
      // The second click of a double-click then lands on the dir-row and would undo the
      // action. We guard against this by ignoring clicks with e.detail >= 2.
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      const child1 = makeDir('/r/a', 'a', { totalFiles: 1, stats: [{ name: 'JS', color: '#f1e05a', count: 1 }] });
      const child2 = makeDir('/r/b', 'b', { totalFiles: 1, stats: [{ name: 'JS', color: '#f1e05a', count: 1 }] });
      const root = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 2, stats: [{ name: 'JS', color: '#f1e05a', count: 2 }] });
      state.expanded.set('/r', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 2, [], 300);
      renderer._rootEl.appendChild(li);

      const dirRow = li.querySelector('.dir-row[data-path="/r"]');
      dirRow.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));

      // State must not change — double-click is ignored
      expect(state.expanded.get('/r')).toBe(true);
      expect(state.render).not.toHaveBeenCalled();
    });
  });

  // -- Collapse resets truncation --

  describe('collapse resets truncation', () => {
    it('collapsing a dir with truncation expanded clears truncation and rerenders', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      state.truncateThreshold = 2;
      const renderer = makeRenderer(state);
      const files = [
        { name: 'a.js', path: '/r/a.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
        { name: 'b.js', path: '/r/b.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
        { name: 'c.js', path: '/r/c.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
      ];
      const child = makeDir('/r/a', 'a', { totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [child], files, totalFiles: 3, stats: [{ name: 'JS', color: '#f1e05a', count: 3 }] });
      state.expanded.set('/r', true);
      state.truncationExpanded.add('/r');

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 3, [], 300);
      renderer._rootEl.appendChild(li);

      // Collapse by clicking the dir row
      li.querySelector('.dir-row[data-path="/r"]').querySelector('.dir-name').click();

      expect(state.expanded.get('/r')).toBe(false);
      expect(state.truncationExpanded.has('/r')).toBe(false);
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });
  });

  // -- Truncated row click --

  describe('expandTruncated action', () => {
    it('clicking a truncated row updates state and rerenders', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      state.truncateThreshold = 2;
      const renderer = makeRenderer(state);
      const files = [
        { name: 'a.js', path: '/r/a.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'b.py', path: '/r/b.py', langName: 'Python', langColor: '#3572A5', sizeBytes: 200 },
        { name: 'c.ts', path: '/r/c.ts', langName: 'TypeScript', langColor: '#2b7489', sizeBytes: 300 },
        { name: 'd.rb', path: '/r/d.rb', langName: 'Ruby', langColor: '#701516', sizeBytes: 400 },
      ];
      // Include a child dir so truncation is not disabled (single-dir root check)
      const child = makeDir('/r/sub', 'sub', { totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [child], files, totalFiles: 5, stats: [
        { name: 'JavaScript', color: '#f1e05a', count: 1 },
        { name: 'Python', color: '#3572A5', count: 1 },
        { name: 'TypeScript', color: '#2b7489', count: 1 },
        { name: 'Ruby', color: '#701516', count: 1 },
      ] });
      state.expanded.set('/r', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 4, [], 300);
      renderer._rootEl.appendChild(li);

      const truncRow = li.querySelector('.truncated-row');
      expect(truncRow).toBeTruthy();

      // Click the truncated row via delegated handler
      truncRow.click();

      expect(state.truncationExpanded.has('/r')).toBe(true);
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });

    it('clicking a truncated row does not toggle the parent dir', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      state.truncateThreshold = 2;
      const renderer = makeRenderer(state);
      const files = [
        { name: 'a.js', path: '/r/a.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
        { name: 'b.js', path: '/r/b.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
        { name: 'c.js', path: '/r/c.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
      ];
      // Include a child dir so truncation is not disabled (single-dir root check)
      const child = makeDir('/r/sub', 'sub', { totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [child], files, totalFiles: 4, stats: [{ name: 'JS', color: '#f1e05a', count: 3 }] });
      state.expanded.set('/r', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 3, [], 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.truncated-row').click();

      // Parent should still be expanded — action takes priority over dir-row toggle
      expect(state.expanded.get('/r')).toBe(true);
    });

    it('rerender after expansion shows all files and removes truncated row', () => {
      const state = S.createState();
      state.truncateThreshold = 2;
      const renderer = makeRenderer(state);
      const files = [
        { name: 'a.js', path: '/r/a.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'b.py', path: '/r/b.py', langName: 'Python', langColor: '#3572A5', sizeBytes: 200 },
        { name: 'c.ts', path: '/r/c.ts', langName: 'TypeScript', langColor: '#2b7489', sizeBytes: 300 },
        { name: 'd.rb', path: '/r/d.rb', langName: 'Ruby', langColor: '#701516', sizeBytes: 400 },
      ];
      // Include a child dir so truncation is not disabled (single-dir root check)
      const child = makeDir('/r/sub', 'sub', { totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [child], files, totalFiles: 5, stats: [
        { name: 'JavaScript', color: '#f1e05a', count: 1 },
        { name: 'Python', color: '#3572A5', count: 1 },
        { name: 'TypeScript', color: '#2b7489', count: 1 },
        { name: 'Ruby', color: '#701516', count: 1 },
      ] });
      state.expanded.set('/r', true);

      // First render — truncated
      renderer.beforeRender();
      const li1 = renderer.renderDirNode(root, 0, 4, [], 300);
      expect(li1.querySelectorAll('.file-row')).toHaveLength(2);
      expect(li1.querySelector('.truncated-row')).toBeTruthy();

      // Expand truncation, re-render
      state.truncationExpanded.add('/r');
      renderer.beforeRender();
      const li2 = renderer.renderDirNode(root, 0, 4, [], 300);
      expect(li2.querySelectorAll('.file-row')).toHaveLength(4);
      expect(li2.querySelector('.truncated-row')).toBeNull();
    });

    it('works with empty-string dirPath (root-level truncated row)', async () => {
      // Root-level DirNodes have path: '' (empty string). The handler must not
      // treat '' as falsy — this is the regression that caused the original bug.
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      state.truncateThreshold = 2;
      const renderer = makeRenderer(state);
      const hiddenFiles = [
        { name: 'a.js', path: 'a.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
        { name: 'b.js', path: 'b.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 1 },
      ];
      // dirPath = '' matches real root-level nodes from fileScanner
      const li = renderer.renderTruncatedRow(hiddenFiles, 0, [], '', 2, 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.truncated-row').click();

      expect(state.truncationExpanded.has('')).toBe(true);
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });
  });

  // -- Empty group row click --

  describe('expandEmptyGroup action', () => {
    it('clicking an empty group row updates state and rerenders', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      const empty1 = makeDir('/r/empty1', 'empty1');
      const empty2 = makeDir('/r/empty2', 'empty2');
      const nonEmpty = makeDir('/r/full', 'full', { totalFiles: 3, stats: [{ name: 'JS', color: '#f1e05a', count: 3 }] });
      const root = makeDir('/r', 'r', { children: [empty1, empty2, nonEmpty], totalFiles: 3, stats: [{ name: 'JS', color: '#f1e05a', count: 3 }] });
      state.expanded.set('/r', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 3, [], 300);
      renderer._rootEl.appendChild(li);

      const groupRow = li.querySelector('.empty-group-row');
      expect(groupRow).toBeTruthy();

      groupRow.click();

      expect(state.emptyGroupExpanded.has('/r/empty1')).toBe(true);
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });

    it('clicking an empty group row does not toggle the parent dir', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      const empty1 = makeDir('/r/empty1', 'empty1');
      const empty2 = makeDir('/r/empty2', 'empty2');
      const nonEmpty = makeDir('/r/full', 'full', { totalFiles: 1, stats: [{ name: 'JS', color: '#f1e05a', count: 1 }] });
      const root = makeDir('/r', 'r', { children: [empty1, empty2, nonEmpty], totalFiles: 1, stats: [{ name: 'JS', color: '#f1e05a', count: 1 }] });
      state.expanded.set('/r', true);

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 1, [], 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.empty-group-row').click();

      expect(state.expanded.get('/r')).toBe(true);
    });

    it('rerender after expansion shows individual dirs instead of group row', () => {
      const state = S.createState();
      const renderer = makeRenderer(state);
      const empty1 = makeDir('/r/empty1', 'empty1');
      const empty2 = makeDir('/r/empty2', 'empty2');
      const nonEmpty = makeDir('/r/full', 'full', { totalFiles: 3, stats: [{ name: 'JS', color: '#f1e05a', count: 3 }] });
      const root = makeDir('/r', 'r', { children: [empty1, empty2, nonEmpty], totalFiles: 3, stats: [{ name: 'JS', color: '#f1e05a', count: 3 }] });
      state.expanded.set('/r', true);

      // First render — grouped
      renderer.beforeRender();
      const li1 = renderer.renderDirNode(root, 0, 3, [], 300);
      expect(li1.querySelector('.empty-group-row')).toBeTruthy();
      expect(li1.querySelector('[data-path="/r/empty1"]')).toBeNull();

      // Expand, re-render
      state.emptyGroupExpanded.add('/r/empty1');
      renderer.beforeRender();
      const li2 = renderer.renderDirNode(root, 0, 3, [], 300);
      expect(li2.querySelector('.empty-group-row')).toBeNull();
      expect(li2.querySelector('[data-path="/r/empty1"]')).toBeTruthy();
      expect(li2.querySelector('[data-path="/r/empty2"]')).toBeTruthy();
    });

    it('works with empty-string groupKey (root-level empty group)', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      // groupKey is nodes[0].path — use '' to match root-level nodes
      const nodes = [makeDir('', 'root1'), makeDir('other', 'root2')];
      const li = renderer.renderEmptyGroupNode(nodes, 0, 0, []);
      renderer._rootEl.appendChild(li);

      li.querySelector('.empty-group-row').click();

      expect(state.emptyGroupExpanded.has('')).toBe(true);
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });
  });

  // -- Render → patch → click (stale closure regression) --

  describe('render-patch-click cycle', () => {
    it('truncated row click works correctly after patchTreeChildren moves it', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      state.truncateThreshold = 2;
      const renderer = makeRenderer(state);
      const files = [
        { name: 'a.js', path: '/r/a.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 100 },
        { name: 'b.js', path: '/r/b.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 200 },
        { name: 'c.js', path: '/r/c.js', langName: 'JS', langColor: '#f1e05a', sizeBytes: 300 },
      ];
      // Include a child dir so truncation is not disabled (single-dir root check)
      const child = makeDir('/r/sub', 'sub', { totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [child], files, totalFiles: 4, stats: [{ name: 'JS', color: '#f1e05a', count: 3 }] });
      state.expanded.set('/r', true);

      // Initial render
      renderer.beforeRender();
      const oldTree = document.createElement('ul');
      oldTree.className = 'tree';
      const li1 = renderer.renderDirNode(root, 0, 3, [], 300);
      oldTree.appendChild(li1);
      renderer._rootEl.appendChild(oldTree);

      // Simulate FS change: re-render and patch
      renderer.beforeRender();
      const newTree = document.createElement('ul');
      newTree.className = 'tree';
      newTree.appendChild(renderer.renderDirNode(root, 0, 3, [], 300));
      S.patchTreeChildren(oldTree, newTree);

      // Now click the truncated row in the patched tree
      const truncRow = oldTree.querySelector('.truncated-row');
      expect(truncRow).toBeTruthy();
      truncRow.click();

      // Should still work — no stale closure, delegated handler reads live state
      expect(state.truncationExpanded.has('/r')).toBe(true);
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });
  });

  describe('lazy child rendering', () => {
    // Build a tree that won't compact: root has two children (prevents single-child compaction).
    // Each child has files so hasChildren is true.
    const jsFile = (dir, name) => ({ name, path: `${dir}/${name}`, langName: 'JS', langColor: '#f1e05a', sizeBytes: 100 });

    it('collapsed dir produces an empty children UL', () => {
      const state = S.createState();
      const childA = makeDir('/r/a', 'a', { files: [jsFile('/r/a', 'x.js')], totalFiles: 1, stats: [] });
      const childB = makeDir('/r/b', 'b', { files: [jsFile('/r/b', 'y.js')], totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [childA, childB], totalFiles: 2, stats: [] });
      state.expanded.set('/r', true);
      state.expanded.set('/r/a', false);

      const renderer = makeRenderer(state);
      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 10, [], 300);

      // /r/a is collapsed — its children UL should exist but be empty
      const aLi = li.querySelector('[data-node-path="/r/a"]');
      const childrenUl = aLi.querySelector('ul.children');
      expect(childrenUl).toBeTruthy();
      expect(childrenUl.children.length).toBe(0);
      expect(childrenUl.classList.contains('open')).toBe(false);
    });

    it('expanded dir populates children normally', () => {
      const state = S.createState();
      const childA = makeDir('/r/a', 'a', { files: [jsFile('/r/a', 'x.js')], totalFiles: 1, stats: [] });
      const childB = makeDir('/r/b', 'b', { files: [jsFile('/r/b', 'y.js')], totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [childA, childB], totalFiles: 2, stats: [] });
      state.expanded.set('/r', true);
      state.expanded.set('/r/a', true);

      const renderer = makeRenderer(state);
      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 10, [], 300);

      const aLi = li.querySelector('[data-node-path="/r/a"]');
      const childrenUl = aLi.querySelector('ul.children');
      expect(childrenUl).toBeTruthy();
      expect(childrenUl.children.length).toBeGreaterThan(0);
      expect(childrenUl.classList.contains('open')).toBe(true);
    });

    it('clicking a collapsed dir with empty children triggers rerender', async () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const childA = makeDir('/r/a', 'a', { files: [jsFile('/r/a', 'x.js')], totalFiles: 1, stats: [] });
      const childB = makeDir('/r/b', 'b', { files: [jsFile('/r/b', 'y.js')], totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [childA, childB], totalFiles: 2, stats: [] });
      state.expanded.set('/r', true);
      state.expanded.set('/r/a', false);

      const renderer = makeRenderer(state);
      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 10, [], 300);
      renderer._rootEl.appendChild(li);

      // Click /r/a dir row to expand
      const aLi = li.querySelector('[data-node-path="/r/a"]');
      const dirRow = aLi.querySelector('.dir-row');
      dirRow.click();

      expect(state.expanded.get('/r/a')).toBe(true);
      // Should trigger rerender since children UL is empty
      await awaitRerender();
      expect(state.render).toHaveBeenCalled();
    });

    it('clicking an expanded dir with populated children does CSS-only toggle (no rerender)', () => {
      const state = S.createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const childA = makeDir('/r/a', 'a', { files: [jsFile('/r/a', 'x.js')], totalFiles: 1, stats: [] });
      const childB = makeDir('/r/b', 'b', { files: [jsFile('/r/b', 'y.js')], totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [childA, childB], totalFiles: 2, stats: [] });
      state.expanded.set('/r', true);
      state.expanded.set('/r/a', true);

      const renderer = makeRenderer(state);
      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 10, [], 300);
      renderer._rootEl.appendChild(li);

      // Click /r/a to collapse — should NOT rerender (CSS-only toggle)
      const aLi = li.querySelector('[data-node-path="/r/a"]');
      const dirRow = aLi.querySelector('.dir-row');
      dirRow.click();

      expect(state.expanded.get('/r/a')).toBe(false);
      expect(state.render).not.toHaveBeenCalled();
      // Chevron and children class should be toggled
      expect(aLi.querySelector('.chevron').className).toBe('chevron');
      expect(aLi.querySelector('ul.children').className).toBe('children');
    });

    it('patch cycle with collapsed dirs preserves expanded state of other dirs', () => {
      const state = S.createState();
      const gcA = makeDir('/r/a/x', 'x', { files: [jsFile('/r/a/x', 'f.js')], totalFiles: 1, stats: [] });
      const gcB = makeDir('/r/b/y', 'y', { files: [jsFile('/r/b/y', 'g.js')], totalFiles: 1, stats: [] });
      const childA = makeDir('/r/a', 'a', { children: [gcA], totalFiles: 1, stats: [] });
      const childB = makeDir('/r/b', 'b', { children: [gcB], totalFiles: 1, stats: [] });
      const root = makeDir('/r', 'r', { children: [childA, childB], totalFiles: 2, stats: [] });
      state.expanded.set('/r', true);
      state.expanded.set('/r/a', true);
      // /r/a compacts to /r/a/x since it has a single child — set expanded for the compacted path
      state.expanded.set('/r/a/x', true);
      state.expanded.set('/r/b', true);
      // /r/b compacts to /r/b/y — set it collapsed
      state.expanded.set('/r/b/y', false);

      const renderer = makeRenderer(state);

      // First render
      renderer.beforeRender();
      const oldTree = document.createElement('ul');
      oldTree.className = 'tree';
      oldTree.appendChild(renderer.renderDirNode(root, 0, 10, [], 300));
      renderer._rootEl.appendChild(oldTree);

      // /r/a/x (compacted from /r/a) should have children populated
      // /r/b/y (compacted from /r/b) should be empty since collapsed
      const axChildren = oldTree.querySelector('[data-node-path="/r/a/x"] > ul.children');
      const byChildren = oldTree.querySelector('[data-node-path="/r/b/y"] > ul.children');
      expect(axChildren).toBeTruthy();
      expect(axChildren.children.length).toBeGreaterThan(0);
      expect(byChildren).toBeTruthy();
      expect(byChildren.children.length).toBe(0);

      // Patch with same data
      renderer.beforeRender();
      const newTree = document.createElement('ul');
      newTree.className = 'tree';
      newTree.appendChild(renderer.renderDirNode(root, 0, 10, [], 300));
      S.patchTreeChildren(oldTree, newTree);

      // State should be preserved
      expect(state.expanded.get('/r/a/x')).toBe(true);
      expect(state.expanded.get('/r/b/y')).toBe(false);
    });
  });
});

// --- search: dirMatchesSearch ---

describe('dirMatchesSearch', () => {
  it('returns true when searchResults is null', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    expect(renderer.dirMatchesSearch(node)).toBe(true);
  });

  it('returns true when a direct file is in searchResults', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/foo.ts', []]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    expect(renderer.dirMatchesSearch(node)).toBe(true);
  });

  it('returns false when no file matches', () => {
    const state = S.createState();
    state.searchResults = new Map([['/other/file.ts', []]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    expect(renderer.dirMatchesSearch(node)).toBe(false);
  });

  it('returns true when a descendant file matches', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/b/nested.ts', []]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const nested = makeDir('/a/b', 'b', { files: [{ path: '/a/b/nested.ts', name: 'nested.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    const node = makeDir('/a', 'a', { children: [nested] });
    expect(renderer.dirMatchesSearch(node)).toBe(true);
  });

  it('caches results: returns same value on repeated calls', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/foo.ts', []]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    expect(renderer.dirMatchesSearch(node)).toBe(true);
    expect(renderer.dirMatchesSearch(node)).toBe(true); // from cache
  });

  it('cache is reset by beforeRender', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/foo.ts', []]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const node = makeDir('/a', 'a', { files: [file] });
    expect(renderer.dirMatchesSearch(node)).toBe(true);
    // Change search results and reset cache
    state.searchResults = new Map([['/other.ts', []]]);
    renderer.beforeRender();
    expect(renderer.dirMatchesSearch(node)).toBe(false);
  });

  it('ignores activeFilters when they are empty (existing behavior preserved)', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/foo.ts', []]]);
    // No active filters — should behave as before
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    expect(renderer.dirMatchesSearch(node)).toBe(true);
  });

  it('returns false when file matches search but not active language filter', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/foo.ts', []]]);
    state.activeFilters = new Set(['YAML']);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    // foo.ts is TypeScript (in searchResults) but filter wants YAML → no match
    const node = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    expect(renderer.dirMatchesSearch(node)).toBe(false);
  });

  it('returns true when file matches both search and active language filter', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/config.yaml', []]]);
    state.activeFilters = new Set(['YAML']);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', { files: [{ path: '/a/config.yaml', name: 'config.yaml', langName: 'YAML', langColor: '#cb171e', sizeBytes: 0 }] });
    expect(renderer.dirMatchesSearch(node)).toBe(true);
  });

  it('returns false for the exact bug scenario: dir has YAML (matches filter, not search) + TypeScript (in search, not filter)', () => {
    const state = S.createState();
    // Search found a TypeScript file; filter wants only YAML
    state.searchResults = new Map([['/a/app.ts', []]]);
    state.activeFilters = new Set(['YAML']);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', {
      files: [
        { path: '/a/config.yaml', name: 'config.yaml', langName: 'YAML', langColor: '#cb171e', sizeBytes: 0 },
        { path: '/a/app.ts', name: 'app.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 },
      ],
    });
    // app.ts passes search but not filter; config.yaml passes filter but not search → dir = false
    expect(renderer.dirMatchesSearch(node)).toBe(false);
  });
});

// --- search: renderMatchLine ---

describe('renderMatchLine', () => {
  it('renders line number and text', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 42, column: 6, matchLength: 3, lineText: 'const api = true;' };
    const li = renderer.renderMatchLine(file, match, 1, []);
    const row = li.querySelector('.match-line-row');
    expect(row).not.toBeNull();
    expect(row.dataset.action).toBe('openFileAtLine');
    expect(row.dataset.path).toBe('/a/foo.ts');
    expect(row.dataset.line).toBe('42');
    expect(li.querySelector('.match-line-number').textContent).toBe('42');
    const highlight = li.querySelector('.match-highlight');
    expect(highlight).not.toBeNull();
    expect(highlight.textContent).toBe('api');
  });

  it('renders text without highlight when matchLength is 0', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 1, column: 0, matchLength: 0, lineText: 'plain text' };
    const li = renderer.renderMatchLine(file, match, 1, []);
    expect(li.querySelector('.match-highlight')).toBeNull();
    expect(li.querySelector('.match-line-text').textContent).toBe('plain text');
  });

  it('clicking openFileAtLine posts openFile with line number', () => {
    const state = S.createState();
    state.lastRoots = [];
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 7, column: 0, matchLength: 3, lineText: 'abc def' };
    const li = renderer.renderMatchLine(file, match, 1, []);
    renderer._rootEl.appendChild(li);
    li.querySelector('.match-line-row').click();
    expect(renderer._vscode.postMessage).toHaveBeenCalledWith({ command: 'openFile', path: '/a/foo.ts', line: 7 });
  });

  it('uses highlightedHtml when present (sets innerHTML)', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = {
      line: 5,
      column: 0,
      matchLength: 5,
      lineText: 'const x = 1;',
      highlightedHtml: '<span style="color:#569cd6">const</span> x = 1;',
    };
    const li = renderer.renderMatchLine(file, match, 1, []);
    const textEl = li.querySelector('.match-line-text');
    // innerHTML should contain the syntax-highlighted span from the backend
    expect(textEl.innerHTML).toContain('#569cd6');
    expect(textEl.innerHTML).toContain('const');
    // Plain-text path should not be used — no extra TextNodes wrapping the match
    expect(textEl.querySelector('.match-highlight')).toBeNull();
  });

  it('falls back to plain text when highlightedHtml is absent', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 1, column: 0, matchLength: 3, lineText: 'abc def' };
    const li = renderer.renderMatchLine(file, match, 1, []);
    // Plain-text path: match-highlight span should be present
    expect(li.querySelector('.match-highlight')).not.toBeNull();
    expect(li.querySelector('.match-highlight').textContent).toBe('abc');
  });

  it('highlightedHtml takes precedence over lineText when both present', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = {
      line: 1,
      column: 0,
      matchLength: 3,
      lineText: 'abc',
      highlightedHtml: '<span class="match-highlight">abc</span>',
    };
    const li = renderer.renderMatchLine(file, match, 1, []);
    const textEl = li.querySelector('.match-line-text');
    // The highlight span should come from the pre-rendered HTML
    expect(textEl.querySelector('.match-highlight')).not.toBeNull();
    // Verify it's the innerHTML path (no additional text nodes from the plain path)
    expect(textEl.childNodes.length).toBe(1);
  });

  it('sets data-node-path for DOM patching', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 42, column: 6, matchLength: 3, lineText: 'const api = true;' };
    const li = renderer.renderMatchLine(file, match, 1, []);
    expect(li.dataset.nodePath).toBe('match:/a/foo.ts:42:6');
  });
});

// --- search: renderMoreMatchesRow ---

describe('renderMoreMatchesRow', () => {
  it('renders the count label', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderMoreMatchesRow(3, 1, []);
    expect(li.querySelector('.dir-name').textContent).toBe('3 more matches');
  });

  it('uses singular form for count=1', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderMoreMatchesRow(1, 1, []);
    expect(li.querySelector('.dir-name').textContent).toBe('1 more match');
  });

  it('sets data-node-path when filePath is provided', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderMoreMatchesRow(3, 1, [], '/a/foo.ts');
    expect(li.dataset.nodePath).toBe('more:/a/foo.ts');
  });
});

// --- search: rendering integration ---

describe('search rendering integration', () => {
  function makeFile(path, name = null) {
    return { path, name: name || path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  it('renders match lines under matched files', () => {
    const state = S.createState();
    state.searchResults = new Map([
      ['/r/foo.ts', [{ line: 5, column: 0, matchLength: 3, lineText: 'abc def' }]],
    ]);
    state.render = vi.fn();
    state.lastRoots = [];
    const file = makeFile('/r/foo.ts');
    const dir = makeDir('/r', 'r', { files: [file], totalFiles: 1, stats: [] });
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(dir, 0, 10, [], 300);
    const matchLines = li.querySelectorAll('.match-line-row');
    expect(matchLines.length).toBe(1);
    expect(matchLines[0].dataset.line).toBe('5');
  });

  it('does not render match lines for filename-only results (empty matches array)', () => {
    const state = S.createState();
    state.searchResults = new Map([['/r/foo.ts', []]]);
    state.render = vi.fn();
    state.lastRoots = [];
    const file = makeFile('/r/foo.ts');
    const dir = makeDir('/r', 'r', { files: [file], totalFiles: 1, stats: [] });
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(dir, 0, 10, [], 300);
    expect(li.querySelectorAll('.match-line-row').length).toBe(0);
  });

  it('hides files not in searchResults', () => {
    const state = S.createState();
    state.searchResults = new Map([['/r/match.ts', []]]);
    state.render = vi.fn();
    state.lastRoots = [];
    const f1 = makeFile('/r/match.ts');
    const f2 = makeFile('/r/nomatch.ts');
    const dir = makeDir('/r', 'r', { files: [f1, f2], totalFiles: 2, stats: [] });
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(dir, 0, 10, [], 300);
    const fileRows = li.querySelectorAll('.file-row');
    expect(fileRows.length).toBe(1);
    expect(fileRows[0].dataset.path).toBe('/r/match.ts');
  });

  it('auto-expands directories when searchResults is set', () => {
    const state = S.createState();
    state.searchResults = new Map([['/r/sub/file.ts', []]]);
    state.render = vi.fn();
    state.lastRoots = [];
    const file = makeFile('/r/sub/file.ts');
    const sub = makeDir('/r/sub', 'sub', { files: [file], totalFiles: 1, stats: [] });
    const root = makeDir('/r', 'r', { children: [sub], totalFiles: 1, stats: [] });
    // depth=0 dirs auto-expand anyway; check depth=1 dir
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const rootLi = renderer.renderDirNode(root, 0, 10, [], 300);
    // The child sub-directory should also be expanded (isExpanded is true when searchResults != null)
    const subChildren = rootLi.querySelector('[data-node-path="/r/sub"] > ul.children');
    expect(subChildren).not.toBeNull();
    expect(subChildren.classList.contains('open')).toBe(true);
  });

  it('disables file truncation when search is active', () => {
    const state = S.createState();
    state.truncateThreshold = 2;
    state.searchResults = new Map([
      ['/r/a.ts', []],
      ['/r/b.ts', []],
      ['/r/c.ts', []],
    ]);
    state.render = vi.fn();
    state.lastRoots = [];
    const files = [makeFile('/r/a.ts'), makeFile('/r/b.ts'), makeFile('/r/c.ts')];
    const dir = makeDir('/r', 'r', { files, totalFiles: 3, stats: [] });
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(dir, 0, 10, [], 300);
    // All 3 files should be shown (truncation disabled in search mode)
    expect(li.querySelectorAll('.file-row').length).toBe(3);
    expect(li.querySelector('.truncated-row')).toBeNull();
  });

  it('caps match lines at truncateThreshold per file and shows more-matches row', () => {
    const state = S.createState();
    state.truncateThreshold = 4; // default
    const matches = [1, 2, 3, 4, 5, 6, 7].map(line => ({ line, column: 0, matchLength: 1, lineText: 'x' }));
    state.searchResults = new Map([['/r/foo.ts', matches]]);
    state.render = vi.fn();
    state.lastRoots = [];
    const file = makeFile('/r/foo.ts');
    const dir = makeDir('/r', 'r', { files: [file], totalFiles: 1, stats: [] });
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(dir, 0, 10, [], 300);
    expect(li.querySelectorAll('.match-line-row').length).toBe(4);
    // The "more matches" row reuses truncated-row styling; find the one inside a match area.
    const truncRows = li.querySelectorAll('.truncated-row');
    // Find the truncated-row whose dir-name contains "more match"
    let moreLabel = null;
    for (const tr of truncRows) {
      const dn = tr.querySelector('.dir-name');
      if (dn && dn.textContent.includes('more match')) { moreLabel = dn; break; }
    }
    expect(moreLabel).not.toBeNull();
    expect(moreLabel.textContent).toBe('3 more matches');
  });
});

// --- search: createMessageHandler searchResults/searchProgress ---

describe('createMessageHandler search messages', () => {
  function makeHandlerEnv() {
    const state = S.createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = S.createMessageHandler(state, scanBar, rootEl, { render: state.render });
    return { state, scanBar, rootEl, handler };
  }

  it('searchProgress sets searchActive and calls searchBar_updateStatus', () => {
    const { state, handler } = makeHandlerEnv();
    const updateStatus = vi.fn();
    state.searchBar_updateStatus = updateStatus;
    handler({ data: { type: 'searchProgress' } });
    expect(state.searchActive).toBe(true);
    expect(updateStatus).toHaveBeenCalledOnce();
  });

  it('searchResults with matches sets state and triggers rerender', async () => {
    const { state, handler } = makeHandlerEnv();
    handler({ data: { type: 'searchResults', matches: { '/a/foo.ts': [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }] }, fileCount: 1, matchCount: 1, truncated: false } });
    expect(state.searchResults).toBeInstanceOf(Map);
    expect(state.searchResults.has('/a/foo.ts')).toBe(true);
    expect(state.searchActive).toBe(false);
    expect(state.searchFileCount).toBe(1);
    expect(state.searchMatchCount).toBe(1);
    await awaitRerender();
    expect(state.render).toHaveBeenCalled();
  });

  it('searchResults with null clears search state', async () => {
    const { state, handler } = makeHandlerEnv();
    state.searchResults = new Map([['/a/foo.ts', []]]);
    handler({ data: { type: 'searchResults', matches: null } });
    expect(state.searchResults).toBeNull();
    expect(state.searchActive).toBe(false);
  });

  it('searchResults with matches clears expanded state', () => {
    const { state, handler } = makeHandlerEnv();
    state.expanded.set('/some/dir', true);
    handler({ data: { type: 'searchResults', matches: { '/a/foo.ts': [] }, fileCount: 1, matchCount: 0, truncated: false } });
    expect(state.expanded.size).toBe(0);
  });

  it('searchResultsBatch merges into existing searchResults', () => {
    const { state, handler } = makeHandlerEnv();
    // searchProgress fires before batches begin
    handler({ data: { type: 'searchProgress' } });
    expect(state.searchActive).toBe(true);
    // First batch
    handler({ data: { type: 'searchResultsBatch', matches: { '/a/foo.ts': [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }] }, fileCount: 1, matchCount: 1 } });
    expect(state.searchResults).toBeInstanceOf(Map);
    expect(state.searchResults.has('/a/foo.ts')).toBe(true);
    // Second batch adds more files
    handler({ data: { type: 'searchResultsBatch', matches: { '/b/bar.ts': [{ line: 2, column: 0, matchLength: 3, lineText: 'def' }] }, fileCount: 2, matchCount: 2 } });
    expect(state.searchResults.size).toBe(2);
    expect(state.searchResults.has('/b/bar.ts')).toBe(true);
    // searchActive remains true during batches (only searchResultsDone sets it false)
    expect(state.searchActive).toBe(true);
  });

  it('searchProgress clears stale results from previous search', () => {
    const { state, handler } = makeHandlerEnv();
    // Simulate a completed first search with results
    state.searchResults = new Map([['/a/foo.ts', [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }]]]);
    state.searchFileCount = 1;
    state.searchMatchCount = 1;
    // New search begins — searchProgress should clear stale results
    handler({ data: { type: 'searchProgress' } });
    expect(state.searchActive).toBe(true);
    expect(state.searchResults).toBeNull();
    expect(state.searchFileCount).toBe(0);
    expect(state.searchMatchCount).toBe(0);
  });

  it('second searchProgress between batches resets results so stale batches start fresh', () => {
    const { state, handler } = makeHandlerEnv();
    // First search delivers a batch
    handler({ data: { type: 'searchProgress' } });
    handler({ data: { type: 'searchResultsBatch', matches: { '/a/old.ts': [{ line: 1, column: 0, matchLength: 2, lineText: 'ap' }] }, fileCount: 1, matchCount: 1 } });
    expect(state.searchResults.has('/a/old.ts')).toBe(true);

    // Second search starts — progress clears the stale batch results
    handler({ data: { type: 'searchProgress' } });
    expect(state.searchResults).toBeNull();

    // Second search delivers its own batch — should not include old results
    handler({ data: { type: 'searchResultsBatch', matches: { '/b/new.ts': [{ line: 5, column: 0, matchLength: 3, lineText: 'api' }] }, fileCount: 1, matchCount: 1 } });
    expect(state.searchResults.size).toBe(1);
    expect(state.searchResults.has('/b/new.ts')).toBe(true);
    expect(state.searchResults.has('/a/old.ts')).toBe(false);
  });

  it('searchResultsDone sets searchActive false and final counts', () => {
    const { state, handler } = makeHandlerEnv();
    state.searchActive = true;
    state.searchResults = new Map([['/a/foo.ts', []]]);
    handler({ data: { type: 'searchResultsDone', fileCount: 5, matchCount: 20, truncated: true } });
    expect(state.searchActive).toBe(false);
    expect(state.searchFileCount).toBe(5);
    expect(state.searchMatchCount).toBe(20);
    expect(state.searchTruncated).toBe(true);
  });

  it('searchResultsDone with no preceding batches (zero results) sets searchResults to empty Map', () => {
    // Regression: when ripgrep finds nothing, no searchResultsBatch messages arrive,
    // leaving searchResults null. searchResultsDone must set it to an empty Map so the
    // tree renders empty rather than showing the full unfiltered tree.
    const { state, handler } = makeHandlerEnv();
    handler({ data: { type: 'searchProgress' } });
    expect(state.searchResults).toBeNull(); // no batches yet
    handler({ data: { type: 'searchResultsDone', fileCount: 0, matchCount: 0, truncated: false } });
    expect(state.searchResults).toBeInstanceOf(Map);
    expect(state.searchResults.size).toBe(0);
    expect(state.searchActive).toBe(false);
  });
});

// --- expandMatchedDirs ---
describe('expandMatchedDirs', () => {
  it('expands only directories that contain matching files', () => {
    const state = S.createState();
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
          }),
          makeDir('/ws/docs', 'docs', {
            files: [{ path: '/ws/docs/readme.md', name: 'readme.md', langName: 'Markdown' }],
          }),
        ],
      }),
    ];
    const searchResults = new Map([['/ws/src/a.ts', []]]);
    S.expandMatchedDirs(state, roots, searchResults, new Set());

    // /ws/src should be expanded (contains match), /ws/docs should not
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.has('/ws/docs')).toBe(false);
    // Root should be expanded (has a matched descendant)
    expect(state.expanded.get('/ws')).toBe(true);
  });

  it('respects active language filters', () => {
    const state = S.createState();
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [
              { path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' },
              { path: '/ws/src/b.js', name: 'b.js', langName: 'JavaScript' },
            ],
          }),
        ],
      }),
    ];
    const searchResults = new Map([['/ws/src/a.ts', []], ['/ws/src/b.js', []]]);
    // Only JavaScript is in the active filter
    S.expandMatchedDirs(state, roots, searchResults, new Set(['JavaScript']));

    // Dir should still be expanded because b.js matches filter + search
    expect(state.expanded.get('/ws/src')).toBe(true);
  });

  it('does not expand dirs when no files match filter', () => {
    const state = S.createState();
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
          }),
        ],
      }),
    ];
    const searchResults = new Map([['/ws/src/a.ts', []]]);
    // Filter for JavaScript only — a.ts (TypeScript) doesn't pass
    S.expandMatchedDirs(state, roots, searchResults, new Set(['JavaScript']));

    expect(state.expanded.has('/ws/src')).toBe(false);
  });
});

// --- expandBatchFiles ---
describe('expandBatchFiles', () => {
  it('expands dirs for new batch files without clearing prior expand state', () => {
    const state = S.createState();
    state.expanded.set('/ws/other', true); // pre-existing expand from another source
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
          }),
        ],
      }),
    ];
    S.expandBatchFiles(state, roots, new Set(['/ws/src/a.ts']));
    // New match dir is expanded.
    expect(state.expanded.get('/ws/src')).toBe(true);
    // Pre-existing expand state is preserved (not cleared).
    expect(state.expanded.get('/ws/other')).toBe(true);
  });

  it('respects active language filters', () => {
    const state = S.createState();
    state.activeFilters = new Set(['JavaScript']);
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
          }),
        ],
      }),
    ];
    // TypeScript file is in batch but filter only allows JavaScript — should not expand.
    S.expandBatchFiles(state, roots, new Set(['/ws/src/a.ts']));
    expect(state.expanded.has('/ws/src')).toBe(false);
  });

  it('accumulates expand state across multiple batch calls', () => {
    const state = S.createState();
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
          }),
          makeDir('/ws/lib', 'lib', {
            files: [{ path: '/ws/lib/b.ts', name: 'b.ts', langName: 'TypeScript' }],
          }),
        ],
      }),
    ];
    // First batch expands /ws/src.
    S.expandBatchFiles(state, roots, new Set(['/ws/src/a.ts']));
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.has('/ws/lib')).toBe(false);
    // Second batch expands /ws/lib — /ws/src remains expanded.
    S.expandBatchFiles(state, roots, new Set(['/ws/lib/b.ts']));
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.get('/ws/lib')).toBe(true);
  });
});

// --- searchResultsHighlight message handler ---
describe('searchResultsHighlight', () => {
  function makeHandlerEnv() {
    const state = S.createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = S.createMessageHandler(state, scanBar, rootEl, { render: state.render });
    return { state, handler };
  }

  it('merges highlightedHtml into existing match entries', () => {
    const { state, handler } = makeHandlerEnv();
    state.searchResults = new Map([['/a/foo.ts', [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }]]]);
    handler({ data: { type: 'searchResultsHighlight', patches: [{ path: '/a/foo.ts', idx: 0, html: '<span>abc</span>' }] } });
    expect(state.searchResults.get('/a/foo.ts')[0].highlightedHtml).toBe('<span>abc</span>');
  });

  it('is a no-op when searchResults is null', () => {
    const { state, handler } = makeHandlerEnv();
    // Should not throw even with no active search.
    expect(() => {
      handler({ data: { type: 'searchResultsHighlight', patches: [{ path: '/a/foo.ts', idx: 0, html: '<span>x</span>' }] } });
    }).not.toThrow();
    expect(state.searchResults).toBeNull();
  });
});

// --- searchProgress clears expanded state ---
describe('searchProgress expand state reset', () => {
  it('clears expanded state so expandBatchFiles starts fresh', () => {
    const state = S.createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn();
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = S.createMessageHandler(state, scanBar, rootEl, { render: state.render });
    state.expanded.set('/ws/old-dir', true);
    handler({ data: { type: 'searchProgress' } });
    expect(state.expanded.size).toBe(0);
  });
});

// --- renderMatchLine edge cases ---

describe('renderMatchLine — edge cases', () => {
  it('handles undefined lineText without throwing (stripped match beyond MAX_MATCH_LINES)', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    // lineText is absent — simulates a match stripped by the backend
    const match = { line: 10, column: 0, matchLength: 3 };
    let li;
    expect(() => { li = renderer.renderMatchLine(file, match, 1, []); }).not.toThrow();
    // Text element should be empty (no crash, no content)
    expect(li.querySelector('.match-line-text').textContent).toBe('');
  });

  it('escapes HTML special chars in lineText via textContent (plain-text path)', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 1, column: 0, matchLength: 2, lineText: 'if (a < b && c > d) {}' };
    const li = renderer.renderMatchLine(file, match, 1, []);
    const textEl = li.querySelector('.match-line-text');
    // textContent should contain the raw characters (browser decodes entities when reading textContent)
    expect(textEl.textContent).toContain('<');
    expect(textEl.textContent).toContain('>');
    // innerHTML should have entities escaped, not literal < / >
    expect(textEl.innerHTML).not.toMatch(/<b\b/); // no stray <b> tag
    expect(textEl.innerHTML).toContain('&lt;');
    expect(textEl.innerHTML).toContain('&gt;');
  });
});

// --- searchResultsHighlight — additional idx / path cases ---

describe('searchResultsHighlight — idx and path edge cases', () => {
  function makeHandlerEnv() {
    const state = S.createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = S.createMessageHandler(state, scanBar, rootEl, { render: state.render });
    return { state, handler };
  }

  it('patches at non-zero idx, leaving other indices unchanged', () => {
    const { state, handler } = makeHandlerEnv();
    state.searchResults = new Map([['/a/foo.ts', [
      { line: 1, column: 0, matchLength: 3, lineText: 'abc' },
      { line: 2, column: 0, matchLength: 3, lineText: 'def' },
      { line: 3, column: 0, matchLength: 3, lineText: 'ghi' },
    ]]]);
    handler({ data: { type: 'searchResultsHighlight', patches: [{ path: '/a/foo.ts', idx: 2, html: '<span>ghi</span>' }] } });
    const matches = state.searchResults.get('/a/foo.ts');
    expect(matches[2].highlightedHtml).toBe('<span>ghi</span>');
    expect(matches[0].highlightedHtml).toBeUndefined();
    expect(matches[1].highlightedHtml).toBeUndefined();
  });

  it('out-of-bounds idx is a no-op — does not crash or add entries', () => {
    const { state, handler } = makeHandlerEnv();
    state.searchResults = new Map([['/a/foo.ts', [
      { line: 1, column: 0, matchLength: 3, lineText: 'abc' },
      { line: 2, column: 0, matchLength: 3, lineText: 'def' },
    ]]]);
    expect(() => {
      handler({ data: { type: 'searchResultsHighlight', patches: [{ path: '/a/foo.ts', idx: 5, html: '<span>x</span>' }] } });
    }).not.toThrow();
    const matches = state.searchResults.get('/a/foo.ts');
    expect(matches.length).toBe(2);
    expect(matches[0].highlightedHtml).toBeUndefined();
  });

  it('unknown file path is a no-op — does not crash or mutate existing results', () => {
    const { state, handler } = makeHandlerEnv();
    state.searchResults = new Map([['/a/foo.ts', [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }]]]);
    expect(() => {
      handler({ data: { type: 'searchResultsHighlight', patches: [{ path: '/a/OTHER.ts', idx: 0, html: '<span>x</span>' }] } });
    }).not.toThrow();
    expect(state.searchResults.get('/a/foo.ts')[0].highlightedHtml).toBeUndefined();
  });
});

// --- dirMatchesSearch — empty dir ---

describe('dirMatchesSearch — empty dir', () => {
  it('returns false for a dir with no files and no children when search is active', () => {
    const state = S.createState();
    state.searchResults = new Map([['/a/other.ts', []]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const node = makeDir('/a', 'a', { files: [], children: [] });
    expect(renderer.dirMatchesSearch(node)).toBe(false);
  });
});

// --- expandMatchedDirs — deep nesting ---

describe('expandMatchedDirs — deep nesting', () => {
  it('expands all ancestor dirs for a 3-level-deep match', () => {
    const state = S.createState();
    // Sibling dirs at each level prevent folder compaction (single-child chains collapse to the
    // deepest node, making intermediate paths invisible to `state.expanded`).
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            children: [
              makeDir('/ws/src/deep', 'deep', {
                files: [{ path: '/ws/src/deep/a.ts', name: 'a.ts', langName: 'TypeScript' }],
              }),
              makeDir('/ws/src/other', 'other', {}), // prevents src→deep compaction
            ],
          }),
          makeDir('/ws/docs', 'docs', {}), // prevents ws→src compaction
        ],
      }),
    ];
    const searchResults = new Map([['/ws/src/deep/a.ts', []]]);
    S.expandMatchedDirs(state, roots, searchResults, new Set());

    expect(state.expanded.get('/ws')).toBe(true);
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.get('/ws/src/deep')).toBe(true);
  });
});

// --- searchResultsBatch with empty matches ---

describe('searchResultsBatch — empty matches', () => {
  function makeHandlerEnv() {
    const state = S.createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = S.createMessageHandler(state, scanBar, rootEl, { render: state.render });
    return { state, handler };
  }

  it('initializes searchResults to empty Map when null and empty batch arrives', () => {
    const { state, handler } = makeHandlerEnv();
    handler({ data: { type: 'searchProgress' } });
    expect(state.searchResults).toBeNull();
    handler({ data: { type: 'searchResultsBatch', matches: {}, fileCount: 0, matchCount: 0 } });
    expect(state.searchResults).toBeInstanceOf(Map);
    expect(state.searchResults.size).toBe(0);
  });

  it('does not discard existing results when an empty batch arrives', () => {
    const { state, handler } = makeHandlerEnv();
    handler({ data: { type: 'searchProgress' } });
    handler({ data: { type: 'searchResultsBatch', matches: { '/a/foo.ts': [] }, fileCount: 1, matchCount: 0 } });
    handler({ data: { type: 'searchResultsBatch', matches: {}, fileCount: 1, matchCount: 0 } });
    expect(state.searchResults.has('/a/foo.ts')).toBe(true);
    expect(state.searchResults.size).toBe(1);
  });
});

// --- expandBatchFiles — orphan path ---

describe('expandBatchFiles — orphan paths', () => {
  it('is a no-op for file paths that do not match any dir in the tree', () => {
    const state = S.createState();
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
          }),
        ],
      }),
    ];
    // Path belongs to a completely different root
    expect(() => {
      S.expandBatchFiles(state, roots, new Set(['/other/project/file.ts']));
    }).not.toThrow();
    // No dirs should have been expanded
    expect(state.expanded.size).toBe(0);
  });
});

// --- walkMatchingDirs ---

describe('walkMatchingDirs', () => {
  function makeTree() {
    return [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
            children: [
              makeDir('/ws/src/lib', 'lib', {
                files: [{ path: '/ws/src/lib/b.ts', name: 'b.ts', langName: 'TypeScript' }],
              }),
            ],
          }),
        ],
      }),
    ];
  }

  it('expands ancestors of matched files', () => {
    const state = S.createState();
    S.walkMatchingDirs(state, makeTree(), f => f.path === '/ws/src/lib/b.ts', false);
    expect(state.expanded.get('/ws/src/lib')).toBe(true);
    expect(state.expanded.get('/ws/src')).toBe(true);
  });

  it('does not expand dirs with no matching files', () => {
    const state = S.createState();
    S.walkMatchingDirs(state, makeTree(), f => f.path === '/nonexistent.ts', false);
    expect(state.expanded.size).toBe(0);
  });

  it('clearFirst=true clears state.expanded before walking', () => {
    const state = S.createState();
    state.expanded.set('/ws/src', true); // pre-existing
    S.walkMatchingDirs(state, makeTree(), f => f.path === '/ws/src/lib/b.ts', true);
    // '/ws/src' should still be expanded (matched via descendant), not missing
    expect(state.expanded.get('/ws/src')).toBe(true);
    // but the clear happened — any path NOT matching is gone
    // (confirm by adding a path that wouldn't match)
    const state2 = S.createState();
    state2.expanded.set('/unrelated/path', true);
    S.walkMatchingDirs(state2, makeTree(), () => false, true);
    expect(state2.expanded.has('/unrelated/path')).toBe(false);
  });

  it('clearFirst=false preserves existing expanded state', () => {
    const state = S.createState();
    state.expanded.set('/unrelated/path', true);
    S.walkMatchingDirs(state, makeTree(), () => false, false);
    expect(state.expanded.has('/unrelated/path')).toBe(true);
  });

  it('is a no-op for empty roots', () => {
    const state = S.createState();
    expect(() => S.walkMatchingDirs(state, [], () => true, false)).not.toThrow();
    expect(state.expanded.size).toBe(0);
  });
});

// --- scheduleSearchRender ---

describe('scheduleSearchRender', () => {
  it('schedules a render after 300ms', async () => {
    const state = S.createState();
    const rerender = vi.fn();
    state.rerender = rerender;
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    S.scheduleSearchRender(state);
    expect(rerender).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 350));
    expect(rerender).toHaveBeenCalledOnce();
    expect(state._searchRenderTimer).toBeNull();
  });

  it('does not schedule a second timer when one is already pending', async () => {
    const state = S.createState();
    const rerender = vi.fn();
    state.rerender = rerender;
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    S.scheduleSearchRender(state);
    S.scheduleSearchRender(state); // second call — should be a no-op
    await new Promise(r => setTimeout(r, 350));
    expect(rerender).toHaveBeenCalledOnce(); // only fired once
  });

  it('is a no-op when state.lastRoots is null', async () => {
    const state = S.createState();
    const rerender = vi.fn();
    state.rerender = rerender;
    state.lastRoots = null;
    S.scheduleSearchRender(state);
    await new Promise(r => setTimeout(r, 350));
    expect(rerender).not.toHaveBeenCalled();
    expect(state._searchRenderTimer).toBeNull();
  });
});

// --- renderFileMatches ---

describe('renderFileMatches', () => {
  function makeFile(path) {
    return { path, name: path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  function makeMatch(line, col = 0, len = 3) {
    return { line, column: col, matchLength: len, lineText: 'abc def ghi' };
  }

  it('appends nothing when searchResults is null', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.children.length).toBe(0);
  });

  it('appends nothing when file has no matches', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', []]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.children.length).toBe(0);
  });

  it('appends up to truncateThreshold match-line rows', () => {
    const state = S.createState();
    state.truncateThreshold = 4; // default
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    const file = makeFile('/ws/a.ts');
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(1), makeMatch(2), makeMatch(3), makeMatch(4),
    ]]]);
    renderer.renderFileMatches(container, file, 1, []);
    // 4 match-line rows, no "more matches" row
    expect(container.querySelectorAll('.match-line-row').length).toBe(4);
    expect(container.querySelectorAll('.match-more-row').length).toBe(0);
  });

  it('appends a "more matches" row when there are more than truncateThreshold matches', () => {
    const state = S.createState();
    state.truncateThreshold = 4; // default
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    const file = makeFile('/ws/a.ts');
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(1), makeMatch(2), makeMatch(3), makeMatch(4), makeMatch(5), makeMatch(6), makeMatch(7),
    ]]]);
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.querySelectorAll('.match-line-row').length).toBe(4);
    const moreRow = container.querySelector('.truncated-row');
    expect(moreRow).not.toBeNull();
    expect(moreRow.textContent).toContain('3 more match');
  });

  it('appends nothing when file path is not in searchResults', () => {
    const state = S.createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/other.ts', [makeMatch(1)]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.children.length).toBe(0);
  });
});

// --- setupDebugEval ---
describe('setupDebugEval', () => {
  it('is exported on DirviewShared', () => {
    expect(typeof S.setupDebugEval).toBe('function');
  });

  it('posts debugEvalResult back to vscode when data-debug is set', async () => {
    document.body.setAttribute('data-debug', '');
    const postMessage = vi.fn();
    const mockVscode = { postMessage };

    S.setupDebugEval(mockVscode);

    // Dispatch a debugEval message — the handler should eval the script and postMessage the result.
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'debugEval', id: 99, script: '1 + 2' },
    }));

    // Allow the synchronous handler to run.
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({
      command: 'debugEvalResult',
      id: 99,
      result: '3',
    });

    document.body.removeAttribute('data-debug');
  });

  it('posts error result when the script throws', async () => {
    document.body.setAttribute('data-debug', '');
    const postMessage = vi.fn();
    const mockVscode = { postMessage };

    S.setupDebugEval(mockVscode);

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'debugEval', id: 100, script: 'throw new Error("boom")' },
    }));

    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'debugEvalResult', id: 100, error: expect.stringContaining('boom') })
    );

    document.body.removeAttribute('data-debug');
  });

  it('does nothing when data-debug attribute is absent', async () => {
    document.body.removeAttribute('data-debug');
    const postMessage = vi.fn();
    const mockVscode = { postMessage };

    S.setupDebugEval(mockVscode);

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'debugEval', id: 101, script: '42' },
    }));

    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('ignores non-debugEval message types', async () => {
    document.body.setAttribute('data-debug', '');
    const postMessage = vi.fn();
    const mockVscode = { postMessage };

    S.setupDebugEval(mockVscode);

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'update', roots: [] },
    }));

    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();

    document.body.removeAttribute('data-debug');
  });
});

// --- showRootNode option ---

describe('renderTree showRootNode', () => {
  // Use two children to prevent single-child compaction, which would change data-node-path.
  function makeWorkspaceRoot() {
    const src = makeDir('/ws/src', 'src', { totalFiles: 1, stats: [] });
    const lib = makeDir('/ws/lib', 'lib', { totalFiles: 1, stats: [] });
    return makeDir('/ws', 'myProject', { children: [src, lib], totalFiles: 2, stats: [] });
  }

  it('renders root as a depth-0 dir-row when showRootNode is true', () => {
    const state = S.createState();
    state.dirPath = '';
    state.workspaceFolderName = 'myProject';
    const root = makeWorkspaceRoot();
    state.lastRoots = [root];
    state.currentSortMode = 'files';

    const renderer = makeRenderer(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    S.renderTree(state, renderer, container, { showRootNode: true });

    const tree = container.querySelector('ul.tree');
    expect(tree).not.toBeNull();
    // Root itself is a dir-row at depth 0 (two children prevents compaction)
    const rootLi = tree.querySelector('[data-node-path="/ws"]');
    expect(rootLi).not.toBeNull();
    expect(rootLi.querySelector('.dir-row')).not.toBeNull();
    // Root is not a workspace-root-header
    expect(tree.querySelector('.workspace-root-header')).toBeNull();
  });

  it('children appear at depth 1 (inside root children UL)', () => {
    const state = S.createState();
    state.dirPath = '';
    const root = makeWorkspaceRoot();
    state.lastRoots = [root];
    state.currentSortMode = 'files';
    state.expanded.set('/ws', true);

    const renderer = makeRenderer(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    S.renderTree(state, renderer, container, { showRootNode: true });

    // Root is at depth 0, children are inside root's children UL
    const rootLi = container.querySelector('[data-node-path="/ws"]');
    const childrenUl = rootLi.querySelector('ul.children');
    expect(childrenUl).not.toBeNull();
    expect(childrenUl.querySelector('[data-node-path="/ws/src"]')).not.toBeNull();
    expect(childrenUl.querySelector('[data-node-path="/ws/lib"]')).not.toBeNull();
  });

  it('falls back to rendering root children at depth 0 when showRootNode is false', () => {
    const state = S.createState();
    const root = makeWorkspaceRoot();
    state.lastRoots = [root];
    state.currentSortMode = 'files';

    const renderer = makeRenderer(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    S.renderTree(state, renderer, container);  // no showRootNode

    const tree = container.querySelector('ul.tree');
    // /ws root itself is NOT rendered as a dir-row
    expect(tree.querySelector('[data-node-path="/ws"]')).toBeNull();
    // /ws/src and /ws/lib are at the top level (depth 0)
    expect(tree.querySelector('[data-node-path="/ws/src"]')).not.toBeNull();
    expect(tree.querySelector('[data-node-path="/ws/lib"]')).not.toBeNull();
  });
});

// --- onNavigate: dir-name click navigation ---

describe('onNavigate dir-name click', () => {
  // Two children prevents single-child compaction (which would change data-node-path).
  function makeNavTree() {
    const jsFile = (dir, name) => ({ name, path: `${dir}/${name}`, langName: 'JS', langColor: '#f1e05a', sizeBytes: 0 });
    const src = makeDir('/ws/src', 'src', { files: [jsFile('/ws/src', 'a.js')], totalFiles: 1, stats: [] });
    const lib = makeDir('/ws/lib', 'lib', { files: [jsFile('/ws/lib', 'b.js')], totalFiles: 1, stats: [] });
    const root = makeDir('/ws', 'ws', { children: [src, lib], totalFiles: 2, stats: [] });
    return { root, src, lib };
  }

  it('calls onNavigate with dir path when dir-name is clicked', () => {
    const state = S.createState();
    const navigate = vi.fn();
    const { root } = makeNavTree();
    state.expanded.set('/ws', true);

    const renderer = makeRenderer(state, { onNavigate: navigate });
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 10, [], 300);
    renderer._rootEl.appendChild(li);

    const srcLi = li.querySelector('[data-node-path="/ws/src"]');
    const dirName = srcLi.querySelector('.dir-name');
    dirName.click();

    expect(navigate).toHaveBeenCalledWith('/ws/src');
  });

  it('does not toggle expand/collapse when dir-name is clicked (navigate instead)', () => {
    const state = S.createState();
    state.render = vi.fn();
    const navigate = vi.fn();
    const { root } = makeNavTree();
    state.expanded.set('/ws', true);
    state.expanded.set('/ws/src', false);

    const renderer = makeRenderer(state, { onNavigate: navigate });
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 10, [], 300);
    renderer._rootEl.appendChild(li);

    const srcLi = li.querySelector('[data-node-path="/ws/src"]');
    const dirName = srcLi.querySelector('.dir-name');
    dirName.click();

    // onNavigate was called, expand state was NOT changed
    expect(navigate).toHaveBeenCalledWith('/ws/src');
    expect(state.expanded.get('/ws/src')).toBe(false);
  });

  it('renders breadcrumb with ancestor segments at depth 0 when state.dirPath is set', () => {
    const state = S.createState();
    state.dirPath = 'src/views';
    state.workspaceFolderName = 'dirview';
    const navigate = vi.fn();

    const root = makeDir('src/views', 'views', { totalFiles: 2, stats: [] });
    const renderer = makeRenderer(state, { onNavigate: navigate });
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 10, [], 300);

    const nameEl = li.querySelector('.dir-name');
    const segments = nameEl.querySelectorAll('.path-segment');
    // dirview / src / views = 3 segments
    expect(segments.length).toBe(3);
    expect(segments[0].textContent).toBe('dirview');
    expect(segments[0].dataset.navigatePath).toBe('');
    expect(segments[1].textContent).toBe('src');
    expect(segments[1].dataset.navigatePath).toBe('src');
    expect(segments[2].textContent).toBe('views');
    expect(segments[2].dataset.navigatePath).toBe('src/views');
  });

  it('clicking breadcrumb ancestor segment navigates to ancestor path', () => {
    const state = S.createState();
    state.dirPath = 'src/views';
    state.workspaceFolderName = 'dirview';
    const navigate = vi.fn();

    const root = makeDir('src/views', 'views', { totalFiles: 2, stats: [] });
    const renderer = makeRenderer(state, { onNavigate: navigate });
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 10, [], 300);
    renderer._rootEl.appendChild(li);

    // Click the 'src' ancestor segment
    const nameEl = li.querySelector('.dir-name');
    const segments = nameEl.querySelectorAll('.path-segment');
    const srcSeg = Array.from(segments).find(s => s.textContent === 'src');
    srcSeg.click();

    expect(navigate).toHaveBeenCalledWith('src');
  });

  it('does not render breadcrumb at depth 0 when state.dirPath is empty (workspace root)', () => {
    const state = S.createState();
    state.dirPath = '';
    state.workspaceFolderName = 'dirview';
    const navigate = vi.fn();

    const root = makeDir('', 'dirview', { totalFiles: 1, stats: [] });
    const renderer = makeRenderer(state, { onNavigate: navigate });
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 10, [], 300);

    const nameEl = li.querySelector('.dir-name');
    // No breadcrumb segments — just the folder name as plain text
    expect(nameEl.querySelectorAll('[data-navigate-path]').length).toBe(0);
    expect(nameEl.textContent).toBe('dirview');
  });

  it('does not call onNavigate when chevron is clicked (expand/collapse instead)', async () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];
    const navigate = vi.fn();
    const { root } = makeNavTree();
    state.expanded.set('/ws', true);
    state.expanded.set('/ws/src', false);

    const renderer = makeRenderer(state, { onNavigate: navigate });
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 10, [], 300);
    renderer._rootEl.appendChild(li);

    const srcLi = li.querySelector('[data-node-path="/ws/src"]');
    const chevron = srcLi.querySelector('.chevron');
    chevron.click();

    // Navigate was NOT called — clicking chevron (outside .dir-name) expands/collapses
    expect(navigate).not.toHaveBeenCalled();
    // Expand state was toggled
    expect(state.expanded.get('/ws/src')).toBe(true);
  });
});

// --- setupStickyTracking ---
describe('setupStickyTracking', () => {
  it('returns an object with updateStuck and setEnabled functions', () => {
    const el = document.createElement('div');
    const result = S.setupStickyTracking(el);
    expect(typeof result.updateStuck).toBe('function');
    expect(typeof result.setEnabled).toBe('function');
  });

  it('setEnabled(false) adds sticky-disabled class to document.body', () => {
    const el = document.createElement('div');
    const { setEnabled } = S.setupStickyTracking(el);
    document.body.classList.remove('sticky-disabled');
    setEnabled(false);
    expect(document.body.classList.contains('sticky-disabled')).toBe(true);
  });

  it('setEnabled(true) removes sticky-disabled class from document.body', () => {
    const el = document.createElement('div');
    const { setEnabled } = S.setupStickyTracking(el);
    document.body.classList.add('sticky-disabled');
    setEnabled(true);
    expect(document.body.classList.contains('sticky-disabled')).toBe(false);
  });

  it('setEnabled(false) clears is-stuck classes from sticky-dir elements', () => {
    const el = document.createElement('div');
    const stickyEl = document.createElement('div');
    stickyEl.className = 'sticky-dir is-stuck';
    el.appendChild(stickyEl);
    const { setEnabled } = S.setupStickyTracking(el);
    setEnabled(false);
    expect(stickyEl.classList.contains('is-stuck')).toBe(false);
  });

  it('updateStuck short-circuits when sticky-disabled is on body', () => {
    const el = document.createElement('div');
    const stickyEl = document.createElement('div');
    stickyEl.className = 'sticky-dir';
    el.appendChild(stickyEl);
    document.body.classList.add('sticky-disabled');
    const { updateStuck } = S.setupStickyTracking(el);
    // Should not throw or add classes when disabled
    updateStuck();
    expect(stickyEl.classList.contains('is-stuck')).toBe(false);
    document.body.classList.remove('sticky-disabled');
  });
});

// --- Feature 3: single-dir root truncation disabled ---

describe('single-dir root truncation disabled', () => {
  function makeFile(dir, name) {
    return { name, path: `${dir}/${name}`, langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 };
  }

  it('does not truncate files when depth=0 dir has no child directories', () => {
    const state = S.createState();
    state.truncateThreshold = 2;
    const files = [
      makeFile('/r', 'a.ts'), makeFile('/r', 'b.ts'), makeFile('/r', 'c.ts'), makeFile('/r', 'd.ts'),
    ];
    // No child dirs — this is a single-dir root
    const root = makeDir('/r', 'r', { files, children: [], totalFiles: 4, stats: [] });
    state.expanded.set('/r', true);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 4, [], 300);
    // All 4 files shown, no truncated row
    expect(li.querySelectorAll('.file-row').length).toBe(4);
    expect(li.querySelector('.truncated-row')).toBeNull();
  });

  it('still truncates at depth=0 when the dir has child directories', () => {
    const state = S.createState();
    state.truncateThreshold = 2;
    const files = [
      makeFile('/r', 'a.ts'), makeFile('/r', 'b.ts'), makeFile('/r', 'c.ts'), makeFile('/r', 'd.ts'),
    ];
    const child = makeDir('/r/sub', 'sub', { totalFiles: 1, stats: [] });
    const root = makeDir('/r', 'r', { files, children: [child], totalFiles: 5, stats: [] });
    state.expanded.set('/r', true);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(root, 0, 5, [], 300);
    // Truncated: only first 2 shown + truncated row
    expect(li.querySelectorAll('.file-row').length).toBe(2);
    expect(li.querySelector('.truncated-row')).not.toBeNull();
  });
});

// --- Feature 2: matchesCollapsed state management ---

describe('matchesCollapsed — tieredCollapseAll', () => {
  it('populates matchesCollapsed with all search result paths when collapsing', () => {
    const state = S.createState();
    state.searchResults = new Map([
      ['/ws/a.ts', []],
      ['/ws/b.ts', []],
    ]);
    const a = makeDir('/ws/a', 'a', { totalFiles: 1 });
    const ws = makeDir('/ws', 'ws', { children: [a], totalFiles: 1 });
    state.expanded.set('/ws/a', true);

    S.tieredCollapseAll(state, [ws]);

    // All search result file paths added to matchesCollapsed
    expect(state.matchesCollapsed.has('/ws/a.ts')).toBe(true);
    expect(state.matchesCollapsed.has('/ws/b.ts')).toBe(true);
  });

  it('does not modify matchesCollapsed when searchResults is null', () => {
    const state = S.createState();
    state.matchesCollapsed.add('/existing');
    // searchResults is null (no active search)
    const a = makeDir('/ws/a', 'a', { totalFiles: 1 });
    const ws = makeDir('/ws', 'ws', { children: [a], totalFiles: 1 });
    state.expanded.set('/ws/a', true);

    S.tieredCollapseAll(state, [ws]);

    // matchesCollapsed should only have the pre-existing path, not be modified by the collapse
    // (the if (state.searchResults) guard prevents population when search is null)
    expect(state.matchesCollapsed.has('/existing')).toBe(true);
  });
});

describe('matchesCollapsed — tieredExpandAll', () => {
  it('clears matchesCollapsed when expanding', () => {
    const state = S.createState();
    state.matchesCollapsed.add('/ws/a.ts');
    state.matchesCollapsed.add('/ws/b.ts');
    const a = makeDir('/ws/a', 'a', { totalFiles: 1 });
    const ws = makeDir('/ws', 'ws', { children: [a], totalFiles: 1 });

    S.tieredExpandAll(state, [ws]);

    expect(state.matchesCollapsed.size).toBe(0);
  });
});

// --- Feature 2: collapsible file-row with matches ---

describe('collapsible file-row with search matches', () => {
  function makeFile(path, name = null) {
    return { path, name: name || path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  it('file row has has-matches class and chevron when file has matches', () => {
    const state = S.createState();
    const file = makeFile('/r/foo.ts');
    state.searchResults = new Map([['/r/foo.ts', [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }]]]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderFileNode(file, 0, []);
    const row = li.querySelector('.file-row');
    expect(row.classList.contains('has-matches')).toBe(true);
    // Should have a chevron before the dot slot
    const chevrons = row.querySelectorAll('.chevron');
    expect(chevrons.length).toBeGreaterThanOrEqual(2); // match chevron + dot slot
  });

  it('file row does NOT have has-matches class when file has no matches in searchResults', () => {
    const state = S.createState();
    const file = makeFile('/r/foo.ts');
    state.searchResults = new Map([['/r/foo.ts', []]]); // empty matches array
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderFileNode(file, 0, []);
    const row = li.querySelector('.file-row');
    expect(row.classList.contains('has-matches')).toBe(false);
  });

  it('clicking the file row (outside filename) toggles matchesCollapsed and rerenders', async () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];
    const file = makeFile('/r/foo.ts');
    state.searchResults = new Map([['/r/foo.ts', [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }]]]);
    const dir = makeDir('/r', 'r', { files: [file], totalFiles: 1, stats: [] });
    state.expanded.set('/r', true);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(dir, 0, 10, [], 300);
    renderer._rootEl.appendChild(li);

    // Click the file row (not the filename)
    const fileRow = li.querySelector('.file-row.has-matches');
    expect(fileRow).not.toBeNull();
    fileRow.click();

    expect(state.matchesCollapsed.has('/r/foo.ts')).toBe(true);
    await awaitRerender();
    expect(state.render).toHaveBeenCalled();
  });

  it('clicking the filename (data-action=openFile) posts openFile, not toggle', () => {
    const state = S.createState();
    state.render = vi.fn();
    state.lastRoots = [];
    const file = makeFile('/r/foo.ts');
    state.searchResults = new Map([['/r/foo.ts', [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }]]]);
    const dir = makeDir('/r', 'r', { files: [file], totalFiles: 1, stats: [] });
    state.expanded.set('/r', true);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(dir, 0, 10, [], 300);
    renderer._rootEl.appendChild(li);

    const fileName = li.querySelector('.file-row.has-matches .file-name');
    expect(fileName).not.toBeNull();
    fileName.click();

    expect(renderer._vscode.postMessage).toHaveBeenCalledWith({ command: 'openFile', path: '/r/foo.ts' });
    // matchesCollapsed should NOT have been populated
    expect(state.matchesCollapsed.has('/r/foo.ts')).toBe(false);
  });

  it('renderFileMatches returns early when file is in matchesCollapsed', () => {
    const state = S.createState();
    state.matchesCollapsed.add('/ws/a.ts');
    state.searchResults = new Map([['/ws/a.ts', [{ line: 1, column: 0, matchLength: 3, lineText: 'abc' }]]]);
    const file = { path: '/ws/a.ts', name: 'a.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.children.length).toBe(0);
  });

  it('more-matches row has data-action="expandTruncated" for clickable expand', () => {
    const state = S.createState();
    state.truncateThreshold = 2;
    const matches = [1, 2, 3, 4].map(line => ({ line, column: 0, matchLength: 1, lineText: 'x' }));
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderMoreMatchesRow(2, 1, [], '/ws/a.ts');
    const row = li.querySelector('.truncated-row');
    expect(row.dataset.action).toBe('expandTruncated');
    expect(row.dataset.dirPath).toBe('/ws/a.ts');
  });
});
