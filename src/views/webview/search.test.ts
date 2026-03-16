// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createState, createMessageHandler, expandMatchedDirs, expandBatchFiles,
  walkMatchingDirs, scheduleSearchRender, createSearchBar, filterTree,
} from './index';
import { makeDir, makeRenderer, awaitRerender } from './test-helpers';

// --- filterTree: search filtering ---

describe('filterTree search', () => {
  function ft(roots: any[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      fileFilterFn: opts.fileFilterFn ?? null,
      searchResultsVersion: opts.searchResultsVersion ?? 0,
    });
  }

  it('returns original roots when no filters active', () => {
    const root = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    const result = ft([root]);
    expect(result.isFiltered).toBe(false);
    expect(result.roots).toEqual([root]);
  });

  it('keeps dir with direct file in searchResults', () => {
    const root = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    const result = ft([root], { searchResults: new Map([['/a/foo.ts', []]]) });
    expect(result.isFiltered).toBe(true);
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].files.length).toBe(1);
  });

  it('prunes dir when no file matches search', () => {
    const root = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    const result = ft([root], { searchResults: new Map([['/other/file.ts', []]]) });
    expect(result.roots.length).toBe(0);
  });

  it('keeps dir when descendant file matches', () => {
    const nested = makeDir('/a/b', 'b', { files: [{ path: '/a/b/nested.ts', name: 'nested.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    const root = makeDir('/a', 'a', { children: [nested] });
    const result = ft([root], { searchResults: new Map([['/a/b/nested.ts', []]]) });
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].children.length).toBe(1);
  });

  it('prunes file not matching language filter + search intersection', () => {
    const root = makeDir('/a', 'a', { files: [{ path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 }] });
    const result = ft([root], { searchResults: new Map([['/a/foo.ts', []]]), activeFilters: new Set(['YAML']) });
    expect(result.roots.length).toBe(0);
  });

  it('keeps file matching both search and language filter', () => {
    const root = makeDir('/a', 'a', { files: [{ path: '/a/config.yaml', name: 'config.yaml', langName: 'YAML', langColor: '#cb171e', sizeBytes: 0 }] });
    const result = ft([root], { searchResults: new Map([['/a/config.yaml', []]]), activeFilters: new Set(['YAML']) });
    expect(result.roots.length).toBe(1);
  });

  it('prunes dir with YAML (matches filter, not search) + TypeScript (in search, not filter)', () => {
    const root = makeDir('/a', 'a', { files: [
      { path: '/a/config.yaml', name: 'config.yaml', langName: 'YAML', langColor: '#cb171e', sizeBytes: 0 },
      { path: '/a/app.ts', name: 'app.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 },
    ] });
    const result = ft([root], { searchResults: new Map([['/a/app.ts', []]]), activeFilters: new Set(['YAML']) });
    expect(result.roots.length).toBe(0);
  });

  it('prunes empty dir when search is active', () => {
    const root = makeDir('/a', 'a', { files: [], children: [] });
    const result = ft([root], { searchResults: new Map([['/a/other.ts', []]]) });
    expect(result.roots.length).toBe(0);
  });
});

// --- renderMatchLine ---

describe('renderMatchLine', () => {
  it('renders line number and text', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 42, column: 6, matchLength: 3, lineText: 'const api = true;' };
    const li = renderer.renderMatchLine(file, [match], 1, []);
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
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 1, column: 0, matchLength: 0, lineText: 'plain text' };
    const li = renderer.renderMatchLine(file, [match], 1, []);
    expect(li.querySelector('.match-highlight')).toBeNull();
    expect(li.querySelector('.match-line-text').textContent).toBe('plain text');
  });

  it('clicking openFileAtLine posts openFile with line number', () => {
    const state = createState();
    state.lastRoots = [];
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 7, column: 0, matchLength: 3, lineText: 'abc def' };
    const li = renderer.renderMatchLine(file, [match], 1, []);
    renderer._rootEl.appendChild(li);
    li.querySelector('.match-line-row').click();
    expect(renderer._vscode.postMessage).toHaveBeenCalledWith({ command: 'openFile', path: '/a/foo.ts', line: 7 });
  });

  it('uses highlightedHtml when present (sets innerHTML)', () => {
    const state = createState();
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
    const li = renderer.renderMatchLine(file, [match], 1, []);
    const textEl = li.querySelector('.match-line-text');
    // innerHTML should contain the syntax-highlighted span from the backend
    expect(textEl.innerHTML).toContain('#569cd6');
    expect(textEl.innerHTML).toContain('const');
    // Plain-text path should not be used — no extra TextNodes wrapping the match
    expect(textEl.querySelector('.match-highlight')).toBeNull();
  });

  it('falls back to plain text when highlightedHtml is absent', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 1, column: 0, matchLength: 3, lineText: 'abc def' };
    const li = renderer.renderMatchLine(file, [match], 1, []);
    // Plain-text path: match-highlight span should be present
    expect(li.querySelector('.match-highlight')).not.toBeNull();
    expect(li.querySelector('.match-highlight').textContent).toBe('abc');
  });

  it('highlightedHtml takes precedence over lineText when both present', () => {
    const state = createState();
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
    const li = renderer.renderMatchLine(file, [match], 1, []);
    const textEl = li.querySelector('.match-line-text');
    // The highlight span should come from the pre-rendered HTML
    expect(textEl.querySelector('.match-highlight')).not.toBeNull();
    // Verify it's the innerHTML path (no additional text nodes from the plain path)
    expect(textEl.childNodes.length).toBe(1);
  });

  it('sets data-node-path for DOM patching', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 42, column: 6, matchLength: 3, lineText: 'const api = true;' };
    const li = renderer.renderMatchLine(file, [match], 1, []);
    expect(li.dataset.nodePath).toBe('match:/a/foo.ts:42');
  });

  it('merges multiple same-line matches into a single row with all highlights', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const matches = [
      { line: 5, column: 0, matchLength: 3, lineText: 'foo bar foo' },
      { line: 5, column: 8, matchLength: 3, lineText: 'foo bar foo' },
    ];
    const li = renderer.renderMatchLine(file, matches, 1, []);
    const highlights = li.querySelectorAll('.match-highlight');
    expect(highlights.length).toBe(2);
    expect(highlights[0].textContent).toBe('foo');
    expect(highlights[1].textContent).toBe('foo');
    // Only one row, one line number
    expect(li.querySelector('.match-line-number').textContent).toBe('5');
  });

  it('renderFileMatches groups same-line matches into one row', () => {
    const state = createState();
    state.searchResults = new Map([
      ['/a/foo.ts', [
        { line: 5, column: 0, matchLength: 3, lineText: 'foo bar foo' },
        { line: 5, column: 8, matchLength: 3, lineText: 'foo bar foo' },
        { line: 10, column: 0, matchLength: 3, lineText: 'baz qux' },
      ]],
    ]);
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const container = document.createElement('ul');
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    renderer.renderFileMatches(container, file, 1, []);
    const matchRows = container.querySelectorAll('.match-line-row');
    // 2 same-line matches on line 5 → 1 row, plus 1 row for line 10 = 2 rows total
    expect(matchRows.length).toBe(2);
  });
});

// --- renderMoreMatchesRow ---

describe('renderMoreMatchesRow', () => {
  it('renders the count label', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderMoreMatchesRow(3, 1, []);
    expect(li.querySelector('.dir-name').textContent).toBe('3 more matches');
  });

  it('uses singular form for count=1', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderMoreMatchesRow(1, 1, []);
    expect(li.querySelector('.dir-name').textContent).toBe('1 more match');
  });

  it('sets data-node-path when filePath is provided', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderMoreMatchesRow(3, 1, [], '/a/foo.ts');
    expect(li.dataset.nodePath).toBe('more:/a/foo.ts');
  });
});

// --- search rendering integration ---

describe('search rendering integration', () => {
  function makeFile(path: string, name: string | null = null) {
    return { path, name: name || path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  it('renders match lines under matched files', () => {
    const state = createState();
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
    const state = createState();
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

  it('hides files not in searchResults (via filterTree)', () => {
    const state = createState();
    state.searchResults = new Map([['/r/match.ts', []]]);
    state.render = vi.fn();
    state.lastRoots = [];
    const f1 = makeFile('/r/match.ts');
    const f2 = makeFile('/r/nomatch.ts');
    const dir = makeDir('/r', 'r', { files: [f1, f2], totalFiles: 2, stats: [] });
    // Pre-filter the tree as renderTree would
    const filtered = filterTree([dir], {
      activeFilters: state.activeFilters,
      searchResults: state.searchResults,
      searchAncestorPaths: null,
      fileFilterFn: null,
      searchResultsVersion: 0,
    });
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    (state as any)._isFiltered = filtered.isFiltered;
    const li = renderer.renderDirNode(filtered.roots[0], 0, 10, [], 300);
    const fileRows = li.querySelectorAll('.file-row');
    expect(fileRows.length).toBe(1);
    expect(fileRows[0].dataset.path).toBe('/r/match.ts');
  });

  it('auto-expands directories when searchResults is set', () => {
    const state = createState();
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
    const state = createState();
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
    const state = createState();
    state.truncateThreshold = 4; // default
    // Use non-contiguous lines so groups don't merge
    const matches = [10, 30, 50, 70, 90, 110, 130].map(line => ({ line, column: 0, matchLength: 1, lineText: 'x' }));
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

// --- createMessageHandler search messages ---

describe('createMessageHandler search messages', () => {
  function makeHandlerEnv() {
    const state = createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots: any) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler: any = createMessageHandler(state, scanBar as any, rootEl, { render: state.render } as any);
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

  it('searchResults with matches clears prior expanded state and expands ancestors', () => {
    const { state, handler } = makeHandlerEnv();
    state.expanded.set('/some/dir', true);
    handler({ data: { type: 'searchResults', matches: { '/a/foo.ts': [] }, fileCount: 1, matchCount: 0, truncated: false } });
    // Prior expansion (/some/dir) is cleared; ancestor of matched file (/a) is expanded.
    expect(state.expanded.has('/some/dir')).toBe(false);
    expect(state.expanded.has('/a')).toBe(true);
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
    const state = createState();
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
    expandMatchedDirs(state, roots, searchResults, new Set());

    // /ws/src should be expanded (contains match), /ws/docs should not
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.has('/ws/docs')).toBe(false);
    // Root should be expanded (has a matched descendant)
    expect(state.expanded.get('/ws')).toBe(true);
  });

  it('respects active language filters', () => {
    const state = createState();
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
    expandMatchedDirs(state, roots, searchResults, new Set(['JavaScript']));

    // Dir should still be expanded because b.js matches filter + search
    expect(state.expanded.get('/ws/src')).toBe(true);
  });

  it('does not expand dirs when no files match filter', () => {
    const state = createState();
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
    expandMatchedDirs(state, roots, searchResults, new Set(['JavaScript']));

    expect(state.expanded.has('/ws/src')).toBe(false);
  });
});

// --- expandBatchFiles ---
describe('expandBatchFiles', () => {
  it('expands dirs for new batch files without clearing prior expand state', () => {
    const state = createState();
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
    expandBatchFiles(state, roots, new Set(['/ws/src/a.ts']));
    // New match dir is expanded.
    expect(state.expanded.get('/ws/src')).toBe(true);
    // Pre-existing expand state is preserved (not cleared).
    expect(state.expanded.get('/ws/other')).toBe(true);
  });

  it('respects active language filters', () => {
    const state = createState();
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
    expandBatchFiles(state, roots, new Set(['/ws/src/a.ts']));
    expect(state.expanded.has('/ws/src')).toBe(false);
  });

  it('accumulates expand state across multiple batch calls', () => {
    const state = createState();
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
    expandBatchFiles(state, roots, new Set(['/ws/src/a.ts']));
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.has('/ws/lib')).toBe(false);
    // Second batch expands /ws/lib — /ws/src remains expanded.
    expandBatchFiles(state, roots, new Set(['/ws/lib/b.ts']));
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.get('/ws/lib')).toBe(true);
  });
});

// --- searchResultsHighlight ---
describe('searchResultsHighlight', () => {
  function makeHandlerEnv() {
    const state = createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots: any) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = createMessageHandler(state, scanBar as any, rootEl, { render: state.render } as any);
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
    const state = createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn();
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler: any = createMessageHandler(state, scanBar as any, rootEl, { render: state.render } as any);
    state.expanded.set('/ws/old-dir', true);
    handler({ data: { type: 'searchProgress' } });
    expect(state.expanded.size).toBe(0);
  });
});

// --- renderMatchLine edge cases ---

describe('renderMatchLine — edge cases', () => {
  it('handles undefined lineText without throwing (stripped match beyond MAX_MATCH_LINES)', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    // lineText is absent — simulates a match stripped by the backend
    const match = { line: 10, column: 0, matchLength: 3 };
    let li;
    expect(() => { li = renderer.renderMatchLine(file, [match], 1, []); }).not.toThrow();
    // Text element should be empty (no crash, no content)
    expect(li.querySelector('.match-line-text').textContent).toBe('');
  });

  it('escapes HTML special chars in lineText via textContent (plain-text path)', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = { line: 1, column: 0, matchLength: 2, lineText: 'if (a < b && c > d) {}' };
    const li = renderer.renderMatchLine(file, [match], 1, []);
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
    const state = createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots: any) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = createMessageHandler(state, scanBar as any, rootEl, { render: state.render } as any);
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

// --- expandMatchedDirs — deep nesting ---

describe('expandMatchedDirs — deep nesting', () => {
  it('expands all ancestor dirs for a 3-level-deep match', () => {
    const state = createState();
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
    expandMatchedDirs(state, roots, searchResults, new Set());

    expect(state.expanded.get('/ws')).toBe(true);
    expect(state.expanded.get('/ws/src')).toBe(true);
    expect(state.expanded.get('/ws/src/deep')).toBe(true);
  });
});

// --- searchResultsBatch with empty matches ---

describe('searchResultsBatch — empty matches', () => {
  function makeHandlerEnv() {
    const state = createState();
    const scanBar = { show: vi.fn() };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    state.render = vi.fn((roots: any) => { state.lastRoots = roots; });
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    const handler = createMessageHandler(state, scanBar as any, rootEl, { render: state.render } as any);
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
  it('does not throw for file paths that do not match any dir in the tree', () => {
    const state = createState();
    const roots = [
      makeDir('/ws', 'ws', {
        children: [
          makeDir('/ws/src', 'src', {
            files: [{ path: '/ws/src/a.ts', name: 'a.ts', langName: 'TypeScript' }],
          }),
        ],
      }),
    ];
    // Path belongs to a completely different root — should not throw.
    // Ancestor paths are added to expanded (harmless — non-existent dirs
    // are never rendered), and to searchAncestorPaths for O(1) lookups.
    expect(() => {
      expandBatchFiles(state, roots, new Set(['/other/project/file.ts']));
    }).not.toThrow();
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
    const state = createState();
    walkMatchingDirs(state, makeTree(), f => f.path === '/ws/src/lib/b.ts', false);
    expect(state.expanded.get('/ws/src/lib')).toBe(true);
    expect(state.expanded.get('/ws/src')).toBe(true);
  });

  it('does not expand dirs with no matching files', () => {
    const state = createState();
    walkMatchingDirs(state, makeTree(), f => f.path === '/nonexistent.ts', false);
    expect(state.expanded.size).toBe(0);
  });

  it('clearFirst=true clears state.expanded before walking', () => {
    const state = createState();
    state.expanded.set('/ws/src', true); // pre-existing
    walkMatchingDirs(state, makeTree(), f => f.path === '/ws/src/lib/b.ts', true);
    // '/ws/src' should still be expanded (matched via descendant), not missing
    expect(state.expanded.get('/ws/src')).toBe(true);
    // but the clear happened — any path NOT matching is gone
    // (confirm by adding a path that wouldn't match)
    const state2 = createState();
    state2.expanded.set('/unrelated/path', true);
    walkMatchingDirs(state2, makeTree(), () => false, true);
    expect(state2.expanded.has('/unrelated/path')).toBe(false);
  });

  it('clearFirst=false preserves existing expanded state', () => {
    const state = createState();
    state.expanded.set('/unrelated/path', true);
    walkMatchingDirs(state, makeTree(), () => false, false);
    expect(state.expanded.has('/unrelated/path')).toBe(true);
  });

  it('is a no-op for empty roots', () => {
    const state = createState();
    expect(() => walkMatchingDirs(state, [], () => true, false)).not.toThrow();
    expect(state.expanded.size).toBe(0);
  });
});

// --- scheduleSearchRender ---

describe('scheduleSearchRender', () => {
  it('schedules a render after 300ms', async () => {
    const state = createState();
    const rerender = vi.fn();
    state.rerender = rerender;
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    scheduleSearchRender(state);
    expect(rerender).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 350));
    expect(rerender).toHaveBeenCalledOnce();
    expect(state._searchRenderTimer).toBeNull();
  });

  it('does not schedule a second timer when one is already pending', async () => {
    const state = createState();
    const rerender = vi.fn();
    state.rerender = rerender;
    state.lastRoots = [makeDir('/ws', 'ws', {})];
    scheduleSearchRender(state);
    scheduleSearchRender(state); // second call — should be a no-op
    await new Promise(r => setTimeout(r, 350));
    expect(rerender).toHaveBeenCalledOnce(); // only fired once
  });

  it('is a no-op when state.lastRoots is null', async () => {
    const state = createState();
    const rerender = vi.fn();
    state.rerender = rerender;
    state.lastRoots = null;
    scheduleSearchRender(state);
    await new Promise(r => setTimeout(r, 350));
    expect(rerender).not.toHaveBeenCalled();
    expect(state._searchRenderTimer).toBeNull();
  });
});

// --- collapsible file-row with search matches ---

describe('collapsible file-row with search matches', () => {
  function makeFile(path: string, name: string | null = null) {
    return { path, name: name || path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  it('file row has has-matches class and chevron when file has matches', () => {
    const state = createState();
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
    const state = createState();
    const file = makeFile('/r/foo.ts');
    state.searchResults = new Map([['/r/foo.ts', []]]); // empty matches array
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const li = renderer.renderFileNode(file, 0, []);
    const row = li.querySelector('.file-row');
    expect(row.classList.contains('has-matches')).toBe(false);
  });

  it('clicking the file row (outside filename) toggles matchesCollapsed and rerenders', async () => {
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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
    const state = createState();
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

// --- createSearchBar setDirPill ---
describe('createSearchBar setDirPill', () => {
  function makeSearchBar(standalone: boolean) {
    const state = createState();
    const vscode = { postMessage: vi.fn() } as any;
    const bar = createSearchBar(state, vscode, standalone ? { standalone: true } : undefined);
    return { bar, vscode };
  }

  it('shows pill with basename for a subdirectory path', () => {
    const { bar } = makeSearchBar(false);
    bar.setDirPill('src/scanner');
    const pill = bar.el.querySelector('.search-dir-pill');
    expect(pill.style.display).toBe('');
    expect(pill.querySelector('.search-dir-pill-text').textContent).toBe('in: scanner');
  });

  it('hides pill when dirPath is empty', () => {
    const { bar } = makeSearchBar(false);
    bar.setDirPill('src/scanner');
    bar.setDirPill('');
    const pill = bar.el.querySelector('.search-dir-pill');
    expect(pill.style.display).toBe('none');
  });

  it('uses the last segment for deeply nested paths', () => {
    const { bar } = makeSearchBar(false);
    bar.setDirPill('deep/nested/dir');
    const pill = bar.el.querySelector('.search-dir-pill');
    expect(pill.querySelector('.search-dir-pill-text').textContent).toBe('in: dir');
  });

  it('close button posts navigateToDir with empty path', () => {
    const { bar, vscode } = makeSearchBar(false);
    bar.setDirPill('src/scanner');
    const closeBtn = bar.el.querySelector('.search-dir-pill-close');
    closeBtn.click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'navigateToDir', path: '' });
  });

  it('is a no-op in standalone mode', () => {
    const { bar } = makeSearchBar(true);
    bar.setDirPill('src/scanner');
    const pill = bar.el.querySelector('.search-dir-pill');
    expect(pill).toBeNull();
  });
});

// --- createSearchBar setHasRipgrep ---
describe('createSearchBar setHasRipgrep', () => {
  function makeSearchBar() {
    const state = createState();
    state.render = vi.fn();
    state.lastRoots = [];
    state.lastAutoRescanEnabled = true;
    state.currentSortMode = 'files';
    state.scanBar = { show: vi.fn() } as any;
    const vscode = { postMessage: vi.fn() } as any;
    const bar = createSearchBar(state, vscode);
    return { bar, state };
  }

  it('hides content search controls when ripgrep is unavailable', () => {
    const { bar } = makeSearchBar();
    bar.setHasRipgrep(false);
    const inputContainer = bar.el.querySelector('.search-input-container') as HTMLElement;
    const contextWrap = bar.el.querySelector('.search-context-input-wrap') as HTMLElement;
    const contextBtn = bar.el.querySelector('.search-context-toggle') as HTMLElement;
    expect(inputContainer.style.display).toBe('none');
    expect(contextWrap.style.display).toBe('none');
    expect(contextBtn.style.display).toBe('none');
  });

  it('keeps file include filter visible when ripgrep is unavailable', () => {
    const { bar } = makeSearchBar();
    bar.setHasRipgrep(false);
    const filterRow = bar.el.querySelector('.search-filter-input-row') as HTMLElement;
    expect(filterRow).toBeTruthy();
    expect(filterRow.style.display).not.toBe('none');
  });

  it('restores content search controls when ripgrep becomes available', () => {
    const { bar } = makeSearchBar();
    bar.setHasRipgrep(false);
    bar.setHasRipgrep(true);
    const inputContainer = bar.el.querySelector('.search-input-container') as HTMLElement;
    const contextWrap = bar.el.querySelector('.search-context-input-wrap') as HTMLElement;
    expect(inputContainer.style.display).toBe('');
    expect(contextWrap.style.display).toBe('');
  });
});
