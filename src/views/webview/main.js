// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  /* @DEV_START */
  if (S.setupDebugEval) { S.setupDebugEval(vscode); }
  /* @DEV_END */
  const root = document.getElementById('root');

  const scanBar = S.createScanBar();
  const tooltip = S.createTooltip();
  const state = S.createState();
  state.scanBar = scanBar;

  // Set up sticky tracking for the sidebar (before render so updateStuck is available).
  const { updateStuck, setEnabled: setStickyEnabled } = S.setupStickyTracking(document.documentElement);

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
    updateStuck();
  }

  state.render = render;

  const sharedMsgHandler = S.createMessageHandler(state, scanBar, root, {
    vscode,
    render,
    onBeforeUpdate: (message) => {
      if (typeof message.truncateThreshold === 'number') {
        if (message.truncateThreshold !== state.truncateThreshold) {
          state.truncationExpanded.clear();
          state.emptyGroupExpanded.clear();
        }
        state.truncateThreshold = message.truncateThreshold;
      }
      if (typeof message.stickyHeadersEnabled === 'boolean') {
        setStickyEnabled(message.stickyHeadersEnabled);
      }
    },
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'updateStickyHeaders') {
      setStickyEnabled(message.enabled);
      return;
    }
    sharedMsgHandler(event);
  });

  root.innerHTML = '<div class="loading">Initializing…</div>';
  scanBar.show(true);
})();
