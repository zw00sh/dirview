// List all visible directory names in the tab view.
// Usage: npm run debug-eval -- tab scripts/debug-scripts/list-visible-dirs.js
(() => {
  const rows = document.querySelectorAll('.dir-row');
  const names = [];
  for (const row of rows) {
    const nameEl = row.querySelector('.dir-name');
    if (nameEl) names.push(nameEl.textContent);
  }
  return JSON.stringify(names);
})()
