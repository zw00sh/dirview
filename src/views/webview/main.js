// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  const scanBar = S.createScanBar();
  const tooltip = S.createTooltip();
  const state = S.createState();
  state.scanBar = scanBar;

  // Cmd+F in the tree fold: reveal and focus the search fold instead of showing an inline bar.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      vscode.postMessage({ command: 'focusSearch' });
    }
  });

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
  });

  function render(roots, autoRescanEnabled, sortMode) {
    state.lastRoots = roots;
    state.lastAutoRescanEnabled = autoRescanEnabled;
    state.currentSortMode = sortMode || 'files';

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
  }));

  root.innerHTML = '<div class="loading">Initializing…</div>';
  scanBar.show(true);
})();
