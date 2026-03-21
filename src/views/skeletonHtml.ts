// Static skeleton HTML for instant-paint loading placeholders.
// Embedded directly in the webview HTML so they're visible before JS loads.

const TREE_ROWS: [indent: number, labelW: number, barW: number][] = [
  [0, 28, 90], [1, 22, 70], [2, 18, 45], [2, 24, 35], [2, 15, 20],
  [1, 20, 55], [2, 26, 40], [2, 14, 25],
  [0, 32, 80], [1, 19, 50], [2, 22, 30], [2, 16, 15],
  [1, 25, 60], [2, 20, 35],
];

export const skeletonTreeHtml =
  `<div class="empty-state skeleton">${TREE_ROWS.map(([indent, labelW, barW]) =>
    `<div class="skeleton-row" style="padding-left:${indent * 16 + 4}px">` +
    `<span class="skeleton-label" style="width:${labelW}%"></span>` +
    `<span class="skeleton-spacer"></span>` +
    `<span class="skeleton-bar" style="width:${barW}%"></span>` +
    `</div>`
  ).join('')}</div>`;

const PILL_WIDTHS = [52, 38, 64, 30, 46, 56, 34, 48, 42, 60, 36, 50];

export const skeletonLegendHtml =
  `<div class="empty-state skeleton skeleton-legend"><div class="skeleton-pills">${PILL_WIDTHS.map(w =>
    `<span class="skeleton-pill">` +
    `<span class="skeleton-swatch"></span>` +
    `<span class="skeleton-pill-label" style="width:${w}px"></span>` +
    `</span>`
  ).join('')}</div></div>`;
