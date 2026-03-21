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
} from './index';
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
});

// ── Virtual scroller + sticky overlay ───────────────────────────────────

function renderFlatRow(r: Renderer, row: FlatRow): HTMLElement {
  switch (row.type) {
    case 'dir':
      return r.renderDirRow(row.node, row.depth, row.maxMetric, row.ancestors, row.clientWidth);
    case 'file':
      return r.renderFileNode(row.file, row.depth, row.ancestors, undefined, row.maxFileMetric, row.clientWidth);
    case 'truncated':
      return r.renderTruncatedRow(row.hiddenFiles, row.depth, row.ancestors, row.dirPath, row.maxMetric, row.clientWidth);
    case 'emptyGroup':
      return r.renderEmptyGroupNode(row.nodes, row.depth, row.maxMetric, row.ancestors);
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
    case 'workspaceHeader':
      return h('li', { className: 'workspace-root-header', textContent: row.name });
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

  const { flatRows, totalHeight } = flattenTree(state, roots, {
    clientWidth: root.clientWidth || 300,
  });

  state.truncateThreshold = savedThreshold;

  currentFlatRows = flatRows;
  scroller.setTreeClass('sidebar' + (state.currentSortMode === 'size' || state.currentSortMode === 'lines' ? ' sort-size' : ''));
  scroller.update(flatRows, totalHeight);

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
    if (typeof message.truncateThreshold === 'number') {
      if (message.truncateThreshold !== state.truncateThreshold) {
        state.truncationExpanded.clear();
        state.emptyGroupExpanded.clear();
      }
      state.truncateThreshold = message.truncateThreshold;
    }
    if (typeof message.stickyHeadersEnabled === 'boolean') {
      overlay.setEnabled(message.stickyHeadersEnabled);
    }
  },
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'updateStickyHeaders') {
    overlay.setEnabled(message.enabled);
    return;
  }
  sharedMsgHandler(event);
});

// Skeleton is pre-rendered in the HTML for instant paint; just show the progress bar.
scanBar.show(true);
