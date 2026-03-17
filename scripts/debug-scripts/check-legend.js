// Check legend items: names, counts, and classes (active/inactive/zero-count).
// Usage: npm run debug-eval -- tab scripts/debug-scripts/check-legend.js
(() => {
  const items = document.querySelectorAll('.legend-item');
  const summary = [];
  for (const item of items) {
    summary.push({
      name: item.querySelector('.legend-name')?.textContent,
      count: item.querySelector('.legend-count')?.textContent,
      classes: item.className,
    });
  }
  return JSON.stringify({ total: items.length, items: summary }, null, 2);
})()
