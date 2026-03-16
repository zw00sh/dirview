import {
  createScanBar,
  computeStats,
  renderLegend,
  emptyState,
} from './index';
import type { LangStat } from './types';

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
const scanBar = createScanBar();

let activeFilters: Set<string> = new Set();
let currentStats: LangStat[] = [];
let showPct = false;

function render() {
  root.innerHTML = '';
  if (!currentStats || currentStats.length === 0) {
    root.appendChild(emptyState('noData'));
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
  if (message.type === 'languagesUpdate' || message.type === 'update') {
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
    root.innerHTML = '';
    root.appendChild(emptyState('error', message.message));
  }
});

root.appendChild(emptyState('initializing'));
