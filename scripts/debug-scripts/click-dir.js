// Click a directory name to navigate into it. Set DIR_NAME before running.
// Usage: Write a wrapper script that sets DIR_NAME, or edit this directly.
//   e.g.: const DIR_NAME = 'crypto';
// npm run debug-eval -- tab scripts/debug-scripts/click-dir.js
(() => {
  const DIR_NAME = 'crypto'; // <-- change this
  const rows = document.querySelectorAll('.dir-row');
  for (const row of rows) {
    const nameEl = row.querySelector('.dir-name');
    if (nameEl && nameEl.textContent === DIR_NAME) {
      nameEl.click();
      break;
    }
  }
  return new Promise(r => setTimeout(r, 1500)).then(() => {
    const hdr = document.getElementById('tree-header-title');
    const bc = document.getElementById('tree-header-breadcrumb');
    return JSON.stringify({ header: hdr?.textContent, breadcrumb: bc?.textContent?.trim() });
  });
})()
