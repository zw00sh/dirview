// Check row offsetHeight and test if baseline alignment causes the li vs row height mismatch
const result = (() => {
  const row = document.querySelector('.match-line-row');
  if (!row) return { err: 'no match-line-row' };
  const li = row.parentElement;

  // Direct height measurements
  const rowOffsetHeight = row.offsetHeight;
  const rowClientHeight = row.clientHeight;
  const rowScrollHeight = row.scrollHeight;
  const liOffsetHeight = li.offsetHeight;

  // Temporarily switch align-items to 'center' and re-measure li height
  const origAlign = row.style.alignItems;
  row.style.alignItems = 'center';
  const liHeightWithCenter = li.offsetHeight;
  row.style.alignItems = origAlign;

  // Also test with stretch
  row.style.alignItems = 'stretch';
  const liHeightWithStretch = li.offsetHeight;
  row.style.alignItems = origAlign;

  // Check the indent-guides element's offsetHeight
  const guides = row.querySelector('.indent-guides');
  const guidesOffsetHeight = guides ? guides.offsetHeight : null;

  // Check min-height in px on the row
  const rowCs = getComputedStyle(row);

  return {
    rowOffsetHeight,
    rowClientHeight,
    rowScrollHeight,
    liOffsetHeight,
    liHeightWithCenter,
    liHeightWithStretch,
    guidesOffsetHeight,
    rowMinHeight: rowCs.minHeight,
    rowHeight: rowCs.height,
  };
})();
JSON.stringify(result);
