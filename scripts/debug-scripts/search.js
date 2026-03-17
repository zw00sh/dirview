// Type a search query into the main search input and wait for results.
// Usage: npm run debug-eval -- tab scripts/debug-scripts/search.js
(() => {
  const QUERY = 'fn main'; // <-- change this
  const mainInput = document.querySelector('.search-main-input');
  if (mainInput) {
    mainInput.value = QUERY;
    mainInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return new Promise(r => setTimeout(r, 3000)).then(() => {
    const status = document.querySelector('.search-status-text');
    return JSON.stringify({ query: QUERY, status: status?.textContent });
  });
})()
