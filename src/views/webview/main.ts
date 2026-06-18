import {
  h,
  createScanBar,
  createTooltip,
  createState,
  createRenderer,
  createMessageHandler,
  isFiltered,
  emptyState,
  skeletonState,
  SVG_CLOSE,
  compactedPath,
} from './index';
import { globToRegex } from './globMatch';
import { flattenTree } from './virtual/flatten';
import { createVirtualScroller } from './virtual/scroller';
import { createStickyOverlay } from './virtual/sticky-overlay';
import type { FlatRow } from './virtual/types';
import type { DirNode, SortMode, BackendToWebviewMessage, Renderer } from './types';

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const scanBar = createScanBar();
const tooltip = createTooltip();
const state = createState();
state.scanBar = scanBar;
state.dirPath = '';
state.workspaceFolderName = '';

const renderer = createRenderer(state, {
  vscode,
  root,
  tooltip,
  options: {
    skipDepthZeroGuides: true,
    hideCounts: true,
    barFactor: 0.4,
    barMaxWidth: 200,
    barFallbackWidth: 300,
  },
  onNavigate: (path: string) => {
    vscode.postMessage({ command: 'navigateToDir', path });
  },
});

// ── Virtual scroller + sticky overlay ───────────────────────────────────

function renderFlatRow(r: Renderer, row: FlatRow): HTMLElement {
  switch (row.type) {
    case 'dir':
      // Pass originalNode (pre-compaction) so renderDirRow can rebuild the full
      // "parent / child" display chain; fall back to row.node when compaction didn't apply.
      return r.renderDirRow(row.originalNode ?? row.node, row.depth, row.maxMetric, row.ancestors, row.clientWidth, row.isWorkspaceRoot);
    case 'file':
      return r.renderFileNode(row.file, row.depth, row.ancestors, undefined, row.maxFileMetric, row.clientWidth);
    case 'truncated':
      return r.renderTruncatedRow(row.hiddenFiles, row.depth, row.ancestors, row.dirPath, row.maxMetric, row.clientWidth);
    case 'matchGroup': {
      const firstMatch = row.matches[0];
      let copyText: string;
      if (row.matches.length === 1) {
        copyText = firstMatch.matchGroup[0].lineText || '';
      } else {
        const copyLines: string[] = [];
        for (const me of row.matches) {
          for (const ctx of me.contextBefore) { copyLines.push(ctx.lineText || ''); }
          copyLines.push(me.matchGroup[0].lineText || '');
        }
        copyText = copyLines.join('\n');
      }
      const wrapper = h('li', {
        className: 'match-group' + (row.hasGap ? ' gap-before' : ''),
        dataset: {
          nodePath: 'match:' + row.file.path + ':' + firstMatch.matchGroup[0].line,
          action: 'openFileAtLine',
          path: row.file.path,
          line: String(firstMatch.matchGroup[0].line),
        },
        attr: { 'data-vscode-context': JSON.stringify({
          webviewSection: 'matchLine',
          path: row.file.path,
          lineText: copyText,
          preventDefaultContextMenuItems: true,
        }) },
      });
      if (row.hasGap) {
        wrapper.appendChild(h('div', { className: 'match-group-spacer' }, r.renderIndentGuides(row.depth, row.ancestors)));
      }
      for (const me of row.matches) {
        for (const ctx of me.contextBefore) {
          const ctxLi = r.renderContextLine(row.file, ctx, row.depth, row.ancestors, row.dedent);
          const ctxDiv = ctxLi.firstElementChild as HTMLElement;
          delete ctxDiv.dataset.action;
          delete ctxDiv.dataset.path;
          delete ctxDiv.dataset.line;
          wrapper.appendChild(ctxDiv);
        }
        const matchLi = r.renderMatchLine(row.file, me.matchGroup, row.depth, row.ancestors, row.dedent);
        const matchDiv = matchLi.firstElementChild as HTMLElement;
        matchDiv.removeAttribute('data-vscode-context');
        wrapper.appendChild(matchDiv);
      }
      for (const ctx of row.contextAfter) {
        const ctxLi = r.renderContextLine(row.file, ctx, row.depth, row.ancestors, row.dedent);
        const ctxDiv = ctxLi.firstElementChild as HTMLElement;
        delete ctxDiv.dataset.action;
        delete ctxDiv.dataset.path;
        delete ctxDiv.dataset.line;
        wrapper.appendChild(ctxDiv);
      }
      return wrapper;
    }
    case 'moreMatches':
      return r.renderMoreMatchesRow(row.count, row.depth, row.ancestors, row.filePath);
  }
}

let currentFlatRows: FlatRow[] = [];

const scroller = createVirtualScroller({
  container: root,
  renderRow: (row) => renderFlatRow(renderer, row),
  overscan: 10,
  treeClass: 'sidebar',
  onRender: (visibleStart) => {
    overlay.update(currentFlatRows, visibleStart);
  },
});

const overlay = createStickyOverlay({
  container: root,
  renderRow: (row) => renderFlatRow(renderer, row),
});

// ── File filter bar ──────────────────────────────────────────────────────

const filterInput = h('input', {
  type: 'text',
  className: 'sidebar-filter-input',
  placeholder: 'Filter files (e.g. *.ts, src/**)',
  attr: { 'aria-label': 'Filter files by glob pattern' },
});

const filterClear = h('button', {
  className: 'sidebar-filter-clear',
  title: 'Clear Filter (Escape)',
  innerHTML: SVG_CLOSE,
  style: { display: 'none' },
  attr: { 'aria-label': 'Clear Filter' },
});

const filterStatus = h('span', { className: 'sidebar-filter-status' });

const filterBar = h('div', {
  className: 'sidebar-filter-bar',
  style: { display: 'none' },
}, filterInput, filterClear, filterStatus);

// Insert filter bar before the tree root container.
root.parentElement!.insertBefore(filterBar, root);

let filterTimer: ReturnType<typeof setTimeout> | null = null;
let filterBarVisible = false;

function applyFileFilter(pattern: string): void {
  if (!pattern.trim() || !state.lastRoots) {
    state.searchResults = null;
    state.searchAncestorPaths = null;
    state.fileFilterActive = false;
    state.searchResultsVersion++;
    filterStatus.textContent = '';
    filterClear.style.display = 'none';
    state.expanded.clear();
    vscode.postMessage({ command: 'fileFilterActive', active: false });
    state.rerender();
    return;
  }

  const patterns = pattern.split(',').map(p => p.trim()).filter(Boolean);
  const matchers = patterns.map(p => globToRegex(p));

  const matches = new Map<string, never[]>();
  const ancestors = new Set<string>();

  function walkTree(node: DirNode): boolean {
    let hasMatch = false;
    for (const file of node.files || []) {
      const name = file.name ?? file.path.split('/').pop() ?? '';
      for (const { regex, hasSlash } of matchers) {
        const target = hasSlash ? (node.path + '/' + name) : name;
        if (regex.test(target)) {
          matches.set(file.path, []);
          hasMatch = true;
          break;
        }
      }
    }
    for (const child of node.children) {
      if (walkTree(child)) hasMatch = true;
    }
    if (hasMatch) ancestors.add(node.path);
    return hasMatch;
  }

  for (const root of state.lastRoots) walkTree(root);
  ancestors.add('');

  state.searchResults = matches;
  state.searchAncestorPaths = ancestors;
  state.fileFilterActive = true;
  state.searchResultsVersion++;

  state.expanded.clear();
  for (const dirPath of ancestors) state.expanded.set(dirPath, true);

  filterStatus.textContent = matches.size + ' file' + (matches.size !== 1 ? 's' : '');
  filterClear.style.display = '';
  vscode.postMessage({ command: 'fileFilterActive', active: true });
  state.rerender();
}

filterInput.addEventListener('input', () => {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => applyFileFilter(filterInput.value), 300);
});

filterInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    filterInput.value = '';
    applyFileFilter('');
    filterInput.blur();
  }
});

filterClear.addEventListener('click', () => {
  filterInput.value = '';
  applyFileFilter('');
});

// ── Render ───────────────────────────────────────────────────────────────

let initialRender = true;

function render(roots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode) {
  state.lastRoots = roots;
  state.lastAutoRescanEnabled = autoRescanEnabled;
  state.currentSortMode = sortMode || 'files';

  root.querySelector('.empty-state')?.remove();

  if (!roots || roots.length === 0) {
    currentFlatRows = [];
    scroller.update([], 0);
    if (!root.querySelector('.empty-state')) {
      root.appendChild(emptyState('noWorkspace'));
    }
    return;
  }

  root.querySelector('.empty-state')?.remove();
  renderer.beforeRender();

  state._isFiltered = isFiltered(state);

  // Auto-disable truncation when the tree fits in the viewport on initial render.
  const savedThreshold = state.truncateThreshold;
  if (initialRender && state.truncateThreshold > 0) {
    const probe = flattenTree(state, roots, { clientWidth: root.clientWidth || 300 });
    const viewportHeight = root.clientHeight || 0;
    if (viewportHeight > 0 && probe.totalHeight <= viewportHeight) {
      state.truncateThreshold = 0;
    }
    initialRender = false;
  }

  const { flatRows, totalHeight, filteredRoots } = flattenTree(state, roots, {
    clientWidth: root.clientWidth || 300,
  });

  state.truncateThreshold = savedThreshold;

  currentFlatRows = flatRows;
  scroller.setTreeClass('sidebar' + (state.currentSortMode === 'size' || state.currentSortMode === 'lines' ? ' sort-size' : ''));
  scroller.update(flatRows, totalHeight);

  // Send scope + filtered stats to the host so the Languages panel stays in sync.
  // scopeRoots = unfiltered roots for the current dirPath (the baseline).
  // filteredRoots = after file/language filter (the current view).
  const strip = (r: DirNode) => ({ stats: r.stats, totalFiles: r.totalFiles });
  vscode.postMessage({
    command: 'sidebarStats',
    scopeRoots: roots.map(strip),
    filteredRoots: (filteredRoots || roots).map(strip),
  });

  const filteredEmpty = state._isFiltered && flatRows.length === 0;
  const existingNoResults = root.querySelector(':scope > .empty-state');
  if (filteredEmpty) {
    if (!existingNoResults) { root.appendChild(emptyState('noResults')); }
  } else {
    existingNoResults?.remove();
  }
}

state.render = render;

// ── Message handler ─────────────────────────────────────────────────────

const sharedMsgHandler = createMessageHandler(state, scanBar, root, {
  vscode,
  render,
  onBeforeUpdate: (message: BackendToWebviewMessage & { type: 'update' }) => {
    initialRender = true;
    const dirChanged = typeof message.dirPath === 'string' && message.dirPath !== state.dirPath;
    if (typeof message.dirPath === 'string') { state.dirPath = message.dirPath; }
    if (typeof message.workspaceFolderName === 'string') { state.workspaceFolderName = message.workspaceFolderName; }
    // When navigating into a directory, expand its direct children one level.
    if (dirChanged && state.dirPath) {
      state.expanded.clear();
      const roots = message.roots as DirNode[];
      for (const root of roots) {
        state.expanded.set(root.path, true);
        for (const child of root.children) {
          state.expanded.set(compactedPath(child), true);
        }
      }
    }
    if (typeof message.truncateThreshold === 'number') {
      if (message.truncateThreshold !== state.truncateThreshold) {
        state.truncationExpanded.clear();
      }
      state.truncateThreshold = message.truncateThreshold;
    }
    if (typeof message.stickyHeadersEnabled === 'boolean') {
      overlay.setEnabled(message.stickyHeadersEnabled);
    }
  },
  onAfterRender: () => {
    // Re-apply file filter after new scan data arrives.
    if (filterInput.value.trim() && state.lastRoots) {
      applyFileFilter(filterInput.value);
    }
  },
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'updateStickyHeaders') {
    overlay.setEnabled(message.enabled);
    return;
  }
  if (message.type === 'toggleFileFilter') {
    filterBarVisible = !filterBarVisible;
    filterBar.style.display = filterBarVisible ? '' : 'none';
    if (filterBarVisible) { filterInput.focus(); }
    return;
  }
  sharedMsgHandler(event);
});

// Skeleton is pre-rendered in the HTML for instant paint; just show the progress bar.
scanBar.show(true);
