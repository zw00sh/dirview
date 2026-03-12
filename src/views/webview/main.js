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
      root.appendChild(S.createRescanWarning(vscode));
    }

    if (!roots || roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No workspace folder open.';
      root.appendChild(empty);
      return;
    }

    S.renderTree(state, renderer, root, { cssClass: 'sidebar' });
  }

  state.render = render;

  window.addEventListener('message', S.createMessageHandler(state, scanBar, root, {
    render,
    onBeforeUpdate: (message) => {
      if (typeof message.truncateThreshold === 'number') {
        if (message.truncateThreshold !== state.truncateThreshold) {
          state.truncationExpanded.clear();
          state.emptyGroupExpanded.clear();
        }
        state.truncateThreshold = message.truncateThreshold;
      }
    },
    onAfterRender: () => {
      vscode.postMessage({ command: 'expandChanged', hasAny: [...state.expanded.values()].some(v => v) });
    },
    onFilter: () => {
      if (state.activeFilters.size > 0) {
        vscode.postMessage({ command: 'expandChanged', hasAny: true });
      }
    },
  }));

  root.innerHTML = '<div class="loading">Initializing…</div>';
  scanBar.show(true);
})();
