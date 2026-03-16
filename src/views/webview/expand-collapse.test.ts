// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createState, createRenderer, tieredExpandAll, tieredCollapseAll,
} from './index';
import { makeDir, makeRenderer, awaitRerender } from './test-helpers';

// --- dir hover action buttons ---

describe('dir hover action buttons', () => {
  it('expand button expands the dir itself and direct children when not all children are expanded', async () => {
    const state = createState();
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
    // Root expanded; child1 expanded, child2 not — so not all expandable children are expanded
    state.expanded.set('/r', true);
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
    const state = createState();
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
    // Root and child1 expanded; child2 is a leaf so it can't be expanded
    state.expanded.set('/r', true);
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
    const state = createState();
    state.render = vi.fn();
    state.lastRoots = [];

    const gc1 = makeDir('/r/a/x', 'x', { totalFiles: 2, stats: [] });
    const gc2 = makeDir('/r/a/y', 'y', { totalFiles: 3, stats: [] });
    const child1 = makeDir('/r/a', 'a', { children: [gc1, gc2], totalFiles: 5, stats: [] });
    const child2 = makeDir('/r/b', 'b', { totalFiles: 3, stats: [] });
    const parent = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 8, stats: [] });
    // Root and both direct children already expanded
    state.expanded.set('/r', true);
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
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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
    const renderer = createRenderer(state, {
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
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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

    state.expanded.set('/p', true);

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
    const state = createState();
    tieredExpandAll(state, [ws]);
    expect(state.expanded.get('/ws/a')).toBe(true);
    expect(state.expanded.get('/ws/b')).toBe(true);
    // 2nd-level should NOT be expanded
    expect(state.expanded.get('/ws/a/x')).toBeFalsy();
    expect(state.expanded.get('/ws/b/p')).toBeFalsy();
  });

  it('tier 1: expands all top-level items even when only some are expanded', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.expanded.set('/ws/a', true); // a expanded, b not
    tieredExpandAll(state, [ws]);
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
    const state = createState();
    state.expanded.set('/ws/a', true); // top-level expanded → tier 2
    tieredExpandAll(state, [ws]);
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
    const state = createState();
    state.expanded.set('/ws/a', true); // a expanded (2 children → path stays '/ws/a')
    // b is leaf → counts as expanded → allTopExpanded = true → tier 2 fires
    tieredExpandAll(state, [ws]);
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
    const state = createState();
    tieredExpandAll(state, [ws1, ws2]);
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
    const state = createState();
    tieredCollapseAll(state, [ws]);
    expect(state.expanded.get('/ws/a/ax')).toBeFalsy();
    expect(state.expanded.get('/ws/b')).toBeFalsy();
  });

  it('tier 2: collapses all top-level items when none have expanded descendants', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    // a compacts to ax → compacted path = '/ws/a/ax'
    // b has 2 children → NOT compacted, path = '/ws/b'
    state.expanded.set('/ws/a/ax', true);
    state.expanded.set('/ws/b', true);
    tieredCollapseAll(state, [ws]);
    expect(state.expanded.get('/ws/a/ax')).toBe(false);
    expect(state.expanded.get('/ws/b')).toBe(false);
  });

  it('tier 1: collapses deeper descendants only, keeping top-level items open', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.expanded.set('/ws/a/ax', true);       // top-level (a compacted to ax)
    state.expanded.set('/ws/a/ax/deep', true);  // deeper descendant (child of ax)
    tieredCollapseAll(state, [ws]);
    // Top-level (/ws/a/ax) should stay open
    expect(state.expanded.get('/ws/a/ax')).toBe(true);
    // Deeper node should be collapsed
    expect(state.expanded.get('/ws/a/ax/deep')).toBe(false);
  });

  it('tier 1 applies when any top-level item has a deeper descendant', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.expanded.set('/ws/a/ax', true);       // a → ax (compacted)
    state.expanded.set('/ws/b', true);          // b expanded, no deeper descendants
    state.expanded.set('/ws/a/ax/deep', true);  // deeper under a
    tieredCollapseAll(state, [ws]);
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
    const state = createState();
    state.expanded.set('/ws1/a', true);
    state.expanded.set('/ws2/b', true);
    tieredCollapseAll(state, [ws1, ws2]);
    expect(state.expanded.get('/ws1/a')).toBe(false);
    expect(state.expanded.get('/ws2/b')).toBe(false);
  });
});

// --- tieredExpandAll with filters active ---

describe('tieredExpandAll with filters', () => {
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

  it('tier 1: recognizes implicitly expanded top-level and expands children', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.fileFilterActive = true; // filter active, no explicit expanded entries
    // All top-level implicitly expanded → tier 2: deep expand
    tieredExpandAll(state, [ws]);
    expect(state.expanded.get('/ws/a/x')).toBe(true);
    expect(state.expanded.get('/ws/b/p')).toBe(true);
  });

  it('tier 1: expands explicitly collapsed top-level items back', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.fileFilterActive = true;
    state.expanded.set('/ws/a', false); // explicitly collapsed during filter
    // Not all top-level expanded → tier 1
    tieredExpandAll(state, [ws]);
    expect(state.expanded.get('/ws/a')).toBe(true);
    expect(state.expanded.get('/ws/b')).toBe(true);
  });
});

// --- tieredCollapseAll with filters active ---

describe('tieredCollapseAll with filters', () => {
  function makeWorkspace() {
    const ax_deep = makeDir('/ws/a/ax/deep', 'deep', { totalFiles: 1 });
    const ax_other = makeDir('/ws/a/ax/other', 'other', { totalFiles: 1 });
    const ax = makeDir('/ws/a/ax', 'ax', { children: [ax_deep, ax_other], totalFiles: 2 });
    const a = makeDir('/ws/a', 'a', { children: [ax], totalFiles: 2 });
    const bx = makeDir('/ws/b/x', 'x', { totalFiles: 1 });
    const by = makeDir('/ws/b/y', 'y', { totalFiles: 1 });
    const b = makeDir('/ws/b', 'b', { children: [bx, by], totalFiles: 2 });
    const ws = makeDir('/ws', 'ws', { children: [a, b], totalFiles: 4 });
    return { ws, a, b, ax, ax_deep, ax_other, bx, by };
  }

  it('tier 1: collapses implicitly expanded deeper descendants', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.searchResults = new Map(); // filter active, all dirs implicitly expanded
    tieredCollapseAll(state, [ws]);
    // Tier 1: deeper descendants collapsed, top-level stays implicitly open
    expect(state.expanded.get('/ws/a/ax/deep')).toBe(false);
    expect(state.expanded.get('/ws/a/ax/other')).toBe(false);
    // Top-level not explicitly collapsed (still implicit)
    expect(state.expanded.has('/ws/a/ax')).toBe(false); // no explicit entry
  });

  it('tier 2: collapses top-level after tier 1 has collapsed descendants', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.searchResults = new Map();
    // Tier 1: collapse deeper
    tieredCollapseAll(state, [ws]);
    // Tier 2: collapse top-level
    tieredCollapseAll(state, [ws]);
    expect(state.expanded.get('/ws/a/ax')).toBe(false);
    expect(state.expanded.get('/ws/b')).toBe(false);
  });

  it('tier 3: no-op when everything is explicitly collapsed', () => {
    const { ws } = makeWorkspace();
    const state = createState();
    state.searchResults = new Map();
    tieredCollapseAll(state, [ws]); // tier 1
    tieredCollapseAll(state, [ws]); // tier 2
    const snapshot = new Map(state.expanded);
    tieredCollapseAll(state, [ws]); // tier 3: no-op
    // State unchanged
    for (const [k, v] of snapshot) {
      expect(state.expanded.get(k)).toBe(v);
    }
  });
});

// --- matchesCollapsed — tieredCollapseAll ---

describe('matchesCollapsed — tieredCollapseAll', () => {
  it('populates matchesCollapsed with all search result paths when collapsing', () => {
    const state = createState();
    state.searchResults = new Map([
      ['/ws/a.ts', []],
      ['/ws/b.ts', []],
    ]);
    const a = makeDir('/ws/a', 'a', { totalFiles: 1 });
    const ws = makeDir('/ws', 'ws', { children: [a], totalFiles: 1 });
    state.expanded.set('/ws/a', true);

    tieredCollapseAll(state, [ws]);

    // All search result file paths added to matchesCollapsed
    expect(state.matchesCollapsed.has('/ws/a.ts')).toBe(true);
    expect(state.matchesCollapsed.has('/ws/b.ts')).toBe(true);
  });

  it('does not modify matchesCollapsed when searchResults is null', () => {
    const state = createState();
    state.matchesCollapsed.add('/existing');
    // searchResults is null (no active search)
    const a = makeDir('/ws/a', 'a', { totalFiles: 1 });
    const ws = makeDir('/ws', 'ws', { children: [a], totalFiles: 1 });
    state.expanded.set('/ws/a', true);

    tieredCollapseAll(state, [ws]);

    // matchesCollapsed should only have the pre-existing path, not be modified by the collapse
    // (the if (state.searchResults) guard prevents population when search is null)
    expect(state.matchesCollapsed.has('/existing')).toBe(true);
  });
});

describe('matchesCollapsed — tieredExpandAll', () => {
  it('clears matchesCollapsed when expanding', () => {
    const state = createState();
    state.matchesCollapsed.add('/ws/a.ts');
    state.matchesCollapsed.add('/ws/b.ts');
    const a = makeDir('/ws/a', 'a', { totalFiles: 1 });
    const ws = makeDir('/ws', 'ws', { children: [a], totalFiles: 1 });

    tieredExpandAll(state, [ws]);

    expect(state.matchesCollapsed.size).toBe(0);
  });
});
