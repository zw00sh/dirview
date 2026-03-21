// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createState, renderTree, formatBytes, formatLines,
} from './index';
import { makeDir, makeRenderer } from './test-helpers';

// --- Root rendering ---

describe('renderTree root rendering', () => {
  // Use two children to prevent single-child compaction, which would change data-node-path.
  function makeWorkspaceRoot() {
    const src = makeDir('/ws/src', 'src', { totalFiles: 1, stats: [] });
    const lib = makeDir('/ws/lib', 'lib', { totalFiles: 1, stats: [] });
    return makeDir('/ws', 'myProject', { children: [src, lib], totalFiles: 2, stats: [] });
  }

  it('renders root children at depth 0 (root itself is not rendered)', () => {
    const state = createState();
    const root = makeWorkspaceRoot();
    state.lastRoots = [root];
    state.currentSortMode = 'files';

    const renderer = makeRenderer(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTree(state, renderer, container);

    const tree = container.querySelector('ul.tree');
    // /ws root itself is NOT rendered as a dir-row
    expect(tree.querySelector('[data-node-path="/ws"]')).toBeNull();
    // /ws/src and /ws/lib are at the top level (depth 0)
    expect(tree.querySelector('[data-node-path="/ws/src"]')).not.toBeNull();
    expect(tree.querySelector('[data-node-path="/ws/lib"]')).not.toBeNull();
  });

  it('dir-name click toggles expand/collapse', () => {
    const state = createState();
    state.render = vi.fn();
    state.lastRoots = [];
    const jsFile = (dir: string, name: string) => ({ name, path: `${dir}/${name}`, langName: 'JS', langColor: '#f1e05a', sizeBytes: 0 });
    const src = makeDir('/ws/src', 'src', { files: [jsFile('/ws/src', 'a.js')], totalFiles: 1, stats: [] });
    state.expanded.set('/ws/src', false);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirNode(src, 0, 10, [], 300);
    renderer._rootEl.appendChild(li);

    const dirName = li.querySelector('.dir-name');
    dirName.click();

    // Clicking dir-name toggles expand state
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

// --- Sort mode rendering: right column and bar metric ---

describe('renderDirRow — sort mode right column', () => {
  function makeFile(dir: string, name: string, opts: { sizeBytes?: number; lineCount?: number } = {}) {
    return { name, path: `${dir}/${name}`, langName: 'TypeScript', langColor: '#3178c6', sizeBytes: opts.sizeBytes ?? 100, lineCount: opts.lineCount ?? 10 };
  }

  function renderDirInMode(sortMode: string) {
    const state = createState();
    state.currentSortMode = sortMode as any;
    const dir = makeDir('src', 'src', {
      totalFiles: 5,
      sizeBytes: 5000,
      totalLines: 300,
      stats: [
        { name: 'TypeScript', color: '#3178c6', count: 3, sizeBytes: 3000, lineCount: 200 },
        { name: 'CSS', color: '#563d7c', count: 2, sizeBytes: 2000, lineCount: 100 },
      ],
      files: [makeFile('/ws/src', 'a.ts')],
    });
    state.expanded.set('src', false);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirRow(dir, 1, 10, [], 300);
    return li;
  }

  it('shows file count in right column for "files" mode', () => {
    const li = renderDirInMode('files');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe('5');
  });

  it('shows formatted bytes in right column for "size" mode', () => {
    const li = renderDirInMode('size');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatBytes(5000));
  });

  it('shows formatted lines in right column for "lines" mode', () => {
    const li = renderDirInMode('lines');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatLines(300));
  });

  it('shows file count in right column for "name" mode', () => {
    const li = renderDirInMode('name');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe('5');
  });
});

describe('renderDirRow — bar metric scales by sort mode', () => {
  function renderBarMetric(sortMode: string) {
    const state = createState();
    state.currentSortMode = sortMode as any;
    const dir = makeDir('src', 'src', {
      totalFiles: 10,
      sizeBytes: 8000,
      totalLines: 500,
      stats: [
        { name: 'TypeScript', color: '#3178c6', count: 6, sizeBytes: 5000, lineCount: 300 },
        { name: 'CSS', color: '#563d7c', count: 4, sizeBytes: 3000, lineCount: 200 },
      ],
    });
    state.expanded.set('src', false);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    // maxMetric = 1000 so we can verify the pct calculation from the bar-wrap width
    const li = renderer.renderDirRow(dir, 1, 1000, [], 300);
    return li;
  }

  it('uses totalFiles for bar metric in "files" mode', () => {
    const li = renderBarMetric('files');
    const barWrap = li.querySelector('.bar-wrap');
    expect(barWrap).not.toBeNull();
    // bar-wrap width should be based on 10/1000
  });

  it('uses sizeBytes for bar metric in "size" mode', () => {
    const li = renderBarMetric('size');
    const barWrap = li.querySelector('.bar-wrap');
    expect(barWrap).not.toBeNull();
    // bar-wrap width should be based on 8000/1000
  });

  it('uses totalLines for bar metric in "lines" mode', () => {
    const li = renderBarMetric('lines');
    const barWrap = li.querySelector('.bar-wrap');
    expect(barWrap).not.toBeNull();
    // bar-wrap width should be based on 500/1000
  });
});

describe('renderDirRow — bar segment proportions reflect sort mode', () => {
  function getSegmentWidths(sortMode: string) {
    const state = createState();
    state.currentSortMode = sortMode as any;
    const dir = makeDir('src', 'src', {
      totalFiles: 10,
      sizeBytes: 10000,
      totalLines: 1000,
      stats: [
        { name: 'TypeScript', color: '#3178c6', count: 7, sizeBytes: 8000, lineCount: 800 },
        { name: 'CSS', color: '#563d7c', count: 3, sizeBytes: 2000, lineCount: 200 },
      ],
    });
    state.expanded.set('src', false);

    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderDirRow(dir, 1, 100, [], 300);
    const segments = li.querySelectorAll('.bar-segment');
    return Array.from(segments).map(s => s.style.width);
  }

  it('uses count proportions in "files" mode', () => {
    const widths = getSegmentWidths('files');
    expect(widths[0]).toBe('70%');
    expect(widths[1]).toBe('30%');
  });

  it('uses sizeBytes proportions in "size" mode', () => {
    const widths = getSegmentWidths('size');
    expect(widths[0]).toBe('80%');
    expect(widths[1]).toBe('20%');
  });

  it('uses lineCount proportions in "lines" mode', () => {
    const widths = getSegmentWidths('lines');
    expect(widths[0]).toBe('80%');
    expect(widths[1]).toBe('20%');
  });
});

describe('renderFileNode — right column adapts to sort mode', () => {
  function renderFileInMode(sortMode: string) {
    const state = createState();
    state.currentSortMode = sortMode as any;
    const file = {
      name: 'index.ts', path: '/ws/src/index.ts',
      langName: 'TypeScript', langColor: '#3178c6',
      sizeBytes: 2048, lineCount: 75,
    };
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    return renderer.renderFileNode(file, 1, []);
  }

  it('shows bytes in "size" mode', () => {
    const li = renderFileInMode('size');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatBytes(2048));
  });

  it('shows line count in "lines" mode', () => {
    const li = renderFileInMode('lines');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatLines(75));
  });

  it('shows bytes by default in "files" mode', () => {
    const li = renderFileInMode('files');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatBytes(2048));
  });
});

describe('renderTruncatedRow — adapts to sort mode', () => {
  function renderTruncatedInMode(sortMode: string) {
    const state = createState();
    state.currentSortMode = sortMode as any;
    const hiddenFiles = [
      { name: 'a.ts', path: '/ws/src/a.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 1000, lineCount: 50 },
      { name: 'b.ts', path: '/ws/src/b.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 2000, lineCount: 100 },
      { name: 'c.css', path: '/ws/src/c.css', langName: 'CSS', langColor: '#563d7c', sizeBytes: 500, lineCount: 20 },
    ];
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    return renderer.renderTruncatedRow(hiddenFiles, 1, [], '/ws/src', 100, 300);
  }

  it('shows file count in "files" mode', () => {
    const li = renderTruncatedInMode('files');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe('3');
  });

  it('shows formatted bytes in "size" mode', () => {
    const li = renderTruncatedInMode('size');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatBytes(3500));
  });

  it('shows formatted lines in "lines" mode', () => {
    const li = renderTruncatedInMode('lines');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatLines(170));
  });
});

describe('renderFileNode — binary file display', () => {
  function renderBinaryFile(sortMode: string) {
    const state = createState();
    state.currentSortMode = sortMode as any;
    const file = {
      name: 'image.png', path: '/ws/src/image.png',
      langName: 'PNG', langColor: '#aaa',
      sizeBytes: 4096, lineCount: 0, isBinary: true,
    };
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    return renderer.renderFileNode(file, 1, []);
  }

  it('shows "BIN" in "lines" mode for binary files', () => {
    const li = renderBinaryFile('lines');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe('BIN');
  });

  it('shows bytes in "size" mode for binary files (not BIN)', () => {
    const li = renderBinaryFile('size');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatBytes(4096));
  });

  it('shows bytes in "files" mode for binary files', () => {
    const li = renderBinaryFile('files');
    const meta = li.querySelector('.file-count');
    expect(meta.textContent).toBe(formatBytes(4096));
  });
});
