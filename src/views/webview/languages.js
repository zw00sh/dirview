// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  let activeFilters = new Set();
  let currentStats = [];

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
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'update') {
      currentStats = message.stats;
      if (message.activeFilters !== undefined) {
        activeFilters = new Set(message.activeFilters);
      }
      render();
    } else if (message.type === 'filter') {
      activeFilters = new Set(message.langs || []);
      render();
    }
  });

  root.innerHTML = '<div class="empty">Initializing…</div>';
})();
