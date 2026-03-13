// @ts-check
(function () {
  const S = window.DirviewShared;
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  // Minimal state — the search fold does not manage tree state.
  // Status is driven by searchStatus messages from the host.
  const state = {
    searchResults: null,
    searchActive: false,
    searchTruncated: false,
    searchFileCount: 0,
    searchMatchCount: 0,
    searchBar_updateStatus: null,
  };

  const searchBar = S.createSearchBar(state, vscode, { standalone: true });
  root.appendChild(searchBar.el);

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'searchStatus') {
      searchBar.setStatus(message);
    } else if (message.type === 'focus') {
      searchBar.focus();
    } else if (message.type === 'filterActive') {
      searchBar.updateFilterWarning(message.active);
    }
  });
})();
