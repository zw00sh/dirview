// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  const legendSection = document.getElementById('legend-section');
  const legendHeader = document.getElementById('legend-header');
  const legendChevron = document.getElementById('legend-chevron');
  const legendEl = document.getElementById('legend');
  const root = document.getElementById('root');
  const tabTitleEl = document.getElementById('tab-title');
  const sortBtn = document.getElementById('tab-sort');
  const toggleIgnoredBtn = document.getElementById('tab-toggle-ignored');
  const toggleTruncationBtn = document.getElementById('tab-toggle-truncation');
  const expandCollapseBtn = document.getElementById('tab-expand-collapse');

  const scanBar = S.createScanBar();
  const tooltip = S.createTooltip();
  const state = S.createState();

  const renderer = S.createRenderer(state, {
    vscode,
    root,
    tooltip,
    options: {
      skipDepthZeroGuides: false,
      barFactor: 0.35,
      barMaxWidth: 400,
      barFallbackWidth: 600,
      barMinWidth: 24,
      barSqrt: true,
    },
    onExpandChanged: (hasAny) => {
      allExpanded = hasAny;
      updateExpandCollapseBtn();
    },
  });

  let currentShowIgnored = false;
  let currentTruncationEnabled = true;
  let allExpanded = false;

  // Tab-local truncation defaults (match config defaults)
  state.truncateThreshold = 4;
  let legendCollapsed = false;

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

  function updateExpandCollapseBtn() {
    expandCollapseBtn.innerHTML = allExpanded ? S.SVG_COLLAPSE_ALL : S.SVG_EXPAND_ALL;
    expandCollapseBtn.title = allExpanded ? 'Collapse All' : 'Expand All';
    expandCollapseBtn.setAttribute('aria-label', expandCollapseBtn.title);
  }

  updateToggleIgnoredBtn();
  updateTruncationBtn();
  updateExpandCollapseBtn();

  // ── Toolbar event listeners ─────────────────────────────────────────────

  toggleTruncationBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'toggleTruncation', enabled: !currentTruncationEnabled });
  });
  sortBtn.addEventListener('click', () => {
    if (!state.lastRoots) { return; }
    const modes = ['files', 'name', 'size'];
    const next = modes[(modes.indexOf(state.currentSortMode) + 1) % modes.length];
    render(state.lastRoots, state.lastAutoRescanEnabled, next);
  });
  toggleIgnoredBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'toggleIgnored', show: !currentShowIgnored });
  });
  expandCollapseBtn.addEventListener('click', () => {
    if (!state.lastRoots) { return; }
    if (!allExpanded) {
      S.walkExpand(state, S.getDrillRoots(state));
      allExpanded = true;
    } else {
      S.walkCollapse(state, S.getDrillRoots(state));
      state.truncationExpanded.clear();
      state.emptyGroupExpanded.clear();
      allExpanded = false;
    }
    updateExpandCollapseBtn();
    render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
  });
  legendHeader.addEventListener('click', () => {
    legendCollapsed = !legendCollapsed;
    legendEl.style.display = legendCollapsed ? 'none' : '';
    legendChevron.style.transform = legendCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  });

  // ── Legend ──────────────────────────────────────────────────────────────

  function toggleFilter(langName) {
    const hadFilters = state.activeFilters.size > 0;
    if (state.activeFilters.has(langName)) { state.activeFilters.delete(langName); }
    else { state.activeFilters.add(langName); }
    if (!hadFilters && state.activeFilters.size > 0) {
      state.expanded.clear();
      allExpanded = true;
      updateExpandCollapseBtn();
    }
    vscode.postMessage({ command: 'filter', langs: [...state.activeFilters] });
    render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
  }

  function updateLegend(stats) {
    if (!stats || stats.length === 0) {
      legendSection.style.display = 'none';
      return;
    }
    legendSection.style.display = '';
    legendEl.style.display = legendCollapsed ? 'none' : '';
    S.renderLegend(legendEl, stats, state.activeFilters, toggleFilter);
  }

  // ── Tree ────────────────────────────────────────────────────────────────

  function render(roots, autoRescanEnabled, sortMode) {
    state.lastRoots = roots;
    state.lastAutoRescanEnabled = autoRescanEnabled;
    state.currentSortMode = sortMode || 'files';

    const sortNames = { files: 'by files', name: 'by name', size: 'by size' };
    sortBtn.title = 'Sort: ' + (sortNames[state.currentSortMode] || 'by files');
    sortBtn.setAttribute('aria-label', sortBtn.title);
    const titleLabels = { files: 'count', name: 'name', size: 'size' };
    tabTitleEl.textContent = 'Tree (' + (titleLabels[state.currentSortMode] || 'count') + ')';

    S.pruneDrillStack(state);
    updateLegend(roots ? S.computeStats(S.getDrillRoots(state)) : []);

    root.innerHTML = '';

    if (!autoRescanEnabled) {
      const warn = document.createElement('div');
      warn.className = 'rescan-warning';
      warn.innerHTML = `
        <span class="rescan-warning-icon">${S.SVG_WARNING}</span>
        <span>Auto-rescan disabled (large repo)</span>
        <button class="rescan-btn" id="warn-refresh">Refresh</button>
      `;
      warn.querySelector('#warn-refresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
      root.appendChild(warn);
    }

    if (!roots || roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No workspace folder open.';
      root.appendChild(empty);
      return;
    }

    const maxMetric = S.computeMaxMetric(S.getDrillRoots(state), state.currentSortMode);
    const clientWidth = root.clientWidth;

    const treeEl = document.createElement('ul');
    treeEl.className = 'tree' + (state.currentSortMode === 'size' ? ' sort-size' : '');
    S.renderRoots(renderer, state, treeEl, maxMetric, clientWidth);
    root.appendChild(treeEl);
  }

  state.render = render;

  // ── Message handler ─────────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'scanning':
        scanBar.show(true);
        break;
      case 'loading':
        scanBar.show(false);
        legendSection.style.display = 'none';
        root.innerHTML = '<div class="loading">Scanning workspace…</div>';
        break;
      case 'update':
        currentShowIgnored = message.showIgnored || false;
        updateToggleIgnoredBtn();
        requestAnimationFrame(() => {
          render(message.roots, message.autoRescanEnabled, state.currentSortMode || 'files');
          scanBar.show(false);
          allExpanded = [...state.expanded.values()].some(v => v);
          updateExpandCollapseBtn();
        });
        break;
      case 'updateTruncation': {
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
        if (state.lastRoots) { render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode); }
        break;
      }
      case 'filter': {
        const hadFilters = state.activeFilters.size > 0;
        state.activeFilters = new Set(message.langs || []);
        if (!hadFilters && state.activeFilters.size > 0) {
          state.expanded.clear();
          allExpanded = true;
          updateExpandCollapseBtn();
        }
        if (state.lastRoots) { render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode); }
        break;
      }
      case 'expandAll':
        if (state.lastRoots) {
          S.walkExpand(state, S.getDrillRoots(state));
          allExpanded = true;
          updateExpandCollapseBtn();
          render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
        }
        break;
      case 'collapseAll':
        if (state.lastRoots) {
          S.walkCollapse(state, S.getDrillRoots(state));
          state.truncationExpanded.clear();
          state.emptyGroupExpanded.clear();
          allExpanded = false;
          updateExpandCollapseBtn();
          render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
        }
        break;
      case 'error':
        scanBar.show(false);
        root.innerHTML = `<div class="error">Error: ${S.escHtml(message.message)}</div>`;
        break;
    }
  });

  root.innerHTML = '<div class="loading">Initializing…</div>';
  scanBar.show(true);
})();
