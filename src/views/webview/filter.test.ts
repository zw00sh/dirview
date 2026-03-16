// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createState, getVisibleFiles, createSearchBar, filterTree,
} from './index';
import { makeDir, makeRenderer } from './test-helpers';
import type { DirNode } from './types';

// --- file filter: getVisibleFiles with fileFilterFn ---
describe('getVisibleFiles with fileFilterFn', () => {
  const files = [
    { name: 'apiHandler.ts', path: '/ws/apiHandler.ts', langName: 'TypeScript' },
    { name: 'utils.ts', path: '/ws/utils.ts', langName: 'TypeScript' },
    { name: 'auth.js', path: '/ws/auth.js', langName: 'JavaScript' },
  ] as any[];

  it('returns all files when fileFilterFn is null', () => {
    const result = (getVisibleFiles as any)(files, new Set(), null, null);
    expect(result).toEqual(files);
  });

  it('filters files by name with fileFilterFn', () => {
    const fn = (path: string) => path.toLowerCase().includes('api');
    const result = (getVisibleFiles as any)(files, new Set(), null, fn);
    expect(result).toEqual([files[0]]);
  });

  it('combines fileFilterFn with activeFilters', () => {
    const fn = (path: string) => /\.ts$/.test(path);
    const result = (getVisibleFiles as any)(files, new Set(['TypeScript']), null, fn);
    expect(result.map((f: any) => f.name)).toEqual(['apiHandler.ts', 'utils.ts']);
  });

  it('combines fileFilterFn with searchResults', () => {
    const fn = (path: string) => path.includes('api') || path.includes('auth');
    const searchResults = new Map([['/ws/apiHandler.ts', []]]);
    const result = (getVisibleFiles as any)(files, new Set(), searchResults, fn);
    // Must match BOTH searchResults and fileFilterFn
    expect(result.map((f: any) => f.name)).toEqual(['apiHandler.ts']);
  });
});

// --- filterTree: file filter ---
describe('filterTree fileFilter', () => {
  function ft(roots: DirNode[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      fileFilterFn: opts.fileFilterFn ?? null,
      searchResultsVersion: opts.searchResultsVersion ?? 0,
    });
  }

  it('returns original roots when fileFilterFn is null', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [{ name: 'index.ts', path: '/ws/src/index.ts', langName: 'TypeScript' }],
    });
    const result = ft([dir]);
    expect(result.isFiltered).toBe(false);
    expect(result.roots[0].files.length).toBe(1);
  });

  it('keeps dir with direct file match', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [
        { name: 'apiHandler.ts', path: '/ws/src/apiHandler.ts', langName: 'TypeScript' },
        { name: 'utils.ts', path: '/ws/src/utils.ts', langName: 'TypeScript' },
      ],
    });
    const result = ft([dir], { fileFilterFn: (n: string) => n.includes('api') });
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].files.length).toBe(1);
    expect(result.roots[0].files[0].name).toBe('apiHandler.ts');
  });

  it('prunes dir when no file matches', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [{ name: 'utils.ts', path: '/ws/src/utils.ts', langName: 'TypeScript' }],
    });
    const result = ft([dir], { fileFilterFn: (n: string) => n.includes('api') });
    expect(result.roots.length).toBe(0);
  });

  it('keeps dir when descendant file matches', () => {
    const child = makeDir('/ws/src/handlers', 'handlers', {
      files: [{ name: 'apiHandler.ts', path: '/ws/src/handlers/apiHandler.ts', langName: 'TypeScript' }],
    });
    const dir = makeDir('/ws/src', 'src', { children: [child] });
    const result = ft([dir], { fileFilterFn: (n: string) => n.includes('api') });
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].children.length).toBe(1);
  });

  it('respects activeFilters intersection', () => {
    const dir = makeDir('/ws/src', 'src', {
      files: [{ name: 'apiHandler.ts', path: '/ws/src/apiHandler.ts', langName: 'TypeScript' }],
    });
    const result = ft([dir], { fileFilterFn: (n: string) => n.includes('api'), activeFilters: new Set(['JavaScript']) });
    expect(result.roots.length).toBe(0);
  });
});

// --- file filter matches against relative path, not just filename ---
describe('filterTree fileFilter matches relative path', () => {
  function ft(roots: DirNode[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      fileFilterFn: opts.fileFilterFn ?? null,
      searchResultsVersion: opts.searchResultsVersion ?? Date.now(),
    });
  }

  it('matches files by directory name in their relative path', () => {
    // Regex "api" should match files inside an "api" directory, not just files named "api*"
    const apiDir = makeDir('src/api', 'api', {
      files: [
        { name: 'index.ts', path: '/ws/src/api/index.ts', langName: 'TypeScript' },
        { name: 'utils.ts', path: '/ws/src/api/utils.ts', langName: 'TypeScript' },
      ],
    });
    const libDir = makeDir('src/lib', 'lib', {
      files: [{ name: 'helper.ts', path: '/ws/src/lib/helper.ts', langName: 'TypeScript' }],
    });
    const src = makeDir('src', 'src', { children: [apiDir, libDir] });
    const result = ft([src], { fileFilterFn: (p: string) => /api/.test(p) });
    expect(result.roots.length).toBe(1);
    // src/api should be kept (both files match via dir path), src/lib should be pruned
    expect(result.roots[0].children.length).toBe(1);
    expect(result.roots[0].children[0].name).toBe('api');
    expect(result.roots[0].children[0].files.length).toBe(2);
  });

  it('matches files by filename in relative path', () => {
    const dir = makeDir('src', 'src', {
      files: [
        { name: 'api.ts', path: '/ws/src/api.ts', langName: 'TypeScript' },
        { name: 'utils.ts', path: '/ws/src/utils.ts', langName: 'TypeScript' },
      ],
    });
    const result = ft([dir], { fileFilterFn: (p: string) => /api/.test(p) });
    expect(result.roots[0].files.length).toBe(1);
    expect(result.roots[0].files[0].name).toBe('api.ts');
  });
});

// --- filterTree: totalVisibleMatches ---
describe('filterTree totalVisibleMatches', () => {
  function ft(roots: DirNode[], opts: Partial<Parameters<typeof filterTree>[1]> = {}) {
    return filterTree(roots, {
      activeFilters: opts.activeFilters ?? new Set(),
      searchResults: opts.searchResults ?? null,
      searchAncestorPaths: opts.searchAncestorPaths ?? null,
      fileFilterFn: opts.fileFilterFn ?? null,
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

  it('excludes matches from files hidden by file filter', () => {
    const dir = makeDir('src', 'src', {
      files: [
        { name: 'api.ts', path: '/ws/src/api.ts', langName: 'TypeScript' },
        { name: 'utils.ts', path: '/ws/src/utils.ts', langName: 'TypeScript' },
      ],
    });
    const searchResults = new Map([
      ['/ws/src/api.ts', [
        { line: 1, column: 0, matchLength: 3, lineText: 'import foo' },
      ]],
      ['/ws/src/utils.ts', [
        { line: 1, column: 0, matchLength: 3, lineText: 'import bar' },
        { line: 2, column: 0, matchLength: 3, lineText: 'import baz' },
      ]],
    ]);
    // File filter "api" hides utils.ts, so only 1 match should be counted
    const result = ft([dir], {
      searchResults,
      searchAncestorPaths: new Set(['src', '']),
      fileFilterFn: (p: string) => /api/.test(p),
    });
    expect(result.totalVisibleMatches).toBe(1);
    expect(result.totalVisibleFiles).toBe(1);
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
      fileFilterFn: opts.fileFilterFn ?? null,
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

// --- file filter: search bar regex toggle ---
describe('search bar file filter', () => {
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

  it('has a regex toggle button inside the filter container', () => {
    const { bar } = makeSearchBarForFilter(false);
    const container = bar.el.querySelector('.search-filter-container');
    const regexBtn = container.querySelector('[aria-label="Use Regular Expression"]');
    expect(regexBtn).not.toBeNull();
  });

  it('regex mode is active by default', () => {
    const { bar } = makeSearchBarForFilter(false);
    const container = bar.el.querySelector('.search-filter-container');
    const regexBtn = container.querySelector('[aria-label="Use Regular Expression"]');
    expect(regexBtn.classList.contains('active')).toBe(true);
  });

  it('sets fileFilterFn and rerenders with regex by default (no toggle needed)', () => {
    vi.useFakeTimers();
    const { bar, state } = makeSearchBarForFilter(false);
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = 'api|auth';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(state.fileFilterFn).toBeInstanceOf(Function);
    expect(state.fileFilterFn!('apiHandler.ts')).toBe(true);
    expect(state.fileFilterFn!('authService.js')).toBe(true);
    expect(state.fileFilterFn!('utils.ts')).toBe(false);
    vi.useRealTimers();
  });

  it('posts searchFiles with glob as-is when regex is toggled off', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    // Deactivate regex toggle (on by default)
    const container = bar.el.querySelector('.search-filter-container');
    const regexBtn = container.querySelector('[aria-label="Use Regular Expression"]');
    regexBtn.click();
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = '*.ts';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'searchFiles', glob: '*.ts' });
    vi.useRealTimers();
  });

  it('passes glob to ripgrep without normalization (no *text* wrapping)', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    // Deactivate regex toggle
    const container = bar.el.querySelector('.search-filter-container');
    const regexBtn = container.querySelector('[aria-label="Use Regular Expression"]');
    regexBtn.click();
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = 'api';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    // Should pass 'api' as-is, not '*api*'
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'searchFiles', glob: 'api' });
    vi.useRealTimers();
  });

  it('clears fileFilterFn on filter clear button', () => {
    vi.useFakeTimers();
    const { bar, state } = makeSearchBarForFilter(false);
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = 'api';
    includeInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(state.fileFilterFn).toBeInstanceOf(Function);
    // Clear via the filter's own clear button
    const filterClearBtn = bar.el.querySelector('.search-filter-container .search-toggle[title="Clear File Filter"]');
    filterClearBtn.click();
    expect(state.fileFilterFn).toBeNull();
    vi.useRealTimers();
  });

  it('does not send glob to ripgrep when regex is on with content search', () => {
    vi.useFakeTimers();
    const { bar, vscode, state } = makeSearchBarForFilter(false);
    // Regex is on by default — type in both inputs
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    const includeInput = bar.el.querySelector('.search-filter-input') as HTMLInputElement;
    includeInput.value = 'api|auth';
    mainInput.value = 'fetchUser';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    // Should send content search WITHOUT include (regex is client-side)
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'search',
      pattern: 'fetchUser',
      include: undefined,
    }));
    expect(state.fileFilterFn).toBeInstanceOf(Function);
    vi.useRealTimers();
  });

  it('main input always does content search even with glob chars', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    // Disable regex so glob-like patterns are sent as literal text to ripgrep.
    const regexBtn = bar.el.querySelector('[aria-label="Use Regular Expression"]') as HTMLButtonElement;
    regexBtn.click(); // toggle regex off (on by default)
    mainInput.value = '*.ts';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'search',
      pattern: '*.ts',
    }));
    vi.useRealTimers();
  });

  it('shows regex-error on main input for invalid regex', () => {
    vi.useFakeTimers();
    const { bar, vscode } = makeSearchBarForFilter(false);
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    const inputContainer = bar.el.querySelector('.search-input-container') as HTMLElement;
    // Regex is on by default; type an invalid regex
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

  it('clears regex-error when regex mode is toggled off', () => {
    vi.useFakeTimers();
    const { bar } = makeSearchBarForFilter(false);
    const mainInput = bar.el.querySelector('.search-main-input') as HTMLInputElement;
    const inputContainer = bar.el.querySelector('.search-input-container') as HTMLElement;
    // Regex is on by default — enter invalid regex
    mainInput.value = '[invalid';
    mainInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(inputContainer.classList.contains('regex-error')).toBe(true);
    // Toggle regex off — error should clear
    const regexBtns = bar.el.querySelectorAll('[aria-label="Use Regular Expression"]');
    (regexBtns[0] as HTMLButtonElement).click();
    expect(inputContainer.classList.contains('regex-error')).toBe(false);
    vi.useRealTimers();
  });

  it('content search regex is enabled by default', () => {
    const { bar } = makeSearchBarForFilter(false);
    const regexBtns = bar.el.querySelectorAll('[aria-label="Use Regular Expression"]');
    // First regex button is for content search, should be active by default
    expect(regexBtns[0].classList.contains('active')).toBe(true);
  });
});
