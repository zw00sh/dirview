// @ts-check
// Shared utility functions for dirview webviews.
// Exposes window._DirviewUtils — loaded after shared-icons.js.
(function () {
  'use strict';

  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    if (bytes === 0) { return '0 B'; }
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1024 * 1024) { return Math.round(bytes / 1024) + ' KB'; }
    return Math.round(bytes / (1024 * 1024)) + ' MB';
  }

  // WeakMap caches keyed by the original array reference: Map<mode, sortedArray>.
  // This avoids redundant .slice().sort() on every render for unchanged data.
  const _sortDirsCache = new WeakMap();
  const _sortFilesCache = new WeakMap();

  function sortDirs(dirs, mode) {
    if (!dirs.length) { return dirs; }
    let byMode = _sortDirsCache.get(dirs);
    if (byMode && byMode.has(mode)) { return byMode.get(mode); }
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

  function sortFiles(files) {
    if (!files.length) { return files; }
    const cached = _sortFilesCache.get(files);
    if (cached) { return cached; }
    const copy = files.slice();
    copy.sort((a, b) => a.name.localeCompare(b.name));
    _sortFilesCache.set(files, copy);
    return copy;
  }

  // Simple reference-equality cache: avoids redundant full-tree walks on filter/sort/expand.
  let _maxMetricCache = { roots: null, sortMode: null, includeRoots: false, value: 1 };

  // Computes the max metric value across the tree for bar scaling.
  // When includeRoots is false (default), skips root nodes so they always render at 100%.
  // When includeRoots is true (tab showRootNode mode), includes roots so bars scale relative to them.
  function computeMaxMetric(roots, sortMode, includeRoots) {
    if (_maxMetricCache.roots === roots && _maxMetricCache.sortMode === sortMode && _maxMetricCache.includeRoots === !!includeRoots) {
      return _maxMetricCache.value;
    }
    let max = 0;
    function walk(node) {
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
  const _groupEmptyDirsCache = new WeakMap();

  // Groups consecutive empty-dir siblings (totalFiles === 0) into {type:'emptyGroup', nodes:[]}
  function groupEmptyDirs(children) {
    if (_groupEmptyDirsCache.has(children)) { return _groupEmptyDirsCache.get(children); }
    const result = [];
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
  function createScanBar() {
    const el = document.createElement('div');
    el.className = 'scan-progress';
    document.body.insertBefore(el, document.body.firstChild);
    return {
      show(active) {
        el.className = 'scan-progress' + (active ? ' active' : '');
      },
    };
  }

  // Creates and appends the shared bar hover tooltip element.
  function createTooltip() {
    const el = document.createElement('div');
    el.className = 'bar-tooltip';
    document.body.appendChild(el);
    return el;
  }

  // Returns the node that renderDirNode would use as displayNode for the given node —
  // i.e. follows the compact-folder chain (single child dir, no files) to its deepest node.
  function compactedNode(node) {
    let cur = node;
    while (cur.children.length === 1 && (cur.files || []).length === 0) {
      cur = cur.children[0];
    }
    return cur;
  }

  function compactedPath(node) {
    return compactedNode(node).path;
  }

  // Returns true if any of node's descendants are expanded.
  function hasExpandedDescendant(state, node) {
    for (const child of (node.children || [])) {
      const cn = compactedNode(child);
      if (state.expanded.get(cn.path)) return true;
      if (hasExpandedDescendant(state, cn)) return true;
    }
    return false;
  }

  // Simple reference-equality cache for computeStats — avoids re-aggregating on every render.
  let _computeStatsCache = { roots: null, value: null };

  // Aggregate language stats from root nodes. Shared between tab.js and languagesProvider.ts.
  function computeStats(roots) {
    if (_computeStatsCache.roots === roots) { return _computeStatsCache.value; }
    const counts = new Map();
    let total = 0;
    for (const r of roots) {
      for (const s of r.stats) {
        const ex = counts.get(s.name);
        if (ex) { ex.count += s.count; } else { counts.set(s.name, { color: s.color, count: s.count }); }
      }
      total += r.totalFiles;
    }
    const value = Array.from(counts.entries())
      .map(([name, { color, count }]) => ({ name, color, count, pct: total > 0 ? ((count / total) * 100).toFixed(1) : '0' }))
      .sort((a, b) => b.count - a.count);
    _computeStatsCache = { roots, value };
    return value;
  }

  // Render a filterable language legend into a container element.
  // showPct: when true, displays percentage instead of raw file count.
  // Returns nothing; mutates legendEl in-place.
  function renderLegend(legendEl, stats, activeFilters, onToggle, showPct) {
    legendEl.innerHTML = '';
    const items = document.createElement('div');
    items.className = 'legend-items';

    // Delegated click handler — one listener on the container instead of per-item.
    items.addEventListener('click', (e) => {
      const item = e.target.closest('.legend-item[data-lang]');
      if (item) { onToggle(item.dataset.lang); }
    });

    for (const lang of stats) {
      const isActive = activeFilters.has(lang.name);
      const isInactive = activeFilters.size > 0 && !isActive;
      const item = document.createElement('div');
      item.className = 'legend-item' + (isActive ? ' active' : '') + (isInactive ? ' inactive' : '');
      item.dataset.lang = lang.name;
      const displayValue = showPct ? lang.pct + '%' : lang.count;
      item.innerHTML =
        `<span class="legend-swatch" style="background:${lang.color}"></span>` +
        `<span class="legend-name">${escHtml(lang.name)}</span>` +
        `<span class="legend-count">${displayValue}</span>`;
      items.appendChild(item);
    }
    legendEl.appendChild(items);
  }

  // Filter helpers — shared by renderDirNode and renderRoots.
  // searchResults and searchMatchFn are optional; omit them for callers that don't need search filtering.
  function getVisibleChildren(sortedChildren, activeFilters, matchFn, searchResults, searchMatchFn) {
    let dirs = sortedChildren;
    if (activeFilters.size > 0) { dirs = dirs.filter(matchFn); }
    if (searchResults && searchMatchFn) { dirs = dirs.filter(searchMatchFn); }
    return dirs;
  }
  function getVisibleFiles(sortedFiles, activeFilters, searchResults) {
    let files = sortedFiles;
    if (activeFilters.size > 0) { files = files.filter(f => activeFilters.has(f.langName)); }
    if (searchResults) { files = files.filter(f => searchResults.has(f.path)); }
    return files;
  }

  // Computes the bar width in pixels for a proportional bar.
  // Deduplicates identical computation previously in renderDirNode and renderTruncatedRow.
  function computeBarWidth(pct, clientWidth, rootEl, opts) {
    const cw = clientWidth || rootEl.clientWidth || opts.barFallbackWidth || 300;
    const maxBarWidth = Math.min(cw * (opts.barFactor || 0.4), opts.barMaxWidth || 200);
    const minBarWidth = opts.barMinWidth || 12;
    return Math.max((opts.barSqrt ? Math.sqrt(pct) : pct) * maxBarWidth, minBarWidth);
  }

  window._DirviewUtils = {
    escHtml, formatBytes, sortDirs, sortFiles, computeMaxMetric, groupEmptyDirs,
    createScanBar, createTooltip,
    compactedNode, compactedPath, hasExpandedDescendant,
    computeStats, renderLegend,
    getVisibleChildren, getVisibleFiles,
    computeBarWidth,
  };
})();
