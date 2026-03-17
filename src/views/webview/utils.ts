// Shared utility functions for dirview webviews.

import type { DirNode, FileNode, FileTypeStats, SortMode, WebviewState, ScanBar, LangStat, GroupedChild, RendererOptions } from './types';
import { h } from './h';
import { SVG_SYNC, SVG_SEARCH, SVG_FOLDER_OPENED, SVG_INFO, SVG_WARNING } from './icons';

export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type EmptyStateVariant = 'initializing' | 'scanning' | 'noWorkspace' | 'noData' | 'noResults' | 'error';

const emptyStateConfig: Record<EmptyStateVariant, { icon: string; text: string; cls: string }> = {
  initializing: { icon: SVG_SYNC, text: 'Initializing\u2026', cls: 'scanning' },
  scanning:     { icon: SVG_SEARCH, text: 'Scanning workspace\u2026', cls: 'scanning' },
  noWorkspace:  { icon: SVG_FOLDER_OPENED, text: 'No workspace folder open.', cls: '' },
  noData:       { icon: SVG_INFO, text: 'No data yet.', cls: '' },
  noResults:    { icon: SVG_SEARCH, text: 'No results found.', cls: '' },
  error:        { icon: SVG_WARNING, text: '', cls: 'error' },
};

export function emptyState(variant: EmptyStateVariant, message?: string): HTMLElement {
  const { icon, text, cls } = emptyStateConfig[variant];
  let msg: string;
  if (message) {
    msg = variant === 'error' ? `Error: ${message}` : message;
  } else {
    msg = text;
  }
  return h('div', { className: `empty-state${cls ? ' ' + cls : ''}` },
    h('div', { className: 'empty-state-icon', innerHTML: icon }),
    h('div', { className: 'empty-state-text', textContent: msg }),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) { return '0 B'; }
  if (bytes < 1024) { return bytes + ' B'; }
  if (bytes < 1024 * 1024) { return Math.round(bytes / 1024) + ' KB'; }
  return Math.round(bytes / (1024 * 1024)) + ' MB';
}

// WeakMap caches keyed by the original array reference: Map<mode, sortedArray>.
// This avoids redundant .slice().sort() on every render for unchanged data.
const _sortDirsCache = new WeakMap<DirNode[], Map<SortMode, DirNode[]>>();
const _sortFilesCache = new WeakMap<FileNode[], FileNode[]>();

export function sortDirs(dirs: DirNode[], mode: SortMode): DirNode[] {
  if (!dirs.length) { return dirs; }
  let byMode = _sortDirsCache.get(dirs);
  if (byMode && byMode.has(mode)) { return byMode.get(mode)!; }
  const copy = dirs.slice();
  if (mode === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === 'size') {
    copy.sort((a, b) => b.sizeBytes - a.sizeBytes);
  } else {
    // 'files' — by total file count desc
    copy.sort((a, b) => b.totalFiles - a.totalFiles);
  }
  if (!byMode) { byMode = new Map(); _sortDirsCache.set(dirs, byMode); }
  byMode.set(mode, copy);
  return copy;
}

export function sortFiles(files: FileNode[]): FileNode[] {
  if (!files.length) { return files; }
  const cached = _sortFilesCache.get(files);
  if (cached) { return cached; }
  const copy = files.slice();
  copy.sort((a, b) => a.name.localeCompare(b.name));
  _sortFilesCache.set(files, copy);
  return copy;
}

// Simple reference-equality cache: avoids redundant full-tree walks on filter/sort/expand.
let _maxMetricCache: { roots: DirNode[] | null; sortMode: SortMode | null; includeRoots: boolean; value: number } = { roots: null, sortMode: null, includeRoots: false, value: 1 };

// Computes the max metric value across the tree for bar scaling.
// When includeRoots is false (default), skips root nodes so they always render at 100%.
// When includeRoots is true, includes roots so bars scale relative to them.
export function computeMaxMetric(roots: DirNode[], sortMode: SortMode, includeRoots: boolean): number {
  if (_maxMetricCache.roots === roots && _maxMetricCache.sortMode === sortMode && _maxMetricCache.includeRoots === !!includeRoots) {
    return _maxMetricCache.value;
  }
  let max = 0;
  function walk(node: DirNode): void {
    const val = sortMode === 'size' ? node.sizeBytes : node.totalFiles;
    if (val > max) { max = val; }
    for (const c of node.children) { walk(c); }
  }
  for (const r of roots) {
    if (includeRoots) { walk(r); }
    else { for (const c of r.children) { walk(c); } }
  }
  const value = max || 1;
  _maxMetricCache = { roots, sortMode, includeRoots: !!includeRoots, value };
  return value;
}

// WeakMap cache for groupEmptyDirs — keyed by children array reference.
const _groupEmptyDirsCache = new WeakMap<DirNode[], GroupedChild[]>();

// Groups consecutive empty-dir siblings (totalFiles === 0) into {type:'emptyGroup', nodes:[]}
export function groupEmptyDirs(children: DirNode[]): GroupedChild[] {
  if (_groupEmptyDirsCache.has(children)) { return _groupEmptyDirsCache.get(children)!; }
  const result: GroupedChild[] = [];
  let i = 0;
  while (i < children.length) {
    if (children[i].totalFiles === 0) {
      const start = i;
      while (i < children.length && children[i].totalFiles === 0) { i++; }
      const emptyNodes = children.slice(start, i);
      if (emptyNodes.length >= 2) {
        result.push({ type: 'emptyGroup', nodes: emptyNodes });
      } else {
        result.push({ type: 'dir', node: emptyNodes[0] });
      }
    } else {
      result.push({ type: 'dir', node: children[i] });
      i++;
    }
  }
  _groupEmptyDirsCache.set(children, result);
  return result;
}

// Creates and inserts the scan progress bar element. Returns a controller.
export function createScanBar(): ScanBar {
  const el = document.createElement('div');
  el.className = 'scan-progress';
  document.body.insertBefore(el, document.body.firstChild);
  return {
    show(active: boolean) {
      el.className = 'scan-progress' + (active ? ' active' : '');
    },
  };
}

// Creates and appends the shared bar hover tooltip element.
export function createTooltip(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'bar-tooltip';
  document.body.appendChild(el);
  return el;
}

// Returns the node that renderDirNode would use as displayNode for the given node —
// i.e. follows the compact-folder chain (single child dir, no files) to its deepest node.
export function compactedNode(node: DirNode): DirNode {
  let cur = node;
  while (cur.children.length === 1 && (cur.files || []).length === 0) {
    cur = cur.children[0];
  }
  return cur;
}

export function compactedPath(node: DirNode): string {
  return compactedNode(node).path;
}

// Returns true if any of node's descendants are expanded.
export function hasExpandedDescendant(state: WebviewState, node: DirNode, defaultExpanded = false): boolean {
  for (const child of (node.children || [])) {
    const cn = compactedNode(child);
    if (state.expanded.get(cn.path) ?? defaultExpanded) return true;
    if (hasExpandedDescendant(state, cn, defaultExpanded)) return true;
  }
  return false;
}

// Simple reference-equality cache for computeStats — avoids re-aggregating on every render.
let _computeStatsCache: { roots: DirNode[] | null; value: LangStat[] | null } = { roots: null, value: null };

// Aggregate language stats from root nodes. Shared between tab.js and languagesProvider.ts.
export function computeStats(roots: DirNode[]): LangStat[] {
  if (_computeStatsCache.roots === roots) { return _computeStatsCache.value!; }
  const counts = new Map<string, { color: string; count: number }>();
  let total = 0;
  for (const r of roots) {
    for (const s of r.stats) {
      const ex = counts.get(s.name);
      if (ex) { ex.count += s.count; } else { counts.set(s.name, { color: s.color, count: s.count }); }
    }
    total += r.totalFiles;
  }
  const value: LangStat[] = Array.from(counts.entries())
    .map(([name, { color, count }]) => ({ name, color, count, pct: total > 0 ? ((count / total) * 100).toFixed(1) : '0' }))
    .sort((a, b) => b.count - a.count);
  _computeStatsCache = { roots, value };
  return value;
}

// Render a filterable language legend into a container element.
// showPct: when true, displays percentage instead of raw file count.
// baseStats: when provided, all base languages are rendered in their original (frozen) order.
//   Languages with 0 current count are dimmed/non-interactive (unless actively filtered).
//   This prevents layout reflow when search/filter results change.
// Returns nothing; mutates legendEl in-place.
export function renderLegend(legendEl: HTMLElement, stats: LangStat[], activeFilters: Set<string>, onToggle: (lang: string) => void, showPct: boolean, baseStats?: LangStat[]): void {
  legendEl.innerHTML = '';
  const items = document.createElement('div');
  items.className = 'legend-items';

  // Delegated click handler — one listener on the container instead of per-item.
  // Skip zero-count items unless they are actively filtered (user can deactivate their own filter).
  items.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.legend-item[data-lang]');
    if (item && !item.classList.contains('zero-count')) { onToggle(item.dataset.lang!); }
  });

  // Build a lookup from current stats for quick count access.
  const currentCounts = new Map<string, LangStat>();
  for (const s of stats) { currentCounts.set(s.name, s); }

  const renderList = baseStats ?? stats;
  for (const lang of renderList) {
    const current = currentCounts.get(lang.name);
    const count = current ? current.count : 0;
    const pct = current ? current.pct : '0';
    const isActive = activeFilters.has(lang.name);
    const isInactive = activeFilters.size > 0 && !isActive;
    const isZero = count === 0 && !isActive;
    const item = document.createElement('div');
    item.className = 'legend-item'
      + (isActive ? ' active' : '')
      + (isInactive ? ' inactive' : '')
      + (isZero ? ' zero-count' : '');
    item.dataset.lang = lang.name;
    const displayValue = showPct ? pct + '%' : String(count);
    item.innerHTML =
      `<span class="legend-swatch" style="background:${isZero ? 'var(--vscode-descriptionForeground)' : lang.color}"></span>` +
      `<span class="legend-name">${escHtml(lang.name)}</span>` +
      `<span class="legend-count">${displayValue}</span>`;
    items.appendChild(item);
  }
  legendEl.appendChild(items);
}

// Computes the bar width in pixels for a proportional bar.
// Deduplicates identical computation previously in renderDirNode and renderTruncatedRow.
export function computeBarWidth(pct: number, clientWidth: number, rootEl: HTMLElement, opts: RendererOptions): number {
  const cw = clientWidth || rootEl.clientWidth || opts.barFallbackWidth || 300;
  const maxBarWidth = Math.min(cw * (opts.barFactor || 0.4), opts.barMaxWidth || 200);
  const minBarWidth = opts.barMinWidth || 12;
  return Math.max((opts.barSqrt ? Math.sqrt(pct) : pct) * maxBarWidth, minBarWidth);
}
