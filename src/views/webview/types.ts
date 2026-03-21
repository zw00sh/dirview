// Shared types for dirview webview code.
// Importable by both frontend (webview) and backend (extension host) via esbuild bundling.

// ── Data types ────────────────────────────────────────────────────────────────
// Re-exported from the scanner so webview code can import from one location.
// These are compile-time only — no runtime cost in the bundle.
export type { DirNode, FileNode, FileTypeStats } from '../../scanner/types';
import type { DirNode, FileNode, FileTypeStats } from '../../scanner/types';

// Redefined here (can't import from config.ts which depends on vscode).
export type SortMode = 'files' | 'name' | 'size' | 'lines';

// ── Search match ──────────────────────────────────────────────────────────────

export interface SearchMatch {
  line: number;
  column: number;
  matchLength: number;
  lineText: string;
  isContext?: boolean;
  highlightedHtml?: string;
}

// ── Messages: backend → webview ───────────────────────────────────────────────

export type BackendToWebviewMessage =
  | { type: 'scanning' }
  | { type: 'loading' }
  | { type: 'update'; roots: DirNode[]; autoRescanEnabled: boolean; sortMode: SortMode; truncateThreshold: number; stickyHeadersEnabled: boolean; showIgnored?: boolean; isLocal?: boolean; dirPath?: string; workspaceFolderName?: string; activeFilters?: string[]; showPct?: boolean; hasRipgrep?: boolean }
  | { type: 'updateTruncation'; truncateThreshold: number; truncationEnabled?: boolean }
  | { type: 'updateSortMode'; sortMode: SortMode }
  | { type: 'updateStickyHeaders'; enabled: boolean }
  | { type: 'filter'; langs: string[] }
  | { type: 'expandAll' }
  | { type: 'collapseAll' }
  | { type: 'error'; message: string }
  | { type: 'searchProgress'; rootPaths: string[] }
  | { type: 'searchResultsBatch'; matches: Record<string, SearchMatch[]>; fileCount: number; matchCount: number }
  | { type: 'searchResultsHighlight'; patches: Array<{ path: string; idx: number; html: string }> }
  | { type: 'searchResultsDone'; fileCount: number; matchCount: number; truncated: boolean }
  | { type: 'searchResults'; matches: Record<string, SearchMatch[]> | null; fileCount?: number; matchCount?: number; truncated?: boolean; error?: string }
  | { type: 'themeChanged' }
  | { type: 'setDisplayMode'; showPct: boolean }
  | { type: 'languagesUpdate'; roots: Array<{ stats: FileTypeStats[]; totalFiles: number }>; activeFilters: string[]; showPct: boolean };

// ── Messages: webview → backend ───────────────────────────────────────────────

export type WebviewToBackendMessage =
  | { command: 'refresh' }
  | { command: 'openFile'; path: string; line?: number }
  | { command: 'openDirInTab'; path: string }
  | { command: 'navigateToDir'; path: string }
  | { command: 'filter'; langs: string[] }
  | { command: 'toggleIgnored'; show: boolean }
  | { command: 'toggleTruncation'; enabled: boolean }
  | { command: 'toggleStickyHeaders'; enabled: boolean }
  | { command: 'search'; pattern: string; caseSensitive?: boolean; useRegex?: boolean; include?: string; exclude?: string; contextLines?: number; langFilters?: string[] }
  | { command: 'searchFiles'; glob: string; exclude?: string }
  | { command: 'clearSearch' };

// ── VsCode API ────────────────────────────────────────────────────────────────

export interface VsCodeApi {
  postMessage(message: WebviewToBackendMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

// ── Scan bar ──────────────────────────────────────────────────────────────────

export interface ScanBar {
  show(active: boolean): void;
}

// ── State ─────────────────────────────────────────────────────────────────────

/** Core state shared by all webview instances (sidebar, tab, languages). */
export interface CoreWebviewState {
  activeFilters: Set<string>;
  expanded: Map<string, boolean>;
  truncationExpanded: Set<string>;
  emptyGroupExpanded: Set<string>;
  truncateThreshold: number;
  currentSortMode: SortMode;
  lastRoots: DirNode[] | null;
  lastAutoRescanEnabled: boolean;
  render: ((roots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode) => void) | null;
  currentRootName: string;
  workspaceFolderName: string;
  dirPath: string;
  scanBar: ScanBar | null;
  _rerenderPending: boolean;
  rerender: () => void;
}

/** Full state including search fields — used by tab and any view with search/filtering. */
export interface WebviewState extends CoreWebviewState {
  searchResults: Map<string, SearchMatch[]> | null;
  matchesCollapsed: Set<string>;
  searchActive: boolean;
  searchTruncated: boolean;
  searchFileCount: number;
  searchMatchCount: number;
  /** Whether a glob file filter (include or exclude) is active. Used to track
   *  that filtering is happening even before ripgrep results arrive. */
  fileFilterActive: boolean;
  /** Precomputed set of directory paths that are ancestors of search result files.
   *  Enables O(1) dirMatchesSearch checks instead of recursive tree walks. */
  searchAncestorPaths: Set<string> | null;
  /** Workspace root paths (absolute) used to convert absolute file paths to
   *  workspace-relative paths for ancestor index lookups against DirNode.path. */
  searchRootPaths: string[];
  searchBar_updateStatus: (() => void) | null;
  _searchRenderTimer: ReturnType<typeof setTimeout> | null;
  /** Monotonic counter incremented on every search/filter state mutation.
   *  Used by filterTree() to invalidate its cache. */
  searchResultsVersion: number;
  /** Total visible file count from the most recent filterTree pass. */
  lastFilteredFileCount: number;
  /** Total visible match count from the most recent filterTree pass (search + file filter). */
  lastFilteredMatchCount: number;
  /** Optional callback invoked after each render completes (post-rAF). */
  onAfterRender: (() => void) | null;
  /** Whether any filter (language, search, file) is currently active.
   *  Set before render so the renderer can read it for chevron/expand logic. */
  _isFiltered: boolean;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export interface RendererOptions {
  skipDepthZeroGuides?: boolean;
  hideCounts?: boolean;

  barFactor?: number;
  barMaxWidth?: number;
  barFallbackWidth?: number;
  barMinWidth?: number;
  barSqrt?: boolean;
}

export interface IndentAncestor {
  path: string;
  isFileMatch?: boolean;
}

export interface RendererDeps {
  vscode: VsCodeApi;
  root: HTMLElement;
  tooltip: HTMLElement;
  options: RendererOptions;
  /** When set, clicking a dir-name navigates to that directory instead of toggling expand/collapse. */
  onNavigate?: (path: string) => void;
  onExpandChanged?: (anyExpanded: boolean) => void;
}

export interface RendererContext {
  state: WebviewState;
  deps: RendererDeps;
  opts: RendererOptions;
  nodeMap: Map<string, NodeMapEntry>;
  root: HTMLElement;
  tooltip: HTMLElement;
  vscode: VsCodeApi;
  renderIndentGuides: (depth: number, ancestors: IndentAncestor[]) => HTMLSpanElement;
}

export interface Renderer {
  beforeRender(): void;
  setFileMetricContext(maxFileMetric: number, clientWidth: number): void;
  renderIndentGuides(depth: number, ancestors: IndentAncestor[]): HTMLSpanElement;
  renderFileNode(file: FileNode, depth: number, ancestors: IndentAncestor[], hasMatches?: boolean, maxFileMetric?: number, clientWidth?: number): HTMLLIElement;
  renderMatchLine(file: FileNode, matchGroup: SearchMatch[], depth: number, ancestors: IndentAncestor[], dedent?: number): HTMLLIElement;
  renderContextLine(file: FileNode, match: SearchMatch, depth: number, ancestors: IndentAncestor[], dedent?: number): HTMLLIElement;
  renderMoreMatchesRow(count: number, depth: number, ancestors: IndentAncestor[], filePath: string): HTMLLIElement;
  renderFileMatches(container: HTMLElement, file: FileNode, depth: number, ancestors: IndentAncestor[]): void;
  renderTruncatedRow(hiddenFiles: FileNode[], depth: number, ancestors: IndentAncestor[], dirPath: string, maxMetric: number, clientWidth: number): HTMLLIElement;
  renderEmptyGroupNode(nodes: DirNode[], depth: number, maxMetric: number, ancestors: IndentAncestor[]): HTMLLIElement;
  renderDirRow(node: DirNode, depth: number, maxMetric: number, ancestors: IndentAncestor[], clientWidth: number): HTMLLIElement;
  renderDirNode(node: DirNode, depth: number, maxMetric: number, ancestors: IndentAncestor[], clientWidth: number): HTMLLIElement;
}

// ── Lang stat (computed from roots for legend rendering) ──────────────────────

export interface LangStat {
  name: string;
  color: string;
  count: number;
  sizeBytes: number;
  lineCount: number;
  pct: string;
}

// ── Sticky tracking ───────────────────────────────────────────────────────────

export interface StickyTracking {
  updateStuck: () => void;
  setEnabled: (enabled: boolean) => void;
}

// ── Search bar ────────────────────────────────────────────────────────────────

export interface SearchBarOptions {
  standalone?: boolean;
  onClearLangFilter?: () => void;
}

export interface SearchBarResult {
  el: HTMLElement;
  focus: () => void;
  clear: () => void;
  show: () => void;
  hide: () => void;
  updateStatus: () => void;
  /** Directly applies post-render filtered counts to status. No defer. */
  updateFilteredStatus: () => void;
  setStatus: (data: SearchStatusData) => void;
  updateFilterWarning: (count: number) => void;
  setScopeWarning: (dirPath: string) => void;
  triggerSearch: () => void;
  /** Update ripgrep availability — hides content search + context UI when false. */
  setHasRipgrep: (available: boolean) => void;
}

export interface SearchStatusData {
  active?: boolean;
  matches?: Record<string, unknown> | null;
  matchCount?: number;
  fileCount?: number;
  truncated?: boolean;
}

// ── Message handler deps ──────────────────────────────────────────────────────

export interface MessageHandlerDeps {
  vscode: VsCodeApi;
  render: (roots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode) => void;
  resolveUpdateSortMode?: (msg: BackendToWebviewMessage & { type: 'update' }) => SortMode;
  onBeforeUpdate?: (msg: BackendToWebviewMessage & { type: 'update' }) => void;
  onAfterRender?: (msg: BackendToWebviewMessage & { type: 'update' }) => void;
  onLoading?: () => void;
  onFilter?: (hadFilters: boolean) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
}

// ── Node map (renderer) ──────────────────────────────────────────────────────

export interface TooltipNode {
  totalFiles: number;
  sizeBytes: number;
  totalLines: number;
  stats: FileTypeStats[];
}

export type NodeMapEntry =
  | { node: DirNode; hasChildren: boolean }
  | { node: TooltipNode; hasChildren: false };

// ── Action types (delegated click handler) ────────────────────────────────────

// ── Grouped children types ────────────────────────────────────────────────────

export type GroupedChild =
  | { type: 'emptyGroup'; nodes: DirNode[] }
  | { type: 'dir'; node: DirNode };
