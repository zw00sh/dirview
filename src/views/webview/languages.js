// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  /* @DEV_START */
  if (S.setupDebugEval) { S.setupDebugEval(vscode); }
  /* @DEV_END */
  const root = document.getElementById('root');
  const scanBar = S.createScanBar();

  let activeFilters = new Set();
  let currentStats = [];
  let showPct = false;

  function render() {
    root.innerHTML = '';
    if (!currentStats || currentStats.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No data yet.';
      root.appendChild(empty);
      return;
    }
    S.renderLegend(root, currentStats, activeFilters, (langName) => {
      if (activeFilters.has(langName)) { activeFilters.delete(langName); }
      else { activeFilters.add(langName); }
      vscode.postMessage({ command: 'filter', langs: [...activeFilters] });
      render();
    }, showPct);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'scanning') {
      scanBar.show(true);
      return;
    }
    if (message.type === 'update') {
      scanBar.show(false);
      currentStats = S.computeStats(message.roots || []);
      if (message.activeFilters !== undefined) {
        activeFilters = new Set(message.activeFilters);
      }
      if (message.showPct !== undefined) {
        showPct = message.showPct;
      }
      render();
    } else if (message.type === 'filter') {
      activeFilters = new Set(message.langs || []);
      render();
    } else if (message.type === 'setDisplayMode') {
      showPct = message.showPct;
      render();
    } else if (message.type === 'error') {
      scanBar.show(false);
      root.innerHTML = `<div class="empty">Error: ${S.escHtml(message.message)}</div>`;
    }
  });

  root.innerHTML = '<div class="empty">Initializing…</div>';
})();
