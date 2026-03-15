// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  /* @DEV_START */
  if (S.setupDebugEval) { S.setupDebugEval(vscode); }
  /* @DEV_END */
  const legendSection = document.getElementById('legend-section');
  const legendHeader = document.getElementById('legend-header');
  const legendChevron = document.getElementById('legend-chevron');
  const legendDisplayToggle = document.getElementById('legend-display-toggle');
  const legendEl = document.getElementById('legend');
  const searchSection = document.getElementById('search-section');
  const searchHeaderEl = document.getElementById('search-header');
  const searchChevronEl = document.getElementById('search-chevron');
  const searchContentEl = document.getElementById('search-content');
  const root = document.getElementById('root');
  const sortBtn = document.getElementById('tab-sort');
  const toggleIgnoredBtn = document.getElementById('tab-toggle-ignored');
  const toggleTruncationBtn = document.getElementById('tab-toggle-truncation');
  const expandAllBtn = document.getElementById('tab-expand-all');
  const collapseAllBtn = document.getElementById('tab-collapse-all');
  const toggleStickyBtn = document.getElementById('tab-toggle-sticky');

  const scanBar = S.createScanBar();
  const tooltip = S.createTooltip();
  const state = S.createState();
  state.scanBar = scanBar;

  // Mount search bar inside the collapsible search section.
  const searchBar = S.createSearchBar(state, vscode);
  searchContentEl.appendChild(searchBar.el);

  let searchCollapsed = false;
  // Initialise chevron to match expanded state (chevron rotated 90° = expanded).
  searchChevronEl.style.transform = 'rotate(90deg)';

  const renderer = S.createRenderer(state, {
    vscode,
    root,
    tooltip,
    options: {
      skipDepthZeroGuides: false,
      hideRootBar: true,
      barFactor: 0.35,
      barMaxWidth: 400,
      barFallbackWidth: 600,
      barMinWidth: 24,
      barSqrt: true,
    },
    // Navigate to directory when its name is clicked in the tab tree.
    onNavigate: (path) => vscode.postMessage({ command: 'navigateToDir', path }),
  });

  let currentShowIgnored = false;
  let currentTruncationEnabled = true;
  // The directory path this tab is rooted at ('' = workspace root).
  state.dirPath = '';
  // Workspace folder name used by ancestor path context menus.
  state.workspaceFolderName = '';

  // Tab-local truncation defaults (match config defaults)
  state.truncateThreshold = 4;
  let legendCollapsed = false;
  let legendShowPct = false;

  // SVG icons for the legend display toggle — typographic % and # glyphs, matching sidebar title bar icons
  const SVG_PCT = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><text x="8" y="12.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif" font-weight="600" font-size="13" fill="currentColor">%</text></svg>';
  const SVG_HASH = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><text x="8" y="12.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif" font-weight="600" font-size="13" fill="currentColor">#</text></svg>';

  // ── Toolbar button helpers ──────────────────────────────────────────────

  function updateToggleIgnoredBtn() {
    toggleIgnoredBtn.innerHTML = currentShowIgnored ? S.SVG_EYE_CLOSED : S.SVG_EYE;
    toggleIgnoredBtn.title = currentShowIgnored ? 'Hide Ignored Files' : 'Show Ignored Files';
    toggleIgnoredBtn.setAttribute('aria-label', toggleIgnoredBtn.title);
  }

  function updateTruncationBtn() {
    toggleTruncationBtn.innerHTML = currentTruncationEnabled ? S.SVG_FOLD : S.SVG_UNFOLD;
    toggleTruncationBtn.title = currentTruncationEnabled ? 'Disable File Truncation' : 'Enable File Truncation';
    toggleTruncationBtn.setAttribute('aria-label', toggleTruncationBtn.title);
  }

  let currentStickyEnabled = true;

  function updateStickyBtn() {
    toggleStickyBtn.innerHTML = currentStickyEnabled ? S.SVG_STICKY : S.SVG_STICKY_OFF;
    toggleStickyBtn.title = currentStickyEnabled ? 'Disable Sticky Headers' : 'Enable Sticky Headers';
    toggleStickyBtn.setAttribute('aria-label', toggleStickyBtn.title);
  }

  // Set up sticky tracking — returns {updateStuck, setEnabled} for toggling sticky headers.
  const { updateStuck: _updateStuck, setEnabled: setStickyEnabled } = S.setupStickyTracking(root);

  updateToggleIgnoredBtn();
  updateTruncationBtn();
  updateStickyBtn();

  // ── Toolbar event listeners ─────────────────────────────────────────────

  toggleTruncationBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'toggleTruncation', enabled: !currentTruncationEnabled });
  });
  sortBtn.addEventListener('click', () => {
    if (!state.lastRoots) { return; }
    const modes = ['files', 'name', 'size'];
    const next = modes[(modes.indexOf(state.currentSortMode) + 1) % modes.length];
    state.currentSortMode = next;
    const sortNames = { files: 'by file count', name: 'by name', size: 'by size' };
    sortBtn.title = 'Sort: ' + (sortNames[next] || 'by file count');
    sortBtn.setAttribute('aria-label', sortBtn.title);
    sortBtn.innerHTML = { files: S.SVG_SORT_FILES, name: S.SVG_SORT_NAME, size: S.SVG_SORT_SIZE }[next] || S.SVG_SORT_FILES;
    state.rerender();
  });
  toggleIgnoredBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'toggleIgnored', show: !currentShowIgnored });
  });
  expandAllBtn.addEventListener('click', () => {
    if (!state.lastRoots) { return; }
    S.tieredExpandAll(state, state.lastRoots);
    // tieredExpandAll clears matchesCollapsed.
    state.rerender();
  });
  collapseAllBtn.addEventListener('click', () => {
    if (!state.lastRoots) { return; }
    S.tieredCollapseAll(state, state.lastRoots);
    state.truncationExpanded.clear();
    state.emptyGroupExpanded.clear();
    // tieredCollapseAll populates matchesCollapsed when search is active.
    state.rerender();
  });
  toggleStickyBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'toggleStickyHeaders', enabled: !currentStickyEnabled });
  });
  legendHeader.addEventListener('click', () => {
    legendCollapsed = !legendCollapsed;
    legendEl.style.display = legendCollapsed ? 'none' : '';
    legendChevron.style.transform = legendCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  });
  searchHeaderEl.addEventListener('click', () => {
    searchCollapsed = !searchCollapsed;
    searchContentEl.style.display = searchCollapsed ? 'none' : '';
    searchChevronEl.style.transform = searchCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  });
  legendDisplayToggle.addEventListener('click', (e) => {
    e.stopPropagation(); // Don't collapse the legend section when clicking the toggle
    legendShowPct = !legendShowPct;
    legendDisplayToggle.innerHTML = legendShowPct ? SVG_HASH : SVG_PCT;
    legendDisplayToggle.title = legendShowPct ? 'Show counts' : 'Show percentages';
    legendDisplayToggle.setAttribute('aria-label', legendDisplayToggle.title);
    if (state.lastRoots) {
      updateLegend(S.computeStats(state.lastRoots));
    }
  });

  // ── Legend ──────────────────────────────────────────────────────────────

  function toggleFilter(langName) {
    if (state.activeFilters.has(langName)) { state.activeFilters.delete(langName); }
    else { state.activeFilters.add(langName); }
    if (state.activeFilters.size > 0) {
      state.expanded.clear();
    }
    vscode.postMessage({ command: 'filter', langs: [...state.activeFilters] });
    searchBar.updateFilterWarning(state.activeFilters.size > 0);
    state.rerender();
  }

  function updateLegend(stats) {
    if (!stats || stats.length === 0) {
      legendSection.style.display = 'none';
      return;
    }
    legendSection.style.display = '';
    legendEl.style.display = legendCollapsed ? 'none' : '';
    S.renderLegend(legendEl, stats, state.activeFilters, toggleFilter, legendShowPct);
  }

  // ── Tree ────────────────────────────────────────────────────────────────

  function render(roots, autoRescanEnabled, sortMode) {
    state.lastRoots = roots;
    state.lastAutoRescanEnabled = autoRescanEnabled;
    state.currentSortMode = sortMode || 'files';

    const sortNames = { files: 'by file count', name: 'by name', size: 'by size' };
    sortBtn.title = 'Sort: ' + (sortNames[state.currentSortMode] || 'by file count');
    sortBtn.setAttribute('aria-label', sortBtn.title);
    sortBtn.innerHTML = { files: S.SVG_SORT_FILES, name: S.SVG_SORT_NAME, size: S.SVG_SORT_SIZE }[state.currentSortMode] || S.SVG_SORT_FILES;

    updateLegend(roots ? S.computeStats(state.lastRoots) : []);
    searchBar.updateFilterWarning(state.activeFilters.size > 0);

    // Remove one-time placeholders (loading/initializing) without wiping the
    // whole container — preserves any existing tree for incremental patching.
    root.querySelector('.loading')?.remove();

    // Manage the rescan-warning banner in place rather than clearing root.
    const existingWarn = root.querySelector('.rescan-warning');
    if (!autoRescanEnabled && !existingWarn) {
      root.insertBefore(S.createRescanWarning(vscode), root.firstChild);
    } else if (autoRescanEnabled && existingWarn) {
      existingWarn.remove();
    }

    if (!roots || roots.length === 0) {
      root.querySelector('ul.tree')?.remove();
      if (!root.querySelector('.empty')) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No workspace folder open.';
        root.appendChild(empty);
      }
      return;
    }

    root.querySelector('.empty')?.remove();
    S.renderTree(state, renderer, root, { showRootNode: true });
    _updateStuck();
  }

  state.render = render;

  // ── Message handler ─────────────────────────────────────────────────────

  const sharedHandler = S.createMessageHandler(state, scanBar, root, {
    vscode,
    render,
    resolveUpdateSortMode: () => state.currentSortMode || 'files',
    onBeforeUpdate: (message) => {
      currentShowIgnored = message.showIgnored || false;
      updateToggleIgnoredBtn();
      if (typeof message.dirPath === 'string') { state.dirPath = message.dirPath; }
      if (typeof message.workspaceFolderName === 'string') { state.workspaceFolderName = message.workspaceFolderName; }
      if (typeof message.stickyHeadersEnabled === 'boolean') {
        currentStickyEnabled = message.stickyHeadersEnabled;
        updateStickyBtn();
        setStickyEnabled(message.stickyHeadersEnabled);
      }
    },
    onLoading: () => {
      legendSection.style.display = 'none';
    },
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'updateStickyHeaders') {
      currentStickyEnabled = message.enabled;
      updateStickyBtn();
      setStickyEnabled(message.enabled);
      return;
    }
    if (message.type === 'updateTruncation') {
      const newThreshold = message.truncateThreshold;
      if (typeof newThreshold === 'number' && newThreshold !== state.truncateThreshold) {
        state.truncationExpanded.clear();
        state.emptyGroupExpanded.clear();
      }
      if (typeof newThreshold === 'number') { state.truncateThreshold = newThreshold; }
      if (typeof message.truncationEnabled === 'boolean') {
        currentTruncationEnabled = message.truncationEnabled;
        updateTruncationBtn();
      }
      if (state.lastRoots) { state.rerender(); }
      return;
    }
    sharedHandler(event);
  });

  root.innerHTML = '<div class="loading">Initializing…</div>';
  scanBar.show(true);
})();
