// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  const scanBar = S.createScanBar();
  const tooltip = S.createTooltip();
  const state = S.createState();

  const renderer = S.createRenderer(state, {
    vscode,
    root,
    tooltip,
    options: {
      skipDepthZeroGuides: true,
      hideCounts: true,
      barFactor: 0.4,
      barMaxWidth: 200,
      barFallbackWidth: 300,
    },
    onExpandChanged: (hasAny) => vscode.postMessage({ command: 'expandChanged', hasAny }),
  });

  function render(roots, autoRescanEnabled, sortMode) {
    state.lastRoots = roots;
    state.lastAutoRescanEnabled = autoRescanEnabled;
    state.currentSortMode = sortMode || 'files';

    root.innerHTML = '';

    if (!autoRescanEnabled) {
      const warn = document.createElement('div');
      warn.className = 'rescan-warning';
      warn.innerHTML = `
        <span class="rescan-warning-icon">${S.SVG_WARNING}</span>
        <span>Auto-rescan disabled (large repo)</span>
        <button class="rescan-btn" id="manual-refresh">Refresh</button>
      `;
      warn.querySelector('#manual-refresh').addEventListener('click', () => {
        vscode.postMessage({ command: 'refresh' });
      });
      root.appendChild(warn);
    }

    if (!roots || roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No workspace folder open.';
      root.appendChild(empty);
      return;
    }

    S.pruneDrillStack(state);
    const maxMetric = S.computeMaxMetric(S.getDrillRoots(state), state.currentSortMode);
    const clientWidth = root.clientWidth;

    const treeEl = document.createElement('ul');
    treeEl.className = 'tree sidebar' + (state.currentSortMode === 'size' ? ' sort-size' : '');
    S.renderRoots(renderer, state, treeEl, maxMetric, clientWidth);
    root.appendChild(treeEl);
  }

  state.render = render;

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'scanning':
        scanBar.show(true);
        break;
      case 'loading':
        scanBar.show(false);
        root.innerHTML = '<div class="loading">Scanning workspace…</div>';
        break;
      case 'update':
        if (typeof message.truncateThreshold === 'number') {
          if (message.truncateThreshold !== state.truncateThreshold) {
            state.truncationExpanded.clear();
            state.emptyGroupExpanded.clear();
          }
          state.truncateThreshold = message.truncateThreshold;
        }
        requestAnimationFrame(() => {
          render(message.roots, message.autoRescanEnabled, message.sortMode);
          scanBar.show(false);
          vscode.postMessage({ command: 'expandChanged', hasAny: [...state.expanded.values()].some(v => v) });
        });
        break;
      case 'filter': {
        const hadFilters = state.activeFilters.size > 0;
        state.activeFilters = new Set(message.langs || []);
        if (!hadFilters && state.activeFilters.size > 0) { state.expanded.clear(); }
        if (state.lastRoots) {
          render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
        }
        if (state.activeFilters.size > 0) {
          vscode.postMessage({ command: 'expandChanged', hasAny: true });
        }
        break;
      }
      case 'expandAll':
        if (state.lastRoots) {
          S.walkExpand(state, S.getDrillRoots(state));
          render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
        }
        break;
      case 'collapseAll':
        if (state.lastRoots) {
          S.walkCollapse(state, S.getDrillRoots(state));
          state.truncationExpanded.clear();
          state.emptyGroupExpanded.clear();
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
