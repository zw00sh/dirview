// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createState, renderTree,
} from './index';
import { makeDir, makeRenderer } from './test-helpers';

// --- showRootNode option ---

describe('renderTree showRootNode', () => {
  // Use two children to prevent single-child compaction, which would change data-node-path.
  function makeWorkspaceRoot() {
    const src = makeDir('/ws/src', 'src', { totalFiles: 1, stats: [] });
    const lib = makeDir('/ws/lib', 'lib', { totalFiles: 1, stats: [] });
    return makeDir('/ws', 'myProject', { children: [src, lib], totalFiles: 2, stats: [] });
  }

  it('renders root as a depth-0 dir-row when showRootNode is true', () => {
    const state = createState();
    state.dirPath = '';
    state.workspaceFolderName = 'myProject';
    const root = makeWorkspaceRoot();
    state.lastRoots = [root];
    state.currentSortMode = 'files';

    const renderer = makeRenderer(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTree(state, renderer, container, { showRootNode: true });

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
    const state = createState();
    state.dirPath = '';
    const root = makeWorkspaceRoot();
    state.lastRoots = [root];
    state.currentSortMode = 'files';
    state.expanded.set('/ws', true);

    const renderer = makeRenderer(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTree(state, renderer, container, { showRootNode: true });

    // Root is at depth 0, children are inside root's children UL
    const rootLi = container.querySelector('[data-node-path="/ws"]');
    const childrenUl = rootLi.querySelector('ul.children');
    expect(childrenUl).not.toBeNull();
    expect(childrenUl.querySelector('[data-node-path="/ws/src"]')).not.toBeNull();
    expect(childrenUl.querySelector('[data-node-path="/ws/lib"]')).not.toBeNull();
  });

  it('falls back to rendering root children at depth 0 when showRootNode is false', () => {
    const state = createState();
    const root = makeWorkspaceRoot();
    state.lastRoots = [root];
    state.currentSortMode = 'files';

    const renderer = makeRenderer(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTree(state, renderer, container);  // no showRootNode

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
    const jsFile = (dir: string, name: string) => ({ name, path: `${dir}/${name}`, langName: 'JS', langColor: '#f1e05a', sizeBytes: 0 });
    const src = makeDir('/ws/src', 'src', { files: [jsFile('/ws/src', 'a.js')], totalFiles: 1, stats: [] });
    const lib = makeDir('/ws/lib', 'lib', { files: [jsFile('/ws/lib', 'b.js')], totalFiles: 1, stats: [] });
    const root = makeDir('/ws', 'ws', { children: [src, lib], totalFiles: 2, stats: [] });
    return { root, src, lib };
  }

  it('calls onNavigate with dir path when dir-name is clicked', () => {
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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

  it('includes compacted segments in breadcrumb when subtab root has single-child chain', () => {
    // Regression: subtab root with single-child chain (api→src→controllers) would
    // only show the breadcrumb (workspace/dirPath) and swallow the compacted dirs.
    const state = createState();
    state.dirPath = 'directus';
    state.workspaceFolderName = 'apigateway';
    const navigate = vi.fn();

    // directus → api → src → controllers (single-child chain, no files until controllers)
    const file = { name: 'files.ts', path: '/ws/directus/api/src/controllers/files.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 };
    const controllers = makeDir('directus/api/src/controllers', 'controllers', { files: [file], totalFiles: 1, stats: [] });
    const src = makeDir('directus/api/src', 'src', { children: [controllers], totalFiles: 1, stats: [] });
    const api = makeDir('directus/api', 'api', { children: [src], totalFiles: 1, stats: [] });
    const root = makeDir('directus', 'directus', { children: [api], totalFiles: 1, stats: [] });

    const renderer = makeRenderer(state, { onNavigate: navigate });
    renderer.beforeRender();
    const li = renderer.renderDirRow(root, 0, 10, [], 300);

    const nameEl = li.querySelector('.dir-name');
    const segments = nameEl.querySelectorAll('.path-segment');
    // apigateway / directus / api / src / controllers = 5 segments
    expect(segments.length).toBe(5);
    expect(segments[0].textContent).toBe('apigateway');
    expect(segments[1].textContent).toBe('directus');
    expect(segments[2].textContent).toBe('api');
    expect(segments[3].textContent).toBe('src');
    expect(segments[4].textContent).toBe('controllers');

    // The compacted segments should have context menus for right-click
    expect(segments[2].getAttribute('data-vscode-context')).toContain('directus/api');
    expect(segments[3].getAttribute('data-vscode-context')).toContain('directus/api/src');
    expect(segments[4].getAttribute('data-vscode-context')).toContain('directus/api/src/controllers');
  });

  it('does not render breadcrumb at depth 0 when state.dirPath is empty (workspace root)', () => {
    const state = createState();
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
    const state = createState();
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

// --- Feature 3: single-dir root truncation disabled ---

describe('single-dir root truncation disabled', () => {
  function makeFile(dir: string, name: string) {
    return { name, path: `${dir}/${name}`, langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 };
  }

  it('does not truncate files when depth=0 dir has no child directories', () => {
    const state = createState();
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
    const state = createState();
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
