// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createState, createRenderer, patchTreeChildren,
} from './index';
import { makeDir, makeRenderer, awaitRerender } from './test-helpers';

// --- Delegated click handler interaction tests ---
// These tests simulate the full cycle: render → click DOM element → delegated handler fires →
// state updates → rerender → DOM reflects new state. This catches stale-closure and
// event-delegation bugs that attribute-only tests miss.

describe('delegated click handler', () => {
  // -- Data-action attribute presence --

  describe('data-action attributes', () => {
    it('renderTruncatedRow has data-action="expandTruncated" and data-dir-path', () => {
      const state = createState();
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
      const state = createState();
      const renderer = makeRenderer(state);
      const nodes = [makeDir('/r/empty1', 'empty1'), makeDir('/r/empty2', 'empty2')];
      const li = renderer.renderEmptyGroupNode(nodes, 0, 10, []);
      const row = li.querySelector('.empty-group-row');
      expect(row.dataset.action).toBe('expandEmptyGroup');
      expect(row.dataset.groupKey).toBe('/r/empty1');
    });

    it('renderFileNode has data-action="openFile" and data-path when no search matches', () => {
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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

    it('does not toggle empty dirs (no children, no files)', () => {
      const state = createState();
      state.render = vi.fn();
      state.lastRoots = [];
      const renderer = makeRenderer(state);
      // Truly empty dir: no files, no child dirs
      const root = makeDir('/r', 'r', {
        totalFiles: 0,
        stats: [],
      });

      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 1, [], 300);
      renderer._rootEl.appendChild(li);

      li.querySelector('.dir-row[data-path="/r"]').click();

      // Should remain falsy — empty dirs can't expand
      expect(state.expanded.get('/r')).toBeFalsy();
    });

    it('double-click on dir row does not toggle (e.detail >= 2)', () => {
      // Regression: after an action button (e.g. expand-children) triggers a rerender,
      // the rebuilt dir-row loses hover state so its action buttons become display:none.
      // The second click of a double-click then lands on the dir-row and would undo the
      // action. We guard against this by ignoring clicks with e.detail >= 2.
      const state = createState();
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

    it('collapses implicitly expanded dir on first click during search', () => {
      // Regression: when search results are active, dirs without an explicit expanded
      // entry are implicitly expanded (isFiltered=true). The first click must collapse
      // the dir, not set it to true (which it visually already is).
      const state = createState();
      state.render = vi.fn();
      state.lastRoots = [];
      state.searchResults = new Map([['/r/a/foo.ts', []]]);
      state._isFiltered = true;
      const renderer = makeRenderer(state);
      const child1 = makeDir('/r/a', 'a', { totalFiles: 1, stats: [{ name: 'TS', color: '#3178c6', count: 1 }] });
      const child2 = makeDir('/r/b', 'b', { totalFiles: 1, stats: [{ name: 'TS', color: '#3178c6', count: 1 }] });
      const root = makeDir('/r', 'r', { children: [child1, child2], totalFiles: 2, stats: [{ name: 'TS', color: '#3178c6', count: 2 }] });
      // No explicit expanded entry — implicitly expanded due to searchResults + _isFiltered
      renderer.beforeRender();
      const li = renderer.renderDirNode(root, 0, 2, [], 300);
      renderer._rootEl.appendChild(li);

      const dirRow = li.querySelector('.dir-row[data-path="/r"]');
      dirRow.querySelector('.dir-name').click();

      // Should collapse on first click, not require a second click
      expect(state.expanded.get('/r')).toBe(false);
    });
  });

  // -- Collapse resets truncation --

  describe('collapse resets truncation', () => {
    it('collapsing a dir with truncation expanded clears truncation and rerenders', async () => {
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      patchTreeChildren(oldTree, newTree);

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
    const jsFile = (dir: string, name: string) => ({ name, path: `${dir}/${name}`, langName: 'JS', langColor: '#f1e05a', sizeBytes: 100 });

    it('collapsed dir produces an empty children UL', () => {
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      const state = createState();
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
      patchTreeChildren(oldTree, newTree);

      // State should be preserved
      expect(state.expanded.get('/r/a/x')).toBe(true);
      expect(state.expanded.get('/r/b/y')).toBe(false);
    });
  });
});
