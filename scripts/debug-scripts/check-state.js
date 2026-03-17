// Check current tab state: header, breadcrumb, viewport, row counts.
// Usage: npm run debug-eval -- tab scripts/debug-scripts/check-state.js
(() => {
  const hdr = document.getElementById('tree-header-title');
  const bc = document.getElementById('tree-header-breadcrumb');
  const treeEl = document.getElementById('root');
  const rowTypes = {};
  const allRows = treeEl?.querySelectorAll('[class*="-row"]') || [];
  for (const r of allRows) {
    for (const cls of r.classList) {
      if (cls.endsWith('-row')) rowTypes[cls] = (rowTypes[cls] || 0) + 1;
    }
  }
  return JSON.stringify({
    header: hdr?.textContent,
    breadcrumb: bc?.textContent?.trim(),
    viewportHeight: treeEl?.clientHeight,
    rowTypes,
  }, null, 2);
})()
