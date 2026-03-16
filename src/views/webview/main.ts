import {
  createScanBar,
  createTooltip,
  createState,
  createRenderer,
  renderTree,
  createMessageHandler,
  setupStickyTracking,
  emptyState,
} from './index';
import type { DirNode, SortMode, BackendToWebviewMessage } from './types';

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const scanBar = createScanBar();
const tooltip = createTooltip();
const state = createState();
state.scanBar = scanBar;

// Set up sticky tracking for the sidebar (before render so updateStuck is available).
const { updateStuck: _updateStuck, setEnabled: setStickyEnabled } = setupStickyTracking(document.documentElement);

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

function render(roots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode) {
  state.lastRoots = roots;
  state.lastAutoRescanEnabled = autoRescanEnabled;
  state.currentSortMode = sortMode || 'files';

  // Remove one-time placeholders (loading/initializing) without wiping the
  // whole container — preserves any existing tree for incremental patching.
  root.querySelector('.empty-state')?.remove();

  if (!roots || roots.length === 0) {
    root.querySelector('ul.tree')?.remove();
    if (!root.querySelector('.empty-state')) {
      root.appendChild(emptyState('noWorkspace'));
    }
    return;
  }

  root.querySelector('.empty-state')?.remove();
  renderTree(state, renderer, root, { cssClass: 'sidebar' });
  _updateStuck();
}

state.render = render;

const sharedMsgHandler = createMessageHandler(state, scanBar, root, {
  vscode,
  render,
  onBeforeUpdate: (message: BackendToWebviewMessage & { type: 'update' }) => {
    if (typeof message.truncateThreshold === 'number') {
      if (message.truncateThreshold !== state.truncateThreshold) {
        state.truncationExpanded.clear();
        state.emptyGroupExpanded.clear();
      }
      state.truncateThreshold = message.truncateThreshold;
    }
    if (typeof message.stickyHeadersEnabled === 'boolean') {
      setStickyEnabled(message.stickyHeadersEnabled);
    }
  },
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'updateStickyHeaders') {
    setStickyEnabled(message.enabled);
    return;
  }
  sharedMsgHandler(event);
});

root.appendChild(emptyState('initializing'));
scanBar.show(true);
