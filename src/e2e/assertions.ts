// Query helpers for E2E test assertions.
// These inspect the rendered DOM and webview state to extract visible elements.

import type { WebviewState, LangStat } from '../views/webview/types';

/** Returns the text content of all visible file rows in the tree. */
export function getVisibleFiles(root: HTMLElement): string[] {
  const fileRows = root.querySelectorAll('.file-row .file-name');
  return Array.from(fileRows).map(el => el.textContent || '');
}

/** Returns the text content of all visible directory rows in the tree. */
export function getVisibleDirs(root: HTMLElement): string[] {
  const dirRows = root.querySelectorAll('.dir-row .dir-name');
  return Array.from(dirRows).map(el => el.textContent || '');
}

/** Extracts legend stats from a rendered legend element. */
export function getLegendStats(legendEl: HTMLElement): Array<{ name: string; count: number }> {
  const items = legendEl.querySelectorAll('.legend-item');
  return Array.from(items).map(item => {
    const nameEl = item.querySelector('.legend-lang-name');
    const countEl = item.querySelector('.legend-count');
    const name = nameEl?.textContent?.trim() || '';
    // Parse count from text like "123" or "12.3%"
    const countText = countEl?.textContent?.trim() || '0';
    const count = parseInt(countText.replace(/[^\d]/g, ''), 10) || 0;
    return { name, count };
  });
}

/** Extracts search status from webview state. */
export function getSearchStatus(state: WebviewState): {
  fileCount: number;
  matchCount: number;
  truncated: boolean;
} {
  return {
    fileCount: state.searchFileCount,
    matchCount: state.searchMatchCount,
    truncated: state.searchTruncated,
  };
}
