import {
  createScanBar,
  computeStats,
  renderLegend,
  emptyState,
  skeletonLegendState,
} from './index';
import type { LangStat } from './types';

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
const scanBar = createScanBar();

let activeFilters: Set<string> = new Set();
let currentStats: LangStat[] = [];
// Base stats for stable layout ordering.
// - At workspace root with no filter: same as currentStats (from full scan)
// - Drilled down: stats from the drilled-down directory (unfiltered)
// - With file filter: unchanged (still the scope baseline)
// Languages not in baseStats are hidden; languages in baseStats but not in
// currentStats are dimmed (zero-count). Matches the tab legend behavior.
let baseStats: LangStat[] = [];
let showPct = false;

function render() {
  root.innerHTML = '';
  if (!currentStats || currentStats.length === 0) {
    if (baseStats.length > 0) {
      renderLegend(root, [], activeFilters, toggleFilter, showPct, baseStats);
      return;
    }
    root.appendChild(emptyState('noData'));
    return;
  }
  renderLegend(root, currentStats, activeFilters, toggleFilter, showPct, baseStats.length > 0 ? baseStats : undefined);
}

function toggleFilter(langName: string) {
  if (activeFilters.has(langName)) { activeFilters.delete(langName); }
  else { activeFilters.add(langName); }
  vscode.postMessage({ command: 'filter', langs: [...activeFilters] });
  render();
}

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'scanning') {
    scanBar.show(true);
    return;
  }
  if (message.type === 'languagesUpdate' || message.type === 'update') {
    scanBar.show(false);
    const stats = computeStats(message.roots || []);
    if (message.scoped) {
      // Sidebar-scoped update: scopeRoots = drilled-down dir (baseline),
      // roots = after file filter (current). Only file filter dims languages.
      baseStats = computeStats(message.scopeRoots || message.roots || []);
      currentStats = stats;
    } else {
      // Full workspace scan — base and current are the same.
      baseStats = stats;
      currentStats = stats;
    }
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

// Skeleton is pre-rendered in the HTML for instant paint.
