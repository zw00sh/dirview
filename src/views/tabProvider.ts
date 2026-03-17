import * as vscode from 'vscode';
import * as path from 'path';
import { Config } from '../config';
import { DirNode, ScanUpdatePayload } from '../scanner/types';
import { buildWebviewHtml } from './buildWebviewHtml';
import { handleCommonMessage, handleSearchMessage, post } from './providerUtils';
import { SearchService } from '../search/searchService';
import type { WebviewToBackendMessage } from './webview/types';

export class TabProvider {
  // Map from numeric panel ID → { panel, dirPath }.  Keyed by ID (not dirPath) so
  // multiple tabs can be open for the same directory when allowDuplicateTabs is true.
  private nextPanelId = 0;
  private panels: Map<number, { panel: vscode.WebviewPanel; dirPath: string }> = new Map();
  // Per-panel search service: independent search state per tab, keyed by panel ID.
  private searchServices: Map<number, SearchService> = new Map();
  private extensionUri: vscode.Uri;
  // Raw scan data, stored once and used to derive per-panel subtrees on demand.
  private lastPayload: ScanUpdatePayload | undefined;
  onRefresh: (() => void) | undefined;
  onOpenDirInTab: ((dirPath: string) => void) | undefined;

  private config: Config;
  /** Cached ripgrep probe result — resolved once on first tab creation. */
  private rgProbe: Promise<boolean> | undefined;
  private rgAvailable = false;

  constructor(extensionUri: vscode.Uri, config: Config) {
    this.extensionUri = extensionUri;
    this.config = config;
  }

  /** Probe ripgrep once and cache the result. Resets on failure so retries are possible. */
  private probeRipgrep(): Promise<boolean> {
    if (!this.rgProbe) {
      const svc = new SearchService(vscode.env.appRoot);
      this.rgProbe = svc.probe().then((ok) => { this.rgAvailable = ok; return ok; })
        .catch(() => { this.rgProbe = undefined; this.rgAvailable = false; return false; });
    }
    return this.rgProbe;
  }

  private findPanelId(panel: vscode.WebviewPanel): number | undefined {
    for (const [id, entry] of this.panels) {
      if (entry.panel === panel) return id;
    }
    return undefined;
  }

  private findInChildren(children: DirNode[], targetPath: string): DirNode | undefined {
    for (const child of children) {
      if (child.path === targetPath) return child;
      const found = this.findInChildren(child.children, targetPath);
      if (found) return found;
    }
    return undefined;
  }

  private findNodeByPath(roots: DirNode[], targetPath: string): DirNode | undefined {
    for (const root of roots) {
      if (root.path === targetPath) return root;
      const found = this.findInChildren(root.children, targetPath);
      if (found) return found;
    }
    return undefined;
  }

  /** Read enabled files.exclude patterns from VSCode config. */
  private getFilesExcludePatterns(): string[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return [];
    // Merge patterns from all workspace folders (deduped).
    const patterns = new Set<string>();
    for (const f of folders) {
      const config = vscode.workspace.getConfiguration('files', f.uri);
      const exclude = config.get<Record<string, boolean>>('exclude') ?? {};
      for (const [p, enabled] of Object.entries(exclude)) {
        if (enabled) patterns.add(p);
      }
    }
    return [...patterns];
  }

  /** Returns the tab title for a given dirPath.
   *  Root tabs use the workspace name; subtree tabs use the directory basename. */
  private getTabTitle(dirPath: string): string {
    if (dirPath === '') {
      return vscode.workspace.name || 'Breakdown';
    }
    return path.basename(dirPath);
  }

  /** Returns the workspace folder name that contains the given dirPath.
   *  For the workspace root tab (dirPath === ''), returns the single workspace
   *  folder name if there is exactly one, so the toolbar shows "source" instead
   *  of the "/" fallback. For multi-root workspaces at the root level, returns
   *  '' (the tab title will fall back to "/"). */
  private getWorkspaceFolderName(dirPath: string): string {
    const roots = this.lastPayload?.roots;
    if (!roots) { return ''; }
    if (dirPath === '') {
      return roots.length === 1 ? roots[0].name : '';
    }
    for (const root of roots) {
      if (dirPath === root.path || this.findInChildren(root.children, dirPath)) {
        return root.name;
      }
    }
    return roots.length === 1 ? roots[0].name : '';
  }

  /** Returns the roots to send to the panel for a given dirPath.
   *  For root (''), returns the full scan roots.
   *  For a directory path, returns [node] for just that subtree.
   *  Returns undefined if no scan data exists yet, or [] if the dir was deleted. */
  private getRootsForDir(dirPath: string): DirNode[] | undefined {
    const roots = this.lastPayload?.roots;
    if (!roots) { return undefined; }
    if (dirPath === '') { return roots; }
    const node = this.findNodeByPath(roots, dirPath);
    return node ? [node] : [];
  }

  /** Returns the rg root paths for a given dirPath.
   *  Root tabs search across all workspace folders; dir tabs are scoped to their subtree.
   *  dirPath is workspace-relative (e.g. 'src/scanner'), but ripgrep requires absolute paths. */
  private getRootPaths(dirPath: string): string[] {
    if (dirPath === '') {
      return vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
    }
    // Convert the workspace-relative dirPath to an absolute filesystem path.
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length > 0) {
      return [vscode.Uri.joinPath(folders[0].uri, dirPath).fsPath];
    }
    return [dirPath];
  }

  /** Builds a typed update message for a given dirPath, consolidating field defaults. */
  private buildUpdateMessage(dirPath: string, roots: DirNode[], overrides?: Partial<ScanUpdatePayload>): import('./webview/types').BackendToWebviewMessage & { type: 'update' } {
    return {
      type: 'update',
      roots,
      dirPath,
      workspaceFolderName: this.getWorkspaceFolderName(dirPath),
      autoRescanEnabled: overrides?.autoRescanEnabled ?? this.lastPayload?.autoRescanEnabled ?? true,
      sortMode: overrides?.sortMode ?? this.lastPayload?.sortMode ?? 'files',
      truncateThreshold: overrides?.truncateThreshold ?? this.lastPayload?.truncateThreshold ?? 4,
      showIgnored: overrides?.showIgnored ?? this.lastPayload?.showIgnored ?? false,
      stickyHeadersEnabled: overrides?.tabStickyHeadersEnabled ?? this.config.tabStickyHeadersEnabled,
      isLocal: overrides?.isLocal ?? this.lastPayload?.isLocal ?? true,
      hasRipgrep: this.rgAvailable,
    };
  }

  /** Opens the root-level breakdown tab (respects allowDuplicateTabs setting). */
  openOrFocus(): void {
    this.openForDir('');
  }

  /** Opens a tab rooted at dirPath.  When allowDuplicateTabs is false,
   *  focuses an existing tab for the same path instead of creating a new one.
   *  dirPath is relative to workspace root; use '' for the full workspace view. */
  async openForDir(dirPath: string): Promise<void> {
    // Ensure ripgrep probe is complete before creating the tab so we can
    // send the capability flag in the first update message.
    await this.probeRipgrep();
    const allowDuplicates = vscode.workspace.getConfiguration('dirview').get<boolean>('allowDuplicateTabs', true);
    if (!allowDuplicates) {
      for (const entry of this.panels.values()) {
        if (entry.dirPath === dirPath) {
          entry.panel.reveal();
          return;
        }
      }
    }

    const id = this.nextPanelId++;
    const title = this.getTabTitle(dirPath);
    const panel = vscode.window.createWebviewPanel(
      'dirview.tab',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
        ],
      }
    );

    const searchService = new SearchService(vscode.env.appRoot);
    this.searchServices.set(id, searchService);

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'dirview-icon-light.svg'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'dirview-icon-dark.svg'),
    };
    panel.webview.html = this.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage((message: WebviewToBackendMessage) => {
      // Search messages — scoped to this panel's dirPath for subtree-only results.
      const panelId = this.findPanelId(panel);
      const currentPath = panelId !== undefined ? this.panels.get(panelId)!.dirPath : undefined;
      const rootPaths = this.getRootPaths(currentPath ?? '');
      const wsRootPaths = this.getRootPaths('');
      const svc = panelId !== undefined ? (this.searchServices.get(panelId) ?? searchService) : searchService;
      // When auto-rescan is disabled (large repos), trigger a background rescan after
      // search completes so the tree catches up with filesystem changes ripgrep discovered.
      const rescanAfterSearch = this.lastPayload?.autoRescanEnabled === false ? this.onRefresh : undefined;
      // Pass scanner context so ripgrep flags match the scanner's file discovery.
      const showIgnored = this.lastPayload?.showIgnored ?? false;
      const filesExclude = showIgnored ? [] : this.getFilesExcludePatterns();
      if (handleSearchMessage(message, svc, (msg) => post(panel.webview, msg), rootPaths, this.rgAvailable, wsRootPaths, rescanAfterSearch, { showIgnored, filesExclude })) { return; }

      if (handleCommonMessage(message, {
        onRefresh: this.onRefresh,
        onOpenDirInTab: this.onOpenDirInTab,
      })) { return; }
      if (message.command === 'toggleStickyHeaders') {
        // Tab sticky headers are view-local — only update tab panels, not the sidebar.
        this.config.setTabStickyHeadersEnabled(message.enabled);
        this.updateStickyHeaders(message.enabled);
      } else if (message.command === 'toggleIgnored') {
        vscode.commands.executeCommand(message.show ? 'dirview.toggleIgnored' : 'dirview.toggleIgnoredOff');
      } else if (message.command === 'toggleTruncation') {
        // Tab truncation is view-local — only update tab panels, not the sidebar.
        // (Unlike toggleIgnored which triggers a rescan affecting all views.)
        const threshold = message.enabled ? (this.lastPayload?.truncateThreshold ?? 4) : 0;
        this.updateTruncation(threshold, message.enabled);
      } else if (message.command === 'navigateToDir') {
        const navId = this.findPanelId(panel);
        const navEntry = navId !== undefined ? this.panels.get(navId) : undefined;
        if (!navEntry || message.path === navEntry.dirPath) { return; }
        const targetPath = message.path;
        // Cancel any running search since the panel is changing directories.
        const oldService = navId !== undefined ? this.searchServices.get(navId) : undefined;
        if (oldService) { oldService.cancel(); }
        // Update the dirPath in place — no re-keying needed with numeric IDs.
        navEntry.dirPath = targetPath;
        panel.title = this.getTabTitle(targetPath);
        const roots = this.getRootsForDir(targetPath);
        if (roots !== undefined) {
          post(panel.webview, this.buildUpdateMessage(targetPath, roots));
        }
      }
    });

    // When the panel becomes visible again after being hidden, replay the latest
    // scan data so it shows current state (updates were skipped while hidden).
    panel.onDidChangeViewState(() => {
      if (!panel.visible) { return; }
      const visId = this.findPanelId(panel);
      const visEntry = visId !== undefined ? this.panels.get(visId) : undefined;
      if (!visEntry) { return; }
      const currentPath = visEntry.dirPath;
      const roots = this.getRootsForDir(currentPath);
      if (roots !== undefined) {
        post(panel.webview, this.buildUpdateMessage(currentPath, roots));
      }
    });

    panel.onDidDispose(() => {
      const disposeId = this.findPanelId(panel);
      if (disposeId !== undefined) {
        this.searchServices.get(disposeId)?.cancel();
        this.searchServices.delete(disposeId);
        this.panels.delete(disposeId);
      }
    });

    this.panels.set(id, { panel, dirPath });

    // Replay latest scan data if available, so the new tab shows content immediately.
    const roots = this.getRootsForDir(dirPath);
    if (roots !== undefined) {
      setTimeout(() => {
        post(panel.webview, this.buildUpdateMessage(dirPath, roots));
      }, 100);
    }
  }

  get isOpen(): boolean {
    return this.panels.size > 0;
  }

  showScanning(): void {
    for (const { panel } of this.panels.values()) {
      post(panel.webview, { type: 'scanning' });
    }
  }

  update(payload: ScanUpdatePayload): void {
    this.lastPayload = payload;
    const { autoRescanEnabled, sortMode, truncateThreshold, showIgnored, tabStickyHeadersEnabled: stickyHeadersEnabled } = payload;
    for (const { panel, dirPath } of this.panels.values()) {
      // Skip hidden panels — onDidChangeViewState will replay when they become visible.
      if (!panel.visible) { continue; }
      const panelRoots = this.getRootsForDir(dirPath);
      // Send empty array if the directory was deleted — the tab will show an empty state.
      const effectiveRoots = panelRoots ?? [];
      post(panel.webview, this.buildUpdateMessage(dirPath, effectiveRoots, payload));
    }
  }

  updateTruncation(truncateThreshold: number, truncationEnabled: boolean = truncateThreshold > 0): void {
    for (const { panel } of this.panels.values()) {
      post(panel.webview, { type: 'updateTruncation', truncateThreshold, truncationEnabled });
    }
  }

  updateStickyHeaders(enabled: boolean): void {
    for (const { panel } of this.panels.values()) {
      post(panel.webview, { type: 'updateStickyHeaders', enabled });
    }
  }

  expandAll(): void {
    for (const { panel } of this.panels.values()) {
      post(panel.webview, { type: 'expandAll' });
    }
  }

  collapseAll(): void {
    for (const { panel } of this.panels.values()) {
      post(panel.webview, { type: 'collapseAll' });
    }
  }

  showError(message: string): void {
    for (const { panel } of this.panels.values()) {
      post(panel.webview, { type: 'error', message });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this.extensionUri, {
      scripts: ['tab.js'],
      styles: ['style.css', 'languages.css', 'tab.css'],
      title: 'Breakdown',
      bodyClass: 'tab-view',
      bodyAttrs: `data-vscode-context='{"preventDefaultContextMenuItems": true}'`,
      bodyHtml: `  <div id="legend-section" class="tab-legend-section" style="display:none">
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
      <button class="tab-action tab-refresh-btn" id="tab-refresh" title="Refresh (auto-rescan disabled for large repo)" aria-label="Refresh" style="display:none"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.681 3.156a6 6 0 0 1 8.468 1.088l.47.616H11.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-1 0v1.768l-.412-.54a7 7 0 1 0 1.374 5.107.5.5 0 1 0-.984.176A6 6 0 1 1 4.68 3.156z"/></svg></button>
      <button class="tab-action" id="tab-sort" title="Sort: by file count" aria-label="Sort: by file count"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M3.684 1.01c.193.045.33.21.33.402v3.294a.42.42 0 0 1-.428.412.42.42 0 0 1-.428-.412V2.58a3.11 3.11 0 0 1-.664.435.436.436 0 0 1-.574-.184.405.405 0 0 1 .192-.552c.353-.17.629-.432.82-.661a2.884 2.884 0 0 0 .27-.388.44.44 0 0 1 .482-.22Zm-1.53 6.046a.401.401 0 0 1 0-.582l.002-.001V6.47l.004-.002.008-.008a1.12 1.12 0 0 1 .103-.084 2.2 2.2 0 0 1 1.313-.435h.007c.32.004.668.084.947.283.295.21.485.536.485.951 0 .452-.207.767-.488.992-.214.173-.49.303-.714.409-.036.016-.07.033-.103.049-.267.128-.468.24-.61.39a.763.763 0 0 0-.147.22h1.635a.42.42 0 0 1 .427.411.42.42 0 0 1-.428.412H2.457a.42.42 0 0 1-.428-.412c0-.51.17-.893.446-1.184.259-.275.592-.445.86-.574.043-.02.085-.04.124-.06.231-.11.4-.19.529-.293.12-.097.18-.193.18-.36 0-.148-.057-.23-.14-.289a.816.816 0 0 0-.448-.122 1.32 1.32 0 0 0-.818.289l-.005.005a.44.44 0 0 1-.602-.003Zm.94 5.885a.42.42 0 0 1 .427-.412c.294 0 .456-.08.537-.15a.303.303 0 0 0 .11-.246c-.006-.16-.158-.427-.647-.427-.352 0-.535.084-.618.137a.349.349 0 0 0-.076.062l-.003.004a.435.435 0 0 0 .01-.018v.001l-.002.002-.002.004-.003.006-.005.008.002-.003a.436.436 0 0 1-.563.165.405.405 0 0 1-.191-.552v-.002l.002-.003.003-.006.008-.013a.71.71 0 0 1 .087-.12c.058-.067.142-.146.259-.22.238-.153.59-.276 1.092-.276.88 0 1.477.556 1.502 1.22.012.303-.1.606-.339.84.238.232.351.535.34.838-.026.664-.622 1.22-1.503 1.22-.502 0-.854-.122-1.092-.275a1.19 1.19 0 0 1-.326-.308.71.71 0 0 1-.02-.033l-.008-.013-.003-.005-.001-.003v-.001l-.001-.001a.405.405 0 0 1 .19-.553.436.436 0 0 1 .564.165l.003.004c.01.01.033.035.076.063.083.053.266.137.618.137.489 0 .641-.268.648-.428a.303.303 0 0 0-.11-.245c-.082-.072-.244-.151-.538-.151a.42.42 0 0 1-.427-.412ZM7.5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-6Zm0 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-6Zm0 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-6Z"/></svg></button>
      <button class="tab-action" id="tab-toggle-sticky" title="Disable Sticky Headers" aria-label="Disable Sticky Headers"></button>
      <button class="tab-action" id="tab-toggle-truncation" title="Disable File Truncation" aria-label="Disable File Truncation"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11.8536 3.35355L8.35355 6.85355C8.15829 7.04882 7.84171 7.04882 7.64645 6.85355L4.14645 3.35355C3.95118 3.15829 3.95118 2.84171 4.14645 2.64645C4.34171 2.45118 4.65829 2.45118 4.85355 2.64645L8 5.79289L11.1464 2.64645C11.3417 2.45118 11.6583 2.45118 11.8536 2.64645C12.0488 2.84171 12.0488 3.15829 11.8536 3.35355ZM11.8536 12.6464L8.35355 9.14645C8.15829 8.95118 7.84171 8.95118 7.64645 9.14645L4.14645 12.6464C3.95118 12.8417 3.95118 13.1583 4.14645 13.3536C4.34171 13.5488 4.65829 13.5488 4.85355 13.3536L8 10.2071L11.1464 13.3536C11.3417 13.5488 11.6583 13.5488 11.8536 13.3536C12.0488 13.1583 12.0488 12.8417 11.8536 12.6464Z"/></svg></button>
      <button class="tab-action" id="tab-toggle-ignored" title="Show Ignored Files" aria-label="Show Ignored Files"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2.984 8.625v.003a.5.5 0 0 1-.612.355c-.431-.114-.355-.611-.355-.611l.018-.062s.026-.084.047-.145a6.7 6.7 0 0 1 1.117-1.982C4.096 5.089 5.605 4 8 4s3.904 1.089 4.802 2.183a6.7 6.7 0 0 1 1.117 1.982 4.077 4.077 0 0 1 .06.187l.003.013v.004l.001.002a.5.5 0 0 1-.966.258l-.001-.004-.008-.025a4.872 4.872 0 0 0-.2-.52 5.696 5.696 0 0 0-.78-1.263C11.286 5.912 10.044 5 8 5c-2.044 0-3.285.912-4.028 1.817a5.7 5.7 0 0 0-.945 1.674 3.018 3.018 0 0 0-.035.109l-.008.025ZM8 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 9.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"/></svg></button>
      <button class="tab-action" id="tab-expand-all" title="Expand All" aria-label="Expand All"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 6v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27c.6.35 1 .99 1 1.73Zm-4 7H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2Zm-7-1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1Zm5.5-5H8V5.5a.5.5 0 0 0-1 0V7H5.5a.5.5 0 0 0 0 1H7v1.5a.5.5 0 0 0 1 0V8h1.5a.5.5 0 0 0 0-1Z"/></svg></button>
      <button class="tab-action" id="tab-collapse-all" title="Collapse All" aria-label="Collapse All"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M14 4.27c.6.35 1 .99 1 1.73v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27ZM9.5 7a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1h4Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11 2c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7ZM4 3c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4Z"/></svg></button>
    </div>
  </div>
  <div id="root"></div>
  </div>`,
      skipRoot: true,
    });
  }

  notifyThemeChanged(): void {
    for (const { panel } of this.panels.values()) {
      post(panel.webview, { type: 'themeChanged' });
    }
  }
}
