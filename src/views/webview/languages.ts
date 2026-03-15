import {
  createScanBar,
  computeStats,
  renderLegend,
  escHtml,
  setupDebugEval,
} from './shared';
import type { LangStat } from './types';

const vscode = acquireVsCodeApi();
if (DEV_MODE) {
  setupDebugEval(vscode);
}
const root = document.getElementById('root')!;
const scanBar = createScanBar();

let activeFilters: Set<string> = new Set();
let currentStats: LangStat[] = [];
let showPct = false;

function render() {
  root.innerHTML = '';
  if (!currentStats || currentStats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No data yet.';
    root.appendChild(empty);
    return;
  }
  renderLegend(root, currentStats, activeFilters, (langName: string) => {
    if (activeFilters.has(langName)) { activeFilters.delete(langName); }
    else { activeFilters.add(langName); }
    vscode.postMessage({ command: 'filter', langs: [...activeFilters] });
    render();
  }, showPct);
}

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'scanning') {
    scanBar.show(true);
    return;
  }
  if (message.type === 'update') {
    scanBar.show(false);
    currentStats = computeStats(message.roots || []);
    if (message.activeFilters !== undefined) {
      activeFilters = new Set(message.activeFilters);
    }
    if (message.showPct !== undefined) {
      showPct = message.showPct;
    }
    render();
  } else if (message.type === 'filter') {
    activeFilters = new Set(message.langs || []);
    render();
  } else if (message.type === 'setDisplayMode') {
    showPct = message.showPct;
    render();
  } else if (message.type === 'error') {
    scanBar.show(false);
    root.innerHTML = `<div class="empty">Error: ${escHtml(message.message)}</div>`;
  }
});

root.innerHTML = '<div class="empty">Initializing…</div>';
