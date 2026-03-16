// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createState, getVisibleFiles, createSearchBar, filterTree,
} from './index';
import { makeDir, makeRenderer } from './test-helpers';
import type { DirNode } from './types';

// --- getVisibleFiles (no file filter fn — purely lang + search filters) ---
describe('getVisibleFiles', () => {
  const files = [
    { name: 'apiHandler.ts', path: '/ws/apiHandler.ts', langName: 'TypeScript' },
    { name: 'utils.ts', path: '/ws/utils.ts', langName: 'TypeScript' },
    { name: 'auth.js', path: '/ws/auth.js', langName: 'JavaScript' },
  ] as any[];

  it('returns all files when no filters active', () => {
    const result = (getVisibleFiles as any)(files, new Set(), null);
    expect(result).toEqual(files);
  });

  it('filters by activeFilters (language)', () => {
    const result = (getVisibleFiles as any)(files, new Set(['TypeScript']), null);
    expect(result.map((f: any) => f.name)).toEqual(['apiHandler.ts', 'utils.ts']);
  });

  it('filters by searchResults', () => {
    const searchResults = new Map([['/ws/apiHandler.ts', []]]);
    const result = (getVisibleFiles as any)(files, new Set(), searchResults);
    expect(result.map((f: any) => f.name)).toEqual(['apiHandler.ts']);
  });

  it('combines activeFilters and searchResults', () => {
    const searchResults = new Map([['/ws/apiHandler.ts', []], ['/ws/auth.js', []]]);
    const result = (getVisibleFiles as any)(files, new Set(['TypeScript']), searchResults);
    // Must match BOTH activeFilters (TypeScript) and searchResults
    expect(result.map((f: any) => f.name)).toEqual(['apiHandler.ts']);
  });
});

// --- filterTree: search results filter ---
describe('filterTree with searchResults', () => {
  function ft(roots: DirNode[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      searchResultsVersion: opts.searchResultsVersion ?? 0,
    });
  }

  it('returns original roots when no filters active', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [{ name: 'index.ts', path: '/ws/src/index.ts', langName: 'TypeScript' }],
    });
    const result = ft([dir]);
    expect(result.isFiltered).toBe(false);
    expect(result.roots[0].files.length).toBe(1);
  });

  it('keeps dir with direct file match in searchResults', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [
        { name: 'apiHandler.ts', path: '/ws/src/apiHandler.ts', langName: 'TypeScript' },
        { name: 'utils.ts', path: '/ws/src/utils.ts', langName: 'TypeScript' },
      ],
    });
    const searchResults = new Map([['/ws/src/apiHandler.ts', []]]) as Map<string, any>;
    const result = ft([dir], { searchResults, searchAncestorPaths: new Set(['/ws/src', '']) });
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].files.length).toBe(1);
    expect(result.roots[0].files[0].name).toBe('apiHandler.ts');
  });

  it('prunes dir when no file matches searchResults', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [{ name: 'utils.ts', path: '/ws/src/utils.ts', langName: 'TypeScript' }],
    });
    const searchResults = new Map([['/ws/other/foo.ts', []]]) as Map<string, any>;
    const result = ft([dir], { searchResults, searchAncestorPaths: new Set(['']) });
    expect(result.roots.length).toBe(0);
  });

  it('keeps dir when descendant file matches searchResults', () => {
    const child = makeDir('/ws/src/handlers', 'handlers', {
      files: [{ name: 'apiHandler.ts', path: '/ws/src/handlers/apiHandler.ts', langName: 'TypeScript' }],
    });
    const dir = makeDir('/ws/src', 'src', { children: [child] });
    const searchResults = new Map([['/ws/src/handlers/apiHandler.ts', []]]) as Map<string, any>;
    const result = ft([dir], { searchResults, searchAncestorPaths: new Set(['/ws/src', '/ws/src/handlers', '']) });
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].children.length).toBe(1);
  });

  it('respects activeFilters intersection with searchResults', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [{ name: 'apiHandler.ts', path: '/ws/src/apiHandler.ts', langName: 'TypeScript' }],
    });
    const searchResults = new Map([['/ws/src/apiHandler.ts', []]]) as Map<string, any>;
    // Language filter requires JavaScript, but file is TypeScript → pruned
    const result = ft([dir], { searchResults, searchAncestorPaths: new Set(['', '/ws/src']), activeFilters: new Set(['JavaScript']) });
    expect(result.roots.length).toBe(0);
  });
});

// --- filterTree: stats/totalFiles/sizeBytes recomputation ---
describe('filterTree recomputes stats on filtered nodes', () => {
  function ft(roots: DirNode[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      searchResultsVersion: opts.searchResultsVersion ?? Date.now(),
    });
  }

  it('recomputes totalFiles to reflect only filtered files', () => {
    const dir = makeDir('src', 'src', {
      totalFiles: 3,
      sizeBytes: 300,
      stats: [
        { name: 'TypeScript', color: '#3178c6', count: 2 },
        { name: 'JavaScript', color: '#f1e05a', count: 1 },
      ],
      files: [
        { name: 'api.ts', path: '/ws/src/api.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
        { name: 'utils.ts', path: '/ws/src/utils.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
        { name: 'auth.js', path: '/ws/src/auth.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
      ],
    });
    // Filter to TypeScript only via language filter
    const result = ft([dir], { activeFilters: new Set(['TypeScript']) });
    expect(result.roots[0].totalFiles).toBe(2);
    expect(result.roots[0].sizeBytes).toBe(200);
    expect(result.roots[0].stats).toEqual([
      { name: 'TypeScript', color: '#3178c6', count: 2 },
    ]);
  });

  it('recomputes stats from filtered children recursively', () => {
    const child = makeDir('src/api', 'api', {
      totalFiles: 2,
      sizeBytes: 200,
      stats: [
        { name: 'TypeScript', color: '#3178c6', count: 1 },
        { name: 'JavaScript', color: '#f1e05a', count: 1 },
      ],
      files: [
        { name: 'handler.ts', path: '/ws/src/api/handler.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
        { name: 'config.js', path: '/ws/src/api/config.js', langName: 'JavaScript', langColor: '#f1e05a', sizeBytes: 100 },
      ],
    });
    const parent = makeDir('src', 'src', {
      totalFiles: 3,
      sizeBytes: 350,
      stats: [
        { name: 'TypeScript', color: '#3178c6', count: 2 },
        { name: 'JavaScript', color: '#f1e05a', count: 1 },
      ],
      children: [child],
      files: [
        { name: 'index.ts', path: '/ws/src/index.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 150 },
      ],
    });
    // Filter to TypeScript only
    const result = ft([parent], { activeFilters: new Set(['TypeScript']) });
    expect(result.roots[0].totalFiles).toBe(2); // index.ts + handler.ts
    expect(result.roots[0].sizeBytes).toBe(250);
    expect(result.roots[0].stats).toEqual([
      { name: 'TypeScript', color: '#3178c6', count: 2 },
    ]);
    expect(result.roots[0].children[0].totalFiles).toBe(1);
    expect(result.roots[0].children[0].sizeBytes).toBe(100);
  });

  it('preserves original stats when no filter is active', () => {
    const dir = makeDir('src', 'src', {
      totalFiles: 5,
      sizeBytes: 500,
      stats: [{ name: 'TypeScript', color: '#3178c6', count: 5 }],
      files: [
        { name: 'a.ts', path: '/ws/src/a.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
      ],
    });
    const result = ft([dir]);
    // Original node returned, stats unchanged
    expect(result.roots[0].totalFiles).toBe(5);
    expect(result.roots[0].sizeBytes).toBe(500);
  });

  it('recomputes stats with language filter', () => {
    const dir = makeDir('src', 'src', {
      totalFiles: 3,
      sizeBytes: 300,
      stats: [
        { name: 'TypeScript', color: '#3178c6', count: 2 },
        { name: 'Python', color: '#3572a5', count: 1 },
      ],
      files: [
        { name: 'a.ts', path: '/ws/src/a.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
        { name: 'b.ts', path: '/ws/src/b.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
        { name: 'c.py', path: '/ws/src/c.py', langName: 'Python', langColor: '#3572a5', sizeBytes: 100 },
      ],
    });
    const result = ft([dir], { activeFilters: new Set(['TypeScript']) });
    expect(result.roots[0].totalFiles).toBe(2);
    expect(result.roots[0].sizeBytes).toBe(200);
    expect(result.roots[0].stats).toEqual([
      { name: 'TypeScript', color: '#3178c6', count: 2 },
    ]);
  });
});

// --- filterTree: totalVisibleMatches ---
describe('filterTree totalVisibleMatches', () => {
  function ft(roots: DirNode[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      searchResultsVersion: opts.searchResultsVersion ?? Date.now(),
    });
  }

  it('returns 0 when no search is active', () => {
    const dir = makeDir('src', 'src', {
      files: [{ name: 'a.ts', path: '/ws/src/a.ts', langName: 'TypeScript' }],
    });
    expect(ft([dir]).totalVisibleMatches).toBe(0);
  });

  it('counts matches across all visible files', () => {
    const dir = makeDir('src', 'src', {
      files: [
        { name: 'a.ts', path: '/ws/src/a.ts', langName: 'TypeScript' },
        { name: 'b.ts', path: '/ws/src/b.ts', langName: 'TypeScript' },
      ],
    });
    const searchResults = new Map([
      ['/ws/src/a.ts', [
        { line: 1, column: 0, matchLength: 3, lineText: 'import foo' },
        { line: 5, column: 0, matchLength: 3, lineText: 'import bar' },
      ]],
      ['/ws/src/b.ts', [
        { line: 2, column: 0, matchLength: 3, lineText: 'import baz' },
      ]],
    ]);
    const result = ft([dir], { searchResults, searchAncestorPaths: new Set(['src', '']) });
    expect(result.totalVisibleMatches).toBe(3);
    expect(result.totalVisibleFiles).toBe(2);
  });

  it('excludes context lines from match count', () => {
    const dir = makeDir('src', 'src', {
      files: [{ name: 'a.ts', path: '/ws/src/a.ts', langName: 'TypeScript' }],
    });
    const searchResults = new Map([
      ['/ws/src/a.ts', [
        { line: 1, column: 0, matchLength: 3, lineText: 'context before', isContext: true },
        { line: 2, column: 0, matchLength: 3, lineText: 'import foo' },
        { line: 3, column: 0, matchLength: 3, lineText: 'context after', isContext: true },
      ]],
    ]);
    const result = ft([dir], { searchResults, searchAncestorPaths: new Set(['src', '']) });
    expect(result.totalVisibleMatches).toBe(1);
  });
});

// --- filterTree: totalVisibleMatches with language filter ---
describe('filterTree totalVisibleMatches with language filter', () => {
  function ft(roots: DirNode[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      searchResultsVersion: opts.searchResultsVersion ?? Date.now(),
    });
  }

  it('excludes matches from files hidden by language filter', () => {
    const dir = makeDir('src', 'src', {
      files: [
        { name: 'api.ts', path: '/ws/src/api.ts', langName: 'TypeScript' },
        { name: 'api.java', path: '/ws/src/api.java', langName: 'Java' },
      ],
    });
    const searchResults = new Map([
      ['/ws/src/api.ts', [
        { line: 1, column: 0, matchLength: 3, lineText: 'import foo' },
        { line: 2, column: 0, matchLength: 3, lineText: 'import bar' },
      ]],
      ['/ws/src/api.java', [
        { line: 1, column: 0, matchLength: 3, lineText: 'import baz' },
      ]],
    ]);
    // Language filter for TypeScript only — Java file's match should be excluded
    const result = ft([dir], {
      searchResults,
      searchAncestorPaths: new Set(['src', '']),
      activeFilters: new Set(['TypeScript']),
    });
    expect(result.totalVisibleMatches).toBe(2);
    expect(result.totalVisibleFiles).toBe(1);
  });
});

// --- search bar: glob-only file filter ---
describe('search bar file filter (glob)', () => {
  function makeSearchBarForFilter(standalone: boolean) {
    const state = createState();
    state.render = vi.fn();
    state.lastRoots = [];
    state.lastAutoRescanEnabled = true;
    state.currentSortMode = 'files';
    state.scanBar = { show: vi.fn() } as any;
    const vscode = { postMessage: vi.fn() } as any;
    const bar = createSearchBar(state, vscode, standalone ? { standalone: true } : undefined);
    return { bar, state, vscode };
  }

  it('has no regex toggle button inside the filter container', () => {
    const { bar } = makeSearchBarForFilter(false);
    const container = bar.el.querySelector('.search-filter-container');
    const regexBtn = container.querySelector('[aria-label="Use Regular Expression"]');
    expect(regexBtn).toBeNull();
  });

  it('posts searchFiles with glob when include has a pattern and no content search', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = '*.ts';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'searchFiles', glob: '*.ts', exclude: undefined });
    vi.useRealTimers();
  });

  it('passes glob to ripgrep without normalization', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = 'api';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'searchFiles', glob: 'api', exclude: undefined });
    vi.useRealTimers();
  });

  it('sets fileFilterActive and clears on filter clear button', () => {
    vi.useFakeTimers();
    const { bar, state } = makeSearchBarForFilter(false);
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = '*.ts';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(state.fileFilterActive).toBe(true);
    // Clear via the filter's own clear button
    const filterClearBtn = bar.el.querySelector('.search-filter-container .search-toggle[title="Clear File Filter"]');
    filterClearBtn.click();
    expect(state.fileFilterActive).toBe(false);
    vi.useRealTimers();
  });

  it('passes include glob to ripgrep with content search', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = '*.ts';
    mainInput.value = 'fetchUser';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'search',
      pattern: 'fetchUser',
      include: '*.ts',
    }));
    vi.useRealTimers();
  });

  it('shows regex-error on main input for invalid regex', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    const inputContainer = bar.el.querySelector('.search-input-container') as HTMLElement;
    mainInput.value = '(unclosed';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(inputContainer.classList.contains('regex-error')).toBe(true);
    expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'search' }));
    vi.useRealTimers();
  });

  it('clears regex-error when pattern becomes valid', () => {
    vi.useFakeTimers();
    const { bar } = makeSearchBarForFilter(false);
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    const inputContainer = bar.el.querySelector('.search-input-container') as HTMLElement;
    mainInput.value = '(unclosed';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(inputContainer.classList.contains('regex-error')).toBe(true);
    mainInput.value = 'valid';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(inputContainer.classList.contains('regex-error')).toBe(false);
    vi.useRealTimers();
  });

  it('content search regex is enabled by default', () => {
    const { bar } = makeSearchBarForFilter(false);
    const regexBtn = bar.el.querySelector('.search-input-container [aria-label="Use Regular Expression"]');
    expect(regexBtn!.classList.contains('active')).toBe(true);
  });

  it('has a details toggle button', () => {
    const { bar } = makeSearchBarForFilter(false);
    const toggle = bar.el.querySelector('[aria-label="Toggle Search Details"]');
    expect(toggle).not.toBeNull();
  });

  it('toggles details section (include + exclude) visibility', () => {
    const { bar } = makeSearchBarForFilter(false);
    const toggle = bar.el.querySelector('[aria-label="Toggle Search Details"]') as HTMLButtonElement;
    const detailsSection = bar.el.querySelector('.search-details') as HTMLElement;
    expect(detailsSection.style.display).toBe('none');
    toggle.click();
    expect(detailsSection.style.display).toBe('');
    toggle.click();
    expect(detailsSection.style.display).toBe('none');
  });

  it('passes exclude glob to searchFiles', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    // Open details
    const toggle = bar.el.querySelector('[aria-label="Toggle Search Details"]') as HTMLButtonElement;
    toggle.click();
    const includeInput = bar.el.querySelector('[aria-label="files to include"]') as HTMLInputElement;
    const excludeInput = bar.el.querySelector('[aria-label="files to exclude"]') as HTMLInputElement;
    includeInput.value = '*.ts';
    excludeInput.value = 'test/**';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'searchFiles',
      glob: '*.ts',
      exclude: 'test/**',
    });
    vi.useRealTimers();
  });

  it('passes exclude glob to content search', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const toggle = bar.el.querySelector('[aria-label="Toggle Search Details"]') as HTMLButtonElement;
    toggle.click();
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    const excludeInput = bar.el.querySelector('[aria-label="files to exclude"]') as HTMLInputElement;
    mainInput.value = 'import';
    excludeInput.value = 'node_modules';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'search',
      pattern: 'import',
      exclude: 'node_modules',
    }));
    vi.useRealTimers();
  });

  it('sends exclude-only filter with wildcard include', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const toggle = bar.el.querySelector('[aria-label="Toggle Search Details"]') as HTMLButtonElement;
    toggle.click();
    const excludeInput = bar.el.querySelector('[aria-label="files to exclude"]') as HTMLInputElement;
    excludeInput.value = 'test/**';
    excludeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'searchFiles',
      glob: '*',
      exclude: 'test/**',
    });
    vi.useRealTimers();
  });
});
