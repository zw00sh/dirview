// Clear the search input and reset results.
// Usage: npm run debug-eval -- tab scripts/debug-scripts/clear-search.js
(() => {
  const mainInput = document.querySelector('.search-main-input');
  if (mainInput) {
    mainInput.value = '';
    mainInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return 'cleared';
})()
