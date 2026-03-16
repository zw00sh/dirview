// Search bar UI and search-related tree utilities.

import * as Icons from './icons';
import { compactedPath } from './utils';
import { h } from './h';

import type { DirNode, FileNode, WebviewState, VsCodeApi, SearchBarOptions, SearchBarResult, SearchStatusData, SearchMatch } from './types';

/**
 * Creates the search bar UI.
 */
export function createSearchBar(state: WebviewState, vscode: VsCodeApi, options?: SearchBarOptions): SearchBarResult {
  const standalone = !!(options && options.standalone);

  // ── Main input row: input + toggle buttons inside a shared border ──────
  // This matches VSCode's native search panel (Aa, .*, and x inside the border).
  const mainInput = h('input', {
    type: 'text',
    className: 'search-main-input',
    placeholder: 'Search Text',
    attr: { 'aria-label': 'Search Text' },
  });

  // Case-sensitive toggle — reuses the "Aa" sort icon (same codicon)
  const caseBtn = h('button', {
    className: 'search-toggle',
    title: 'Case Sensitive',
    innerHTML: Icons.SVG_SORT_NAME,
    attr: { 'aria-label': 'Case Sensitive' },
  });
  let caseSensitive = false;

  // Regex mode toggle — enabled by default
  const regexBtn = h('button', {
    className: 'search-toggle active',
    title: 'Use Regular Expression',
    innerHTML: Icons.SVG_REGEX,
    attr: { 'aria-label': 'Use Regular Expression' },
  });
  let useRegex = true;

  // Clear button — only visible when there's a query, sits inside the container border
  const clearBtn = h('button', {
    className: 'search-toggle',
    title: 'Clear Search (Escape)',
    innerHTML: Icons.SVG_CLOSE,
    style: { display: 'none' },
    attr: { 'aria-label': 'Clear Search' },
  });

  const inputContainer = h('div', { className: 'search-input-container' },
    mainInput, caseBtn, regexBtn, clearBtn,
  );

  // ── Context lines — inline after the search input container ────────────
  // Matches VS Code Search Editor layout: [number input] [toggle], no text label.
  const contextInput = h('input', {
    type: 'number',
    min: '0',
    max: '10',
    value: '1',
    attr: { 'aria-label': 'Context lines' },
  });
  const contextInputWrap = h('div', { className: 'search-context-input-wrap' }, contextInput);

  const contextBtn = h('button', {
    className: 'search-toggle search-context-toggle active',
    title: 'Show Context Lines',
    innerHTML: Icons.SVG_CONTEXT_LINES,
    attr: { 'aria-label': 'Show Context Lines' },
  });
  let contextLinesEnabled = true;

  const inputRow = h('div', { className: 'search-input-row' },
    inputContainer, contextInputWrap, contextBtn,
  );

  // ── Files to include — label above input, matching VSCode native search ─
  const includeInput = h('input', {
    type: 'text',
    className: 'search-input search-filter-input',
    placeholder: 'e.g. src/.*\\.ts',
    attr: { 'aria-label': 'Find or filter files' },
  });

  // Language-filter pill — shown when legend filters are active, alerting the user that
  // search results are intersected with the language filter. Dismissable via x to clear all.
  const langPillText = h('span', { className: 'search-lang-pill-text' });
  const langPill = h('span', { className: 'search-lang-pill', style: { display: 'none' } },
    h('span', { className: 'search-lang-pill-icon', innerHTML: Icons.SVG_WARNING }),
    langPillText,
    h('button', {
      className: 'search-lang-pill-close',
      title: 'Clear language filters',
      innerHTML: Icons.SVG_CLOSE,
      attr: { 'aria-label': 'Clear language filters' },
      on: { click: (e: MouseEvent) => {
        e.stopPropagation();
        if (options && options.onClearLangFilter) { options.onClearLangFilter(); }
      } },
    }),
  );

  // Bordered container wrapping pill + input so they appear as one unified input field.
  const filterContainer = h('div', { className: 'search-filter-container' });

  // Dir-scope pill — shows the tab's root directory basename with a dismiss button.
  // Only created for non-standalone search bars (tabs), hidden when dirPath is ''.
  let dirPill: HTMLSpanElement | null = null;
  let dirPillText: HTMLSpanElement | null = null;
  if (!standalone) {
    dirPillText = h('span', { className: 'search-dir-pill-text' });
    dirPill = h('span', { className: 'search-dir-pill', style: { display: 'none' } },
      dirPillText,
      h('button', {
        className: 'search-dir-pill-close',
        title: 'Reset to workspace root',
        innerHTML: Icons.SVG_CLOSE,
        attr: { 'aria-label': 'Reset to workspace root' },
        on: { click: (e: MouseEvent) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'navigateToDir', path: '' });
        } },
      }),
    );
    filterContainer.appendChild(dirPill);
  }
  // Lang pill is inserted before the dir pill so it appears on the left.
  filterContainer.insertBefore(langPill, filterContainer.firstChild);
  filterContainer.appendChild(includeInput);

  // Regex toggle for file filter — inside the bordered container, matching the main input style.
  // When active: client-side regex filtering. When inactive: glob passed to ripgrep as-is.
  const includeRegexBtn = h('button', {
    className: 'search-toggle active',
    title: 'Use Regular Expression',
    innerHTML: Icons.SVG_REGEX,
    attr: { 'aria-label': 'Use Regular Expression' },
  });
  let includeUseRegex = true;
  filterContainer.appendChild(includeRegexBtn);

  // Clear button for the file filter input — last in the container, matching clearBtn order.
  const includeClearBtn = h('button', {
    className: 'search-toggle',
    title: 'Clear File Filter',
    innerHTML: Icons.SVG_CLOSE,
    style: { display: 'none' },
    attr: { 'aria-label': 'Clear File Filter' },
  });
  filterContainer.appendChild(includeClearBtn);

  const includeSection = h('div', { className: 'search-filter-section' },
    h('label', { className: 'search-filter-label', textContent: 'find or filter files' }),
    h('div', { className: 'search-filter-input-row' }, filterContainer),
  );

  // ── Status line ────────────────────────────────────────────────────────
  const statusEl = h('div', { className: 'search-status', style: { display: 'none' } });

  const el = h('div', { className: 'search-bar' },
    inputRow, includeSection, statusEl,
  );

  // ── State ──────────────────────────────────────────────────────────────
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Search history — two independent stacks (oldest → newest)
  const searchHistory: string[] = [];
  let searchHistoryIdx = -1;
  let searchSavedInput = '';
  const includeHistory: string[] = [];
  let includeHistoryIdx = -1;
  let includeSavedInput = '';
  const MAX_HISTORY = 50;

  function commitToHistory(history: string[], value: string): void {
    const v = value.trim();
    if (v && (history.length === 0 || history[history.length - 1] !== v)) {
      history.push(v);
      if (history.length > MAX_HISTORY) { history.shift(); }
    }
  }

  function navigateHistory(
    history: string[],
    index: number,
    saved: string,
    input: HTMLInputElement,
    direction: 'up' | 'down',
  ): { index: number; saved: string } {
    if (history.length === 0) { return { index, saved }; }
    if (direction === 'up') {
      if (index === -1) { saved = input.value; index = history.length - 1; }
      else if (index > 0) { index--; }
      input.value = history[index];
    } else {
      if (index === -1) { return { index, saved }; }
      if (index < history.length - 1) { index++; input.value = history[index]; }
      else { index = -1; input.value = ''; }
    }
    return { index, saved };
  }

  // Shared status text formatting — deduplicates updateStatus/setStatus logic.
  function formatSearchStatus(
    active: boolean,
    hasResults: boolean,
    resultCount: number,
    matchCount: number,
    fileCount: number,
    truncated: boolean,
  ): { text: string; visible: boolean } {
    if (active) {
      return { text: 'Searching\u2026', visible: true };
    }
    if (!hasResults) {
      return { text: '', visible: false };
    }
    if (resultCount === 0) {
      const q = mainInput.value.trim() || includeInput.value.trim();
      return { text: q ? 'No results' : '', visible: !!q };
    }
    const trunc = truncated ? ' (truncated)' : '';
    if (matchCount > 0) {
      return {
        text: `${matchCount} result${matchCount !== 1 ? 's' : ''} in ${fileCount} file${fileCount !== 1 ? 's' : ''}${trunc}`,
        visible: true,
      };
    }
    return {
      text: `${fileCount} file${fileCount !== 1 ? 's' : ''}${trunc}`,
      visible: true,
    };
  }

  // updateStatus reads from state (used in non-standalone/tab mode where createMessageHandler
  // keeps state.searchActive / state.searchResults / etc. up to date).
  function updateStatus(): void {
    const { text, visible } = formatSearchStatus(
      state.searchActive,
      state.searchResults !== null,
      state.searchResults ? state.searchResults.size : 0,
      state.searchMatchCount,
      state.searchFileCount,
      state.searchTruncated,
    );
    statusEl.textContent = text;
    statusEl.style.display = visible ? '' : 'none';
  }

  // setStatus is the externally-driven variant used by the standalone search fold.
  // Called with the searchStatus message data from the host (no state dependency).
  function setStatus(data: SearchStatusData): void {
    const { text, visible } = formatSearchStatus(
      !!data.active,
      !!data.matches,
      data.matches ? Object.keys(data.matches).length : 0,
      data.matchCount ?? 0,
      data.fileCount ?? 0,
      !!data.truncated,
    );
    statusEl.textContent = text;
    statusEl.style.display = visible ? '' : 'none';
  }

  // Wire state.searchBar_updateStatus so the message handler can call it (non-standalone only).
  if (!standalone) {
    state.searchBar_updateStatus = updateStatus;
  }

  // Validates regex patterns and updates the input container's error styling.
  // Returns false if the pattern is invalid (caller should abort the search).
  function validateRegex(pattern: string, isRegex: boolean, container: HTMLElement): boolean {
    if (!isRegex || !pattern) {
      container.classList.remove('regex-error');
      return true;
    }
    try {
      new RegExp(pattern);
      container.classList.remove('regex-error');
      return true;
    } catch (_) {
      container.classList.add('regex-error');
      return false;
    }
  }

  function triggerSearch(): void {
    const pattern = mainInput.value.trim();
    const fileFilter = includeInput.value.trim();

    clearBtn.style.display = pattern ? '' : 'none';
    includeClearBtn.style.display = fileFilter ? '' : 'none';

    if (!pattern && !fileFilter) {
      inputContainer.classList.remove('regex-error');
      filterContainer.classList.remove('regex-error');
      state.fileFilterFn = null;
      state.searchResultsVersion++;
      vscode.postMessage({ command: 'clearSearch' });
      return;
    }

    // Validate regex patterns — show error styling and abort if invalid.
    const mainValid = validateRegex(pattern, useRegex, inputContainer);
    const filterValid = validateRegex(fileFilter, includeUseRegex, filterContainer);
    if (!mainValid || !filterValid) { return; }

    const contextLines = contextLinesEnabled ? (parseInt(contextInput.value, 10) || 0) : 0;

    // File filter: regex mode uses client-side filtering; glob mode passes to ripgrep as-is.
    state.searchResultsVersion++;
    if (includeUseRegex && fileFilter) {
      // Client-side regex filtering — don't send to ripgrep.
      const re = new RegExp(fileFilter, 'i');
      state.fileFilterFn = (name: string) => re.test(name);
    } else {
      state.fileFilterFn = null;
    }

    // Glob mode: pass the filter to ripgrep as-is (no normalization).
    const glob = (!includeUseRegex && fileFilter) ? fileFilter : undefined;

    if (!pattern) {
      if (includeUseRegex) {
        // Regex file filter with no content query — client-side only, rerender tree.
        state.rerender();
      } else if (fileFilter) {
        // Glob file filter with no content query → ripgrep filename search.
        vscode.postMessage({ command: 'searchFiles', glob: glob! });
      }
    } else {
      // Content search, optionally scoped by file filter glob.
      vscode.postMessage({
        command: 'search',
        pattern,
        caseSensitive,
        useRegex,
        include: glob,
        contextLines: contextLines || undefined,
      });
      // If regex file filter is also active, rerender will apply it client-side
      // after search results arrive (via fileFilterFn in getVisibleFiles).
    }
  }

  function clearSearch(): void {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    mainInput.value = '';
    includeInput.value = '';
    clearBtn.style.display = 'none';
    includeClearBtn.style.display = 'none';
    statusEl.style.display = 'none';
    inputContainer.classList.remove('regex-error');
    filterContainer.classList.remove('regex-error');
    state.fileFilterFn = null;
    state.searchResultsVersion++;
    vscode.postMessage({ command: 'clearSearch' });
  }

  // ── Event listeners ────────────────────────────────────────────────────

  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle('active', caseSensitive);
    if (mainInput.value.trim() || includeInput.value.trim()) { triggerSearch(); }
  });

  regexBtn.addEventListener('click', () => {
    useRegex = !useRegex;
    regexBtn.classList.toggle('active', useRegex);
    if (!useRegex) { inputContainer.classList.remove('regex-error'); }
    if (mainInput.value.trim() || includeInput.value.trim()) { triggerSearch(); }
  });

  clearBtn.addEventListener('click', () => {
    mainInput.value = '';
    clearBtn.style.display = 'none';
    inputContainer.classList.remove('regex-error');
    if (debounceTimer) { clearTimeout(debounceTimer); }
    if (!includeInput.value.trim()) {
      // No filter either — full clear.
      statusEl.style.display = 'none';
      state.fileFilterFn = null;
      state.searchResultsVersion++;
      vscode.postMessage({ command: 'clearSearch' });
    } else {
      triggerSearch();
    }
  });

  includeClearBtn.addEventListener('click', () => {
    includeInput.value = '';
    includeClearBtn.style.display = 'none';
    filterContainer.classList.remove('regex-error');
    if (debounceTimer) { clearTimeout(debounceTimer); }
    state.fileFilterFn = null;
    if (!mainInput.value.trim()) {
      // No content query either — full clear.
      statusEl.style.display = 'none';
      state.searchResultsVersion++;
      vscode.postMessage({ command: 'clearSearch' });
    } else {
      triggerSearch();
    }
  });

  includeRegexBtn.addEventListener('click', () => {
    includeUseRegex = !includeUseRegex;
    includeRegexBtn.classList.toggle('active', includeUseRegex);
    if (!includeUseRegex) { filterContainer.classList.remove('regex-error'); }
    // Update placeholder to reflect the current mode (regex vs glob examples).
    includeInput.placeholder = document.activeElement === includeInput
      ? includeFocusPlaceholder() : includeBlurPlaceholder();
    if (mainInput.value.trim() || includeInput.value.trim()) { triggerSearch(); }
  });

  contextBtn.addEventListener('click', () => {
    contextLinesEnabled = !contextLinesEnabled;
    contextBtn.classList.toggle('active', contextLinesEnabled);
    if (mainInput.value.trim() || includeInput.value.trim()) { triggerSearch(); }
  });

  contextInput.addEventListener('input', () => {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    debounceTimer = setTimeout(triggerSearch, 300);
  });

  mainInput.addEventListener('input', () => {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    searchHistoryIdx = -1;
    clearBtn.style.display = mainInput.value ? '' : 'none';
    // Validate regex immediately (no debounce) so the error border appears instantly.
    validateRegex(mainInput.value.trim(), useRegex, inputContainer);
    if (!mainInput.value && !includeInput.value) {
      state.fileFilterFn = null;
      state.searchResultsVersion++;
      vscode.postMessage({ command: 'clearSearch' });
      return;
    }
    debounceTimer = setTimeout(triggerSearch, 300);
  });

  includeInput.addEventListener('input', () => {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    includeHistoryIdx = -1;
    includeClearBtn.style.display = includeInput.value ? '' : 'none';
    // Validate regex immediately (no debounce) so the error border appears instantly.
    validateRegex(includeInput.value.trim(), includeUseRegex, filterContainer);
    debounceTimer = setTimeout(triggerSearch, 300);
  });

  // Escape, Enter, and history navigation
  mainInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      mainInput.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitToHistory(searchHistory, mainInput.value);
      searchHistoryIdx = -1;
      if (debounceTimer) { clearTimeout(debounceTimer); }
      triggerSearch();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const r = navigateHistory(searchHistory, searchHistoryIdx, searchSavedInput, mainInput, e.key === 'ArrowUp' ? 'up' : 'down');
      searchHistoryIdx = r.index;
      searchSavedInput = r.saved;
      if (debounceTimer) { clearTimeout(debounceTimer); }
      clearBtn.style.display = mainInput.value ? '' : 'none';
      debounceTimer = setTimeout(triggerSearch, 300);
    }
  });

  includeInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      includeInput.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitToHistory(includeHistory, includeInput.value);
      includeHistoryIdx = -1;
      if (debounceTimer) { clearTimeout(debounceTimer); }
      triggerSearch();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const r = navigateHistory(includeHistory, includeHistoryIdx, includeSavedInput, includeInput, e.key === 'ArrowUp' ? 'up' : 'down');
      includeHistoryIdx = r.index;
      includeSavedInput = r.saved;
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(triggerSearch, 300);
    }
  });

  // Dynamic placeholders — hint at history when focused
  mainInput.addEventListener('focus', () => { mainInput.placeholder = 'Search Text (\u21C5 for history)'; });
  mainInput.addEventListener('blur', () => {
    commitToHistory(searchHistory, mainInput.value);
    searchHistoryIdx = -1;
    mainInput.placeholder = 'Search Text';
  });
  function includeBlurPlaceholder(): string {
    return includeUseRegex ? 'e.g. src/.*\\.ts' : 'e.g. *.ts, src/**';
  }
  function includeFocusPlaceholder(): string {
    return includeUseRegex
      ? 'e.g. src/.*\\.ts (\u21C5 for history)'
      : 'e.g. *.ts, src/** (\u21C5 for history)';
  }
  includeInput.addEventListener('focus', () => { includeInput.placeholder = includeFocusPlaceholder(); });
  includeInput.addEventListener('blur', () => {
    commitToHistory(includeHistory, includeInput.value);
    includeHistoryIdx = -1;
    includeInput.placeholder = includeBlurPlaceholder();
  });

  // Cmd+F / Ctrl+F — focus the search input from anywhere in the webview.
  // Not wired in standalone mode: the fold is focused via searchProvider.focusInput().
  if (!standalone) {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        mainInput.focus();
        mainInput.select();
      }
    });
  }

  function focus(): void { mainInput.focus(); mainInput.select(); }
  function show(): void { mainInput.focus(); }
  function hide(): void { clearSearch(); }

  function updateFilterWarning(count: number): void {
    if (!count) {
      langPill.style.display = 'none';
      return;
    }
    langPillText.textContent = count + ' language' + (count === 1 ? '' : 's');
    langPill.style.display = '';
  }

  /** Show/hide the directory-scope pill based on the tab's current root path. */
  function setDirPill(dirPath: string): void {
    if (!dirPill) { return; } // standalone mode — no pill
    if (!dirPath) {
      dirPill.style.display = 'none';
      return;
    }
    dirPillText!.textContent = 'in: ' + (dirPath.split('/').pop() || dirPath);
    dirPill.style.display = '';
  }

  function setHasRipgrep(available: boolean): void {
    // When ripgrep is unavailable, hide content search controls (main input, case/regex
    // toggles, context lines) but keep the file include filter functional.
    const hidden = !available;
    inputContainer.style.display = hidden ? 'none' : '';
    contextInputWrap.style.display = hidden ? 'none' : '';
    contextBtn.style.display = hidden ? 'none' : '';
  }

  return { el, focus, clear: clearSearch, show, hide, updateStatus, setStatus, updateFilterWarning, setDirPill, triggerSearch, setHasRipgrep };
}

// Updates search-result counters on state and triggers the search bar status display.
// Called by searchResults, searchResultsBatch, and searchResultsDone handlers.
export function updateSearchStatus(state: WebviewState, message: { fileCount?: number; matchCount?: number; truncated?: boolean }): void {
  state.searchFileCount = message.fileCount || 0;
  state.searchMatchCount = message.matchCount || 0;
  state.searchTruncated = message.truncated || false;
  if (state.searchBar_updateStatus) { state.searchBar_updateStatus(); }
}

// Schedules a throttled re-render after search results/highlight patches arrive.
// Coalesces rapid arrivals into at most one render per 300ms.
export function scheduleSearchRender(state: WebviewState): void {
  if (state.lastRoots && !state._searchRenderTimer) {
    state._searchRenderTimer = setTimeout(() => {
      state._searchRenderTimer = null;
      state.rerender();
    }, 300);
  }
}

// Builds a Set of all ancestor directory paths for the given file paths.
// When rootPaths is provided, strips the workspace root prefix so ancestor
// paths are workspace-relative (matching DirNode.path format).
// E.g. with rootPath '/ws', '/ws/src/lib/foo.ts' → adds 'src', 'src/lib'.
// Without rootPaths, produces absolute ancestors (legacy behaviour).
// Uses lastIndexOf chaining instead of split+join for performance.
export function buildAncestorPaths(filePaths: Iterable<string>, rootPaths?: string[]): Set<string> {
  const ancestors = new Set<string>();
  // Normalize rootPaths to forward slashes so Windows backslash paths match.
  const normalRoots = rootPaths?.map(r => r.replace(/\\/g, '/'));
  for (let filePath of filePaths) {
    // Normalize backslashes so ancestor paths use '/' to match DirNode.path format.
    filePath = filePath.replace(/\\/g, '/');
    // Strip workspace root prefix to produce relative paths matching DirNode.path.
    if (normalRoots) {
      for (const root of normalRoots) {
        if (filePath.startsWith(root + '/')) {
          filePath = filePath.slice(root.length + 1);
          break;
        }
      }
    }
    // Walk up from the last '/' to the root, adding each directory prefix.
    let end = filePath.lastIndexOf('/');
    while (end > 0) {
      const dir = filePath.slice(0, end);
      if (ancestors.has(dir)) break; // already added this and all its ancestors
      ancestors.add(dir);
      end = filePath.lastIndexOf('/', end - 1);
    }
  }
  return ancestors;
}

// Walks the tree and expands any directory that contains a file matching matchFn.
// If clearFirst is true, clears state.expanded before walking (full rebuild from scratch).
// If false, only adds to the existing expanded map (incremental batch update).
export function walkMatchingDirs(state: WebviewState, roots: DirNode[], matchFn: (f: FileNode) => boolean, clearFirst: boolean): void {
  if (clearFirst) { state.expanded.clear(); }
  function walk(node: DirNode): boolean {
    let hasMatch = false;
    for (const f of (node.files || [])) {
      if (matchFn(f)) { hasMatch = true; break; }
    }
    for (const child of (node.children || [])) {
      if (walk(child)) { hasMatch = true; }
    }
    if (hasMatch) { state.expanded.set(compactedPath(node), true); }
    return hasMatch;
  }
  for (const r of roots) { walk(r); }
}

// Expands ancestor dirs for a set of file paths.
// When no language filter is active, uses the fast ancestor path index (no tree walk).
// When language filters are active, falls back to tree walk to check per-file language.
export function expandBatchFiles(state: WebviewState, roots: DirNode[], newFilePaths: Set<string>): void {
  // Merge into the cumulative ancestor index for dirMatchesSearch.
  const ancestors = buildAncestorPaths(newFilePaths, state.searchRootPaths);
  if (!state.searchAncestorPaths) { state.searchAncestorPaths = new Set(); }
  for (const p of ancestors) { state.searchAncestorPaths.add(p); }

  if (state.activeFilters.size > 0) {
    // Language filter active — must check per-file language via tree walk.
    walkMatchingDirs(state, roots, (f: FileNode) =>
      newFilePaths.has(f.path) && state.activeFilters.has(f.langName),
      false);
  } else {
    // No filter — expand all ancestor dirs directly.
    for (const dirPath of ancestors) {
      state.expanded.set(dirPath, true);
    }
  }
}

// Pre-populates state.expanded so only directories containing search matches are expanded.
// Full rebuild from all results — used for non-streaming searchResults and clearSearch.
export function expandMatchedDirs(state: WebviewState, roots: DirNode[], searchResults: Map<string, SearchMatch[]>, activeFilters: Set<string>): void {
  // When language filters are active, we can't use the pure path-based index —
  // we need to check each file's language. Fall back to tree walk.
  if (activeFilters.size > 0) {
    walkMatchingDirs(state, roots, (f: FileNode) =>
      searchResults.has(f.path) && activeFilters.has(f.langName),
      true);
    return;
  }
  // No language filter — use the fast ancestor path index.
  state.expanded.clear();
  const ancestors = buildAncestorPaths(searchResults.keys(), state.searchRootPaths);
  state.searchAncestorPaths = ancestors;
  for (const dirPath of ancestors) {
    state.expanded.set(dirPath, true);
  }
}
