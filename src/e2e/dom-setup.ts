// jsdom HTML skeleton for the tab webview.
// Sets document.body.innerHTML to the tab layout extracted from tabProvider.ts bodyHtml,
// and provides a mock acquireVsCodeApi wired to a callback.

export interface DomSetupOptions {
  /** Called when the webview calls vscode.postMessage(). */
  onPostMessage: (message: any) => void;
}

/** The tab body HTML extracted from tabProvider.ts getHtml() method. */
const TAB_BODY_HTML = `  <div id="legend-section" class="tab-legend-section" style="display:none">
    <div id="legend-header" class="tab-legend-header" tabindex="0" role="button" aria-expanded="true">
      <span id="legend-chevron" class="tab-legend-header-chevron"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M6.146 3.146a.5.5 0 0 0 0 .707l4.146 4.146-4.146 4.146a.5.5 0 0 0 .707.707l4.5-4.5a.5.5 0 0 0 0-.707l-4.5-4.5a.5.5 0 0 0-.707 0Z"/></svg></span>
      <span class="tab-legend-header-title">Languages</span>
      <span id="legend-active-alert" class="tab-legend-active-alert" title="Language filter is active" style="display:none"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.56 1h.88l6.54 12.26-.44.74H1.44l-.42-.74L7.56 1zm.44 1.7L2.43 13H13.57L8 2.7zM8.5 11v1h-1v-1h1zm-1-1V6h1v4h-1z"/></svg></span>
      <button id="legend-display-toggle" class="tab-action" style="margin-left:auto" title="Show percentages" aria-label="Show percentages"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><text x="8" y="12.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-weight="600" font-size="13" fill="currentColor">%</text></svg></button>
    </div>
    <div id="legend" class="tab-legend-wrap"></div>
  </div>
  <div id="search-section" class="tab-search-section">
    <div id="search-header" class="tab-search-header" tabindex="0" role="button" aria-expanded="true">
      <span id="search-chevron" class="tab-search-header-chevron"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M6.146 3.146a.5.5 0 0 0 0 .707l4.146 4.146-4.146 4.146a.5.5 0 0 0 .707.707l4.5-4.5a.5.5 0 0 0 0-.707l-4.5-4.5a.5.5 0 0 0-.707 0Z"/></svg></span>
      <span class="tab-search-header-title">Search</span>
      <span id="search-active-alert" class="tab-search-active-alert" title="Results are filtered by active search" style="display:none"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.56 1h.88l6.54 12.26-.44.74H1.44l-.42-.74L7.56 1zm.44 1.7L2.43 13H13.57L8 2.7zM8.5 11v1h-1v-1h1zm-1-1V6h1v4h-1z"/></svg></span>
    </div>
    <div id="search-content" class="tab-search-content"></div>
  </div>
  <div id="tree-section" class="tab-tree-section">
  <div id="tree-header" class="tab-tree-header">
    <span class="tab-tree-header-chevron"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M6.146 3.146a.5.5 0 0 0 0 .707l4.146 4.146-4.146 4.146a.5.5 0 0 0 .707.707l4.5-4.5a.5.5 0 0 0 0-.707l-4.5-4.5a.5.5 0 0 0-.707 0Z"/></svg></span>
    <span id="tree-header-breadcrumb" class="tab-tree-header-breadcrumb"></span>
    <div style="display:flex;align-items:center;gap:2px;margin-left:auto">
      <button class="tab-action tab-refresh-btn" id="tab-refresh" title="Refresh (auto-rescan disabled for large repo)" aria-label="Refresh" style="display:none"></button>
      <button class="tab-action" id="tab-sort" title="Sort: by file count" aria-label="Sort: by file count"></button>
      <button class="tab-action" id="tab-toggle-sticky" title="Disable Sticky Headers" aria-label="Disable Sticky Headers"></button>
      <button class="tab-action" id="tab-toggle-truncation" title="Disable File Truncation" aria-label="Disable File Truncation"></button>
      <button class="tab-action" id="tab-toggle-ignored" title="Show Ignored Files" aria-label="Show Ignored Files"></button>
      <button class="tab-action" id="tab-expand-all" title="Expand All" aria-label="Expand All"></button>
      <button class="tab-action" id="tab-collapse-all" title="Collapse All" aria-label="Collapse All"></button>
    </div>
  </div>
  <div id="root"></div>
  </div>`;

/**
 * Sets up the jsdom document with the tab HTML skeleton and a mock acquireVsCodeApi.
 * Returns the mock vscode API object for direct use.
 */
export function setupDom(options: DomSetupOptions) {
  document.body.innerHTML = TAB_BODY_HTML;
  document.body.className = 'tab-view vscode-dark';

  const root = document.getElementById('root')!;

  // Override dimensions — jsdom elements have 0 dimensions by default.
  Object.defineProperty(root, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(root, 'clientHeight', { value: 600, configurable: true });

  const vsCodeApi = {
    postMessage: (message: any) => options.onPostMessage(message),
    getState: () => null,
    setState: () => {},
  };

  (globalThis as any).acquireVsCodeApi = () => vsCodeApi;

  return { root, vsCodeApi };
}

/**
 * Tears down the DOM setup.
 */
export function teardownDom() {
  document.body.innerHTML = '';
  document.body.className = '';
  delete (globalThis as any).acquireVsCodeApi;
}
