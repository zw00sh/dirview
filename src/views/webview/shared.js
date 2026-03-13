// @ts-check
// Shared utilities for dirview webviews (main.js and tab.js).
// Exposes window.DirviewShared — must be loaded before main.js / tab.js / languages.js.
(function () {
  'use strict';

  // Codicon SVG constants (MIT licensed, microsoft/vscode-codicons)
  const SVG_CHEVRON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M6.146 3.146a.5.5 0 0 0 0 .707l4.146 4.146-4.146 4.146a.5.5 0 0 0 .707.707l4.5-4.5a.5.5 0 0 0 0-.707l-4.5-4.5a.5.5 0 0 0-.707 0Z"/></svg>';
  const SVG_PLUS = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 1.5C8 1.22386 7.77614 1 7.5 1C7.22386 1 7 1.22386 7 1.5V7H1.5C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H7V13.5C7 13.7761 7.22386 14 7.5 14C7.77614 14 8 13.7761 8 13.5V8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H8V1.5Z"/></svg>';
  const SVG_WARNING = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.72L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4H7.375z"/></svg>';

  // Toolbar icons
  const SVG_EYE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2.984 8.625v.003a.5.5 0 0 1-.612.355c-.431-.114-.355-.611-.355-.611l.018-.062s.026-.084.047-.145a6.7 6.7 0 0 1 1.117-1.982C4.096 5.089 5.605 4 8 4s3.904 1.089 4.802 2.183a6.7 6.7 0 0 1 1.117 1.982 4.077 4.077 0 0 1 .06.187l.003.013v.004l.001.002a.5.5 0 0 1-.966.258l-.001-.004-.008-.025a4.872 4.872 0 0 0-.2-.52 5.696 5.696 0 0 0-.78-1.263C11.286 5.912 10.044 5 8 5c-2.044 0-3.285.912-4.028 1.817a5.7 5.7 0 0 0-.945 1.674 3.018 3.018 0 0 0-.035.109l-.008.025ZM8 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 9.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"/></svg>';
  const SVG_EYE_CLOSED = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="m10.12 10.827 4.026 4.027a.5.5 0 0 0 .708-.708l-13-13a.5.5 0 1 0-.708.708l3.23 3.23A5.987 5.987 0 0 0 3.2 6.182a6.7 6.7 0 0 0-1.117 1.982c-.021.061-.047.145-.047.145l-.018.062s-.076.497.355.611a.5.5 0 0 0 .611-.355l.001-.003.008-.025.035-.109a5.7 5.7 0 0 1 .945-1.674 4.94 4.94 0 0 1 1.124-1.014l1.578 1.578a2.5 2.5 0 1 0 3.446 3.446Zm-.74-.74A1.5 1.5 0 1 1 7.413 8.12l1.969 1.968ZM6.32 4.2l.854.854C7.434 5.019 7.709 5 8 5c2.044 0 3.286.912 4.028 1.817a5.695 5.695 0 0 1 .945 1.674c.017.048.028.085.035.109l.008.025v.003l.001.001a.5.5 0 0 0 .966-.257v-.003l-.001-.004-.004-.013a2.3 2.3 0 0 0-.06-.187 6.7 6.7 0 0 0-1.117-1.982C11.905 5.088 10.396 4 8.002 4c-.618 0-1.177.072-1.681.199Z"/></svg>';
  const SVG_FOLD = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11.8536 3.35355L8.35355 6.85355C8.15829 7.04882 7.84171 7.04882 7.64645 6.85355L4.14645 3.35355C3.95118 3.15829 3.95118 2.84171 4.14645 2.64645C4.34171 2.45118 4.65829 2.45118 4.85355 2.64645L8 5.79289L11.1464 2.64645C11.3417 2.45118 11.6583 2.45118 11.8536 2.64645C12.0488 2.84171 12.0488 3.15829 11.8536 3.35355ZM11.8536 12.6464L8.35355 9.14645C8.15829 8.95118 7.84171 8.95118 7.64645 9.14645L4.14645 12.6464C3.95118 12.8417 3.95118 13.1583 4.14645 13.3536C4.34171 13.5488 4.65829 13.5488 4.85355 13.3536L8 10.2071L11.1464 13.3536C11.3417 13.5488 11.6583 13.5488 11.8536 13.3536C12.0488 13.1583 12.0488 12.8417 11.8536 12.6464Z"/></svg>';
  const SVG_UNFOLD = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11.854 10.146C12.049 10.341 12.049 10.658 11.854 10.853L8.35401 14.353C8.15901 14.548 7.84201 14.548 7.64701 14.353L4.14701 10.853C3.95201 10.658 3.95201 10.341 4.14701 10.146C4.34201 9.95098 4.65901 9.95098 4.85401 10.146L8.00001 13.293L11.146 10.146C11.341 9.95098 11.658 9.95098 11.853 10.146H11.854ZM4.85401 5.85398L8.00001 2.70798L11.146 5.85398C11.341 6.04898 11.658 6.04898 11.853 5.85398C12.048 5.65898 12.048 5.34198 11.853 5.14698L8.35301 1.64698C8.15801 1.45198 7.84101 1.45198 7.64601 1.64698L4.14601 5.14698C3.95101 5.34198 3.95101 5.65898 4.14601 5.85398C4.34101 6.04898 4.65901 6.04898 4.85401 5.85398Z"/></svg>';
  const SVG_EXPAND_ALL = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 6v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27c.6.35 1 .99 1 1.73Zm-4 7H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2Zm-7-1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1Zm5.5-5H8V5.5a.5.5 0 0 0-1 0V7H5.5a.5.5 0 0 0 0 1H7v1.5a.5.5 0 0 0 1 0V8h1.5a.5.5 0 0 0 0-1Z"/></svg>';
  const SVG_COLLAPSE_ALL = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M14 4.27c.6.35 1 .99 1 1.73v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27ZM9.5 7a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1h4Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11 2c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7ZM4 3c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4Z"/></svg>';
  const SVG_TARGET = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8zm7-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 8a4 4 0 1 1 8 0 4 4 0 0 1-8 0zm4-1a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>';
  // Open-in-tab icon: box with arrow indicating "open in a new editor tab"
  const SVG_OPEN_IN_TAB = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M3 3h4v1H4v8h8V8h1v4.5l-.5.5h-9l-.5-.5v-9L3 3zm8-1h3.5l.5.5v3.5h-1V3.707L9.854 7.854 9.146 7.146 13.293 3H11V2z"/></svg>';

  // Sort mode icons (codicons: list-ordered, case-sensitive, database)
  const SVG_SORT_FILES = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M3.684 1.01c.193.045.33.21.33.402v3.294a.42.42 0 0 1-.428.412.42.42 0 0 1-.428-.412V2.58a3.11 3.11 0 0 1-.664.435.436.436 0 0 1-.574-.184.405.405 0 0 1 .192-.552c.353-.17.629-.432.82-.661a2.884 2.884 0 0 0 .27-.388.44.44 0 0 1 .482-.22Zm-1.53 6.046a.401.401 0 0 1 0-.582l.002-.001V6.47l.004-.002.008-.008a1.12 1.12 0 0 1 .103-.084 2.2 2.2 0 0 1 1.313-.435h.007c.32.004.668.084.947.283.295.21.485.536.485.951 0 .452-.207.767-.488.992-.214.173-.49.303-.714.409-.036.016-.07.033-.103.049-.267.128-.468.24-.61.39a.763.763 0 0 0-.147.22h1.635a.42.42 0 0 1 .427.411.42.42 0 0 1-.428.412H2.457a.42.42 0 0 1-.428-.412c0-.51.17-.893.446-1.184.259-.275.592-.445.86-.574.043-.02.085-.04.124-.06.231-.11.4-.19.529-.293.12-.097.18-.193.18-.36 0-.148-.057-.23-.14-.289a.816.816 0 0 0-.448-.122 1.32 1.32 0 0 0-.818.289l-.005.005a.44.44 0 0 1-.602-.003Zm.94 5.885a.42.42 0 0 1 .427-.412c.294 0 .456-.08.537-.15a.303.303 0 0 0 .11-.246c-.006-.16-.158-.427-.647-.427-.352 0-.535.084-.618.137a.349.349 0 0 0-.076.062l-.003.004a.435.435 0 0 0 .01-.018v.001l-.002.002-.002.004-.003.006-.005.008.002-.003a.436.436 0 0 1-.563.165.405.405 0 0 1-.191-.552v-.002l.002-.003.003-.006.008-.013a.71.71 0 0 1 .087-.12c.058-.067.142-.146.259-.22.238-.153.59-.276 1.092-.276.88 0 1.477.556 1.502 1.22.012.303-.1.606-.339.84.238.232.351.535.34.838-.026.664-.622 1.22-1.503 1.22-.502 0-.854-.122-1.092-.275a1.19 1.19 0 0 1-.326-.308.71.71 0 0 1-.02-.033l-.008-.013-.003-.005-.001-.003v-.001l-.001-.001a.405.405 0 0 1 .19-.553.436.436 0 0 1 .564.165l.003.004c.01.01.033.035.076.063.083.053.266.137.618.137.489 0 .641-.268.648-.428a.303.303 0 0 0-.11-.245c-.082-.072-.244-.151-.538-.151a.42.42 0 0 1-.427-.412ZM7.5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-6Zm0 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-6Zm0 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-6Z"/></svg>';
  const SVG_SORT_NAME = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.02602 3.34176C4.16218 2.93404 4.83818 2.93398 4.97426 3.34176L6.97426 9.34274C6.97526 9.34674 6.97817 9.35544 6.97817 9.35544L7.97426 12.3427C8.06126 12.6047 7.91984 12.8875 7.65786 12.9756C7.60486 12.9926 7.55165 13.0009 7.49965 13.0009C7.29082 13.0008 7.09602 12.868 7.02602 12.6591L6.14028 10.0009H2.86L1.97426 12.6591C1.88728 12.919 1.60634 13.0634 1.34243 12.9746C1.08043 12.8866 0.93902 12.6038 1.02602 12.3418L2.02211 9.35544C2.02311 9.35144 2.02602 9.34274 2.02602 9.34274L4.02602 3.34176ZM3.19399 8.99997H5.80629L4.49965 5.08102L3.19399 8.99997Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.8581 6.66794C13.165 6.73296 13.9427 7.48427 13.9967 8.69626L13.9997 8.83297V12.5078C13.9957 12.7568 13.809 12.9621 13.568 12.9951L13.4997 13C13.2469 12.9998 13.0376 12.8121 13.0045 12.5683L12.9997 12.5V12.4297C12.3407 12.8066 11.7316 13 11.1666 13C9.94081 12.9998 8.99965 12.1369 8.99965 10.833C8.99967 9.68299 9.79211 8.82889 11.1061 8.66989C11.7279 8.59493 12.3589 8.64164 12.9987 8.80954C12.9915 8.07194 12.6279 7.70704 11.8082 7.66598C11.1672 7.63398 10.7158 7.72415 10.4518 7.90915C10.2258 8.06799 9.91347 8.01301 9.75551 7.78708C9.59671 7.56115 9.65178 7.24878 9.87758 7.09079C10.3165 6.78283 10.9138 6.64715 11.6666 6.6611L11.8581 6.66794ZM12.7965 9.8154C12.2587 9.66749 11.7361 9.62551 11.2262 9.68747C10.4042 9.78747 9.99868 10.2244 9.99868 10.8574C9.99884 11.5881 10.474 12.0242 11.1657 12.0244C11.6196 12.0244 12.1777 11.8137 12.8336 11.3818L12.9987 11.2695V9.87594L12.7965 9.8154Z"/></svg>';
  const SVG_SORT_SIZE = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 1C5.149 1 3 2.075 3 3.5V12.5C3 13.925 5.149 15 8 15C10.851 15 13 13.925 13 12.5V3.5C13 2.075 10.851 1 8 1ZM8 2C10.441 2 12 2.888 12 3.5C12 4.112 10.441 5 8 5C5.559 5 4 4.112 4 3.5C4 2.888 5.558 2 8 2ZM8 14C5.558 14 4 13.111 4 12.5V5.021C5.21405 5.71872 6.60095 6.05816 8 6C9.39905 6.05816 10.7859 5.71872 12 5.021V12.5C12 13.111 10.441 14 8 14Z"/></svg>';

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

  // Creates render helpers bound to a mutable state object.
  //
  // state: {
  //   activeFilters: Set, expanded: Map, truncationExpanded: Set,
  //   emptyGroupExpanded: Set, truncateThreshold: number,
  //   currentSortMode: string, lastRoots: array|null,
  //   lastAutoRescanEnabled: boolean, render: function|null
  // }
  //
  // deps: {
  //   vscode: object, root: HTMLElement, tooltip: HTMLElement,
  //   options: {
  //     skipDepthZeroGuides: boolean,  // true=sidebar, false=tab
  //     barFactor: number,             // fraction of clientWidth for max bar
  //     barMaxWidth: number,           // absolute max bar width (px)
  //     barFallbackWidth: number,      // fallback when clientWidth is 0
  //   }
  // }
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

  function createRenderer(state, deps) {
    const { vscode, root, tooltip } = deps;
    const opts = deps.options || {};

    // Map from displayNode.path → { node: DirNode, hasChildren: boolean }.
    // Populated during renderDirNode calls; cleared by beforeRender() at the start of
    // each full re-render. Used by delegated event handlers to avoid per-element closures.
    const nodeMap = new Map();

    // ── Delegated event handlers ─────────────────────────────────────────────
    //
    // Instead of attaching 3–6 listeners to each rendered row, we use three delegated
    // handlers on the root container (plus the existing capture-phase guide highlighters).
    // This eliminates thousands of closure allocations and GC cycles per render on large trees.

    // Delegated mouseenter/mouseleave for indent guide hover highlighting.
    // Using capture phase so mouseenter/mouseleave fire for all descendants.
    root.addEventListener('mouseenter', (e) => {
      const guide = e.target.closest('.indent-guide[data-guide-path]');
      if (!guide) { return; }
      const path = guide.dataset.guidePath;
      document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(path)}"]`)
        .forEach(el => el.classList.add('hovered'));
    }, true);
    root.addEventListener('mouseleave', (e) => {
      const guide = e.target.closest('.indent-guide[data-guide-path]');
      if (!guide) { return; }
      const path = guide.dataset.guidePath;
      document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(path)}"]`)
        .forEach(el => el.classList.remove('hovered'));
    }, true);

    // Delegated click: handles guide collapse, dir-action buttons, dir row toggle, file open.
    root.addEventListener('click', (e) => {
      // Action elements (buttons, guide spans) take priority — check them first so they
      // don't also trigger the parent dir-row toggle.
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.dataset.action;
        const path = actionEl.dataset.path;

        if (action === 'collapseGuide') {
          if (state.activeFilters.size > 0) { return; }
          const guidePath = actionEl.dataset.guidePath;
          if (!guidePath) { return; }
          state.expanded.set(guidePath, false);
          state.rerender();
          return;
        }

        if (action === 'openFile') {
          vscode.postMessage({ command: 'openFile', path });
          return;
        }

        tooltip.style.display = 'none';

        if (action === 'expandDir') {
          const entry = nodeMap.get(path);
          if (!entry) { return; }
          const node = entry.node;
          const isExp = state.expanded.get(node.path);
          if (!isExp) {
            state.expanded.set(node.path, true);
          } else {
            const allDirectChildrenExpanded = node.children.every(child => {
              const cn = compactedNode(child);
              return cn.children.length === 0 || state.expanded.get(cn.path);
            });
            if (allDirectChildrenExpanded) {
              walkExpand(state, node.children);
            } else {
              for (const child of node.children) {
                state.expanded.set(compactedPath(child), true);
              }
            }
          }
          state.rerender();
          return;
        }

        if (action === 'collapseDir') {
          const entry = nodeMap.get(path);
          if (!entry) { return; }
          const node = entry.node;
          if (!state.expanded.get(node.path)) { return; }
          const anyChildExpanded = node.children.some(child => state.expanded.get(compactedPath(child)));
          if (anyChildExpanded) {
            const anyDeeperExpanded = node.children.some(child => {
              const cn = compactedNode(child);
              return hasExpandedDescendant(state, cn);
            });
            if (anyDeeperExpanded) {
              for (const child of node.children) {
                const cn = compactedNode(child);
                walkCollapse(state, cn.children || []);
              }
            } else {
              for (const child of node.children) {
                state.expanded.set(compactedPath(child), false);
              }
            }
          } else {
            state.expanded.set(node.path, false);
          }
          state.rerender();
          return;
        }

        if (action === 'openInTab') {
          vscode.postMessage({ command: 'openDirInTab', path });
          return;
        }

        if (action === 'expandTruncated') {
          const dp = actionEl.dataset.dirPath;
          if (dp != null) {
            state.truncationExpanded.add(dp);
            state.rerender();
          }
          return;
        }

        if (action === 'expandEmptyGroup') {
          const gk = actionEl.dataset.groupKey;
          if (gk != null) {
            state.emptyGroupExpanded.add(gk);
            state.rerender();
          }
          return;
        }

        return;
      }

      // Dir row toggle (expand/collapse) — only when click is not on an action element.
      const dirRow = e.target.closest('.dir-row[data-path]');
      if (dirRow) {
        // Ignore the second click of a double-click. After an action button (e.g. expand)
        // triggers a rerender, the rebuilt dir-row loses hover state so its action buttons
        // become display:none. The second click then lands on the dir-row itself and would
        // toggle the directory back — undoing the action. e.detail >= 2 catches this.
        if (e.detail >= 2) { return; }
        const path = dirRow.dataset.path;
        const entry = nodeMap.get(path);
        if (!entry || !entry.hasChildren) { return; }

        const nowExpanded = !state.expanded.get(path);
        state.expanded.set(path, nowExpanded);

        // Reset truncation when collapsing so it re-truncates on next expand.
        if (!nowExpanded && state.truncationExpanded.has(path)) {
          state.truncationExpanded.delete(path);
          state.rerender();
          return;
        }

        const chevron = dirRow.querySelector('.chevron');
        const childrenEl = dirRow.nextElementSibling;

        // Lazy rendering: if expanding and the children UL is empty (was rendered
        // collapsed), we need a full rerender to populate the children DOM.
        if (nowExpanded && childrenEl && !childrenEl.firstChild) {
          state.rerender();
          if (deps.onExpandChanged) {
            deps.onExpandChanged([...state.expanded.values()].some(v => v));
          }
          return;
        }

        if (chevron) { chevron.className = 'chevron' + (nowExpanded ? ' open' : ''); }
        if (childrenEl) { childrenEl.className = 'children' + (nowExpanded ? ' open' : ''); }

        if (deps.onExpandChanged) {
          deps.onExpandChanged([...state.expanded.values()].some(v => v));
        }
      }
    });

    // Delegated tooltip: show on mouseover a dir-row, hide on mouseout.
    // Using mouseover/mouseout (bubbling) instead of per-row mouseenter/mouseleave.
    root.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.dir-row[data-path]');
      if (!row) { return; }
      // Avoid re-triggering when moving between child elements of the same row.
      if (e.relatedTarget && row.contains(e.relatedTarget)) { return; }

      const path = row.dataset.path;
      const entry = nodeMap.get(path);
      if (!entry || !entry.node.totalFiles) { tooltip.style.display = 'none'; return; }

      const node = entry.node;
      // Populate tooltip content.
      tooltip.innerHTML = '';
      const total = node.totalFiles;
      for (const s of node.stats) {
        const segPct = (s.count / total) * 100;
        const tRow = document.createElement('div');
        tRow.className = 'bar-tooltip-row';
        tRow.innerHTML =
          `<span class="bar-tooltip-swatch" style="background:${s.color}"></span>` +
          `<span class="bar-tooltip-name">${escHtml(s.name)}</span>` +
          `<span class="bar-tooltip-pct">${segPct.toFixed(1).replace(/\.0$/, '')}%</span>` +
          `<span class="bar-tooltip-count">${s.count} file${s.count !== 1 ? 's' : ''}</span>`;
        tooltip.appendChild(tRow);
      }

      // --- Read phase (batch before writes) ---
      const bar = row.querySelector('.bar');
      if (!bar) { return; }
      const rect = bar.getBoundingClientRect();
      const vpWidth = document.documentElement.clientWidth;
      const wh = window.innerHeight;

      // --- Write phase: initial position + show ---
      const initLeft = rect.left;
      const initTop = rect.bottom + 4;
      tooltip.style.left = initLeft + 'px';
      tooltip.style.top = initTop + 'px';
      tooltip.style.display = 'block';

      // --- Deferred adjustment: read tooltip rect in next frame to avoid layout thrash ---
      requestAnimationFrame(() => {
        if (tooltip.style.display === 'none') { return; }
        const tRect = tooltip.getBoundingClientRect();
        let newLeft = initLeft, newTop = initTop, changed = false;
        if (tRect.bottom > wh) { newTop = rect.top - tRect.height - 4; changed = true; }
        if (tRect.right > vpWidth - 4) { newLeft = Math.max(4, vpWidth - tRect.width - 4); changed = true; }
        if (changed) { tooltip.style.left = newLeft + 'px'; tooltip.style.top = newTop + 'px'; }
      });
    });

    root.addEventListener('mouseout', (e) => {
      const row = e.target.closest('.dir-row[data-path]');
      if (row && !row.contains(e.relatedTarget)) {
        tooltip.style.display = 'none';
      }
    });

    // Hide tooltip when the tree scrolls (rows move away from the cursor without firing mouseout).
    root.addEventListener('scroll', () => { tooltip.style.display = 'none'; }, { passive: true });

    function dirMatchesFilter(node) {
      if (state.activeFilters.size === 0) { return true; }
      return node.stats.some(s => state.activeFilters.has(s.name) && s.count > 0);
    }

    function renderIndentGuides(depth, ancestors) {
      const container = document.createElement('span');
      container.className = 'indent-guides';
      for (let i = 0; i < depth; i++) {
        const guide = document.createElement('span');
        guide.className = 'indent-guide';
        const ancestor = ancestors[i];
        if (ancestor) {
          guide.dataset.guidePath = ancestor.path;
          // data-action enables the delegated click handler in createRenderer.
          guide.dataset.action = 'collapseGuide';
        }
        container.appendChild(guide);
      }
      return container;
    }

    function renderFileNode(file, depth, ancestors) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'file-row clickable';
      // data-action + data-path enable the delegated click handler in createRenderer.
      row.dataset.action = 'openFile';
      row.dataset.path = file.path;
      row.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'file',
        path: file.path,
        preventDefaultContextMenuItems: true
      }));
      row.appendChild(renderIndentGuides(depth, ancestors));

      const dotSlot = document.createElement('span');
      dotSlot.className = 'chevron';
      const leftDot = document.createElement('span');
      leftDot.className = 'file-dot';
      leftDot.style.backgroundColor = file.langColor;
      leftDot.title = file.langName;
      dotSlot.appendChild(leftDot);
      row.appendChild(dotSlot);

      const nameEl = document.createElement('span');
      nameEl.className = 'file-name';
      nameEl.textContent = file.name;
      nameEl.title = file.path;
      row.appendChild(nameEl);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      const rightDot = document.createElement('span');
      rightDot.className = 'file-dot';
      rightDot.style.backgroundColor = file.langColor;
      rightDot.title = file.langName;
      row.appendChild(rightDot);

      if (!opts.hideCounts) {
        const sizeEl = document.createElement('span');
        sizeEl.className = 'file-count';
        sizeEl.textContent = file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : '';
        row.appendChild(sizeEl);
      }

      li.appendChild(row);
      return li;
    }

    function renderTruncatedRow(hiddenFiles, depth, ancestors, dirPath, maxMetric, clientWidth) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'dir-row truncated-row';
      row.dataset.action = 'expandTruncated';
      row.dataset.dirPath = dirPath;
      // Use a synthetic path so the delegated tooltip handler can look up this row's stats.
      const truncKey = dirPath + '\0truncated';
      row.dataset.path = truncKey;
      row.appendChild(renderIndentGuides(depth, ancestors));

      const slot = document.createElement('span');
      slot.className = 'chevron';
      slot.innerHTML = SVG_PLUS;
      row.appendChild(slot);

      // Colored dots for unique language types among hidden files
      const langMap = new Map();
      for (const f of hiddenFiles) {
        if (f.langName) {
          const ex = langMap.get(f.langName);
          if (ex) { ex.count++; } else { langMap.set(f.langName, { color: f.langColor, count: 1 }); }
        }
      }
      const langs = Array.from(langMap.entries()).sort((a, b) => b[1].count - a[1].count);

      // Register synthetic node for tooltip hover
      nodeMap.set(truncKey, {
        node: {
          totalFiles: hiddenFiles.length,
          stats: langs.map(([name, { color, count }]) => ({ name, color, count })),
        },
        hasChildren: false,
      });

      const dotsEl = document.createElement('span');
      dotsEl.className = 'truncated-dots';
      for (const [langName, { color }] of langs.slice(0, 5)) {
        const dot = document.createElement('span');
        dot.className = 'file-dot';
        dot.style.backgroundColor = color;
        dot.title = langName;
        dotsEl.appendChild(dot);
      }
      row.appendChild(dotsEl);

      const label = document.createElement('span');
      label.className = 'dir-name';
      label.textContent = `${hiddenFiles.length} more file${hiddenFiles.length !== 1 ? 's' : ''}`;
      row.appendChild(label);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      // Proportional bar showing language makeup of hidden files
      if (langs.length > 0 && maxMetric > 0) {
        const totalCount = hiddenFiles.length;
        const totalBytes = hiddenFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0);
        const metric = state.currentSortMode === 'size' ? totalBytes : totalCount;
        const pct = metric / maxMetric;
        const cw = clientWidth || root.clientWidth || opts.barFallbackWidth || 300;
        const maxBarWidth = Math.min(cw * (opts.barFactor || 0.4), opts.barMaxWidth || 200);
        const minBarWidth = opts.barMinWidth || 12;
        const barWrapWidth = Math.max((opts.barSqrt ? Math.sqrt(pct) : pct) * maxBarWidth, minBarWidth);

        const barWrap = document.createElement('div');
        barWrap.className = 'bar-wrap';
        barWrap.style.width = barWrapWidth + 'px';

        const bar = document.createElement('div');
        bar.className = 'bar';

        for (const [, { color, count }] of langs) {
          const segPct = (count / totalCount) * 100;
          const seg = document.createElement('div');
          seg.className = 'bar-segment';
          seg.style.width = segPct + '%';
          seg.style.backgroundColor = color;
          bar.appendChild(seg);
        }

        barWrap.appendChild(bar);
        row.appendChild(barWrap);
      }

      // Right column: file count or size depending on sort mode
      if (!opts.hideCounts) {
        const totalBytes = hiddenFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0);
        const metaEl = document.createElement('span');
        metaEl.className = 'file-count';
        if (state.currentSortMode === 'size') {
          metaEl.textContent = totalBytes > 0 ? formatBytes(totalBytes) : '';
          metaEl.title = hiddenFiles.length + ' files';
        } else {
          metaEl.textContent = String(hiddenFiles.length);
          metaEl.title = totalBytes > 0 ? formatBytes(totalBytes) : '';
        }
        row.appendChild(metaEl);
      }

      li.appendChild(row);
      return li;
    }

    function renderEmptyGroupNode(nodes, depth, maxMetric, ancestors) {
      const li = document.createElement('li');
      const groupKey = nodes[0].path;

      const row = document.createElement('div');
      row.className = 'dir-row empty-group-row';
      row.dataset.action = 'expandEmptyGroup';
      row.dataset.groupKey = groupKey;
      row.appendChild(renderIndentGuides(depth, ancestors));

      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.innerHTML = SVG_PLUS;
      row.appendChild(chevron);

      const label = document.createElement('span');
      label.className = 'dir-name';
      label.textContent = `${nodes.length} empty director${nodes.length !== 1 ? 'ies' : 'y'}`;
      row.appendChild(label);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      // Always show "—" for empty group rows (visual alignment with other rows)
      const metaEl = document.createElement('span');
      metaEl.className = 'file-count';
      metaEl.textContent = '—';
      metaEl.style.opacity = '0.5';
      row.appendChild(metaEl);

      li.appendChild(row);

      return li;
    }

    function renderDirNode(node, depth, maxMetric, ancestors, clientWidth) {
      const li = document.createElement('li');

      // Compact folders: collapse chain of dirs with exactly 1 child dir and 0 files.
      // Skip sortDirs inside the loop — single-child arrays don't need sorting.
      let displayNode = node;
      let displayName = node.name;
      const compactSegments = [{ name: node.name, path: node.path }];
      while (true) {
        const children = displayNode.children;
        const files = displayNode.files || [];
        const vChildren = state.activeFilters.size > 0
          ? children.filter(c => dirMatchesFilter(c))
          : children;
        const vFiles = state.activeFilters.size > 0
          ? files.filter(f => state.activeFilters.has(f.langName))
          : files;
        if (vChildren.length === 1 && vFiles.length === 0) {
          displayName += ' / ' + vChildren[0].name;
          compactSegments.push({ name: vChildren[0].name, path: vChildren[0].path });
          displayNode = vChildren[0];
        } else {
          break;
        }
      }

      // data-node-path enables incremental DOM patching in renderTree.
      // Must use displayNode.path (post-compaction) so it matches the key
      // used by nodeMap, state.expanded, and the dir-row's data-path attribute.
      li.dataset.nodePath = displayNode.path;

      const isExpanded = state.expanded.get(displayNode.path) ?? (state.activeFilters.size > 0 || depth === 0);
      // Record implicit depth-0 expansion so button state reflects reality after initial render
      if (!state.expanded.has(displayNode.path) && depth === 0 && state.activeFilters.size === 0) {
        state.expanded.set(displayNode.path, true);
      }

      const sortedChildren = sortDirs(displayNode.children, state.currentSortMode);
      const sortedFiles = sortFiles(displayNode.files || []);

      // Apply language filter
      const visibleChildren = getVisibleChildren(sortedChildren, state.activeFilters, dirMatchesFilter);
      const visibleFiles = getVisibleFiles(sortedFiles, state.activeFilters);

      const hasChildren = visibleChildren.length > 0 || visibleFiles.length > 0;

      // Dir row
      const row = document.createElement('div');
      row.className = 'dir-row' + (displayNode.totalFiles === 0 ? ' empty-dir' : '');
      row.setAttribute('data-path', displayNode.path);
      row.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'directory',
        path: displayNode.path,
        rootName: state.workspaceFolderName || state.currentRootName,
        preventDefaultContextMenuItems: true
      }));

      // skipDepthZeroGuides=true (sidebar): omit the empty indent-guides container at depth 0
      if (!opts.skipDepthZeroGuides || depth > 0) {
        row.appendChild(renderIndentGuides(depth, ancestors));
      }

      // Chevron
      const chevron = document.createElement('span');
      chevron.className = 'chevron' + (hasChildren ? (isExpanded ? ' open' : '') : ' leaf');
      chevron.innerHTML = SVG_CHEVRON;
      row.appendChild(chevron);

      // Name — for compacted paths, render each segment separately with dimmed separators
      // and per-segment data-vscode-context for RMB "copy path" etc on individual segments.
      const nameEl = document.createElement('span');
      nameEl.className = 'dir-name';
      nameEl.title = displayNode.path || displayName;

      if (compactSegments.length === 1) {
        nameEl.textContent = compactSegments[0].name;
      } else {
        for (let i = 0; i < compactSegments.length; i++) {
          if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'path-sep';
            sep.textContent = ' / ';
            nameEl.appendChild(sep);
          }
          const seg = document.createElement('span');
          seg.className = 'path-segment';
          seg.textContent = compactSegments[i].name;
          seg.setAttribute('data-vscode-context', JSON.stringify({
            webviewSection: 'directory',
            path: compactSegments[i].path,
            rootName: state.workspaceFolderName || state.currentRootName,
            preventDefaultContextMenuItems: true,
          }));
          nameEl.appendChild(seg);
        }
      }

      row.appendChild(nameEl);

      // Flex spacer pushes bar + count to the right
      const barSpacer = document.createElement('div');
      barSpacer.className = 'bar-spacer';
      row.appendChild(barSpacer);

      // Proportional bar
      if (displayNode.totalFiles > 0) {
        const metric = state.currentSortMode === 'size' ? displayNode.sizeBytes : displayNode.totalFiles;
        const pct = metric / maxMetric;
        const cw = clientWidth || root.clientWidth || opts.barFallbackWidth || 300;
        const maxBarWidth = Math.min(cw * (opts.barFactor || 0.4), opts.barMaxWidth || 200);
        const minBarWidth = opts.barMinWidth || 12;
        const barWrapWidth = Math.max((opts.barSqrt ? Math.sqrt(pct) : pct) * maxBarWidth, minBarWidth);

        const barWrap = document.createElement('div');
        barWrap.className = 'bar-wrap';
        barWrap.style.width = barWrapWidth + 'px';

        const bar = document.createElement('div');
        bar.className = 'bar';

        const total = displayNode.totalFiles;
        for (const s of displayNode.stats) {
          const segPct = (s.count / total) * 100;
          const seg = document.createElement('div');
          seg.className = 'bar-segment';
          seg.style.width = segPct + '%';
          seg.style.backgroundColor = s.color;
          bar.appendChild(seg);
        }

        // Tooltip is now handled by the delegated mouseover/mouseout handler in createRenderer,
        // which looks up node data from nodeMap. No per-element listeners needed.

        barWrap.appendChild(bar);
        row.appendChild(barWrap);
      }

      // Right column: file count or size depending on sort mode.
      // Empty dirs always show "—" for visual alignment, even when hideCounts is set.
      if (!opts.hideCounts || displayNode.totalFiles === 0) {
        const metaEl = document.createElement('span');
        metaEl.className = 'file-count';
        if (displayNode.totalFiles > 0) {
          if (state.currentSortMode === 'size') {
            metaEl.textContent = formatBytes(displayNode.sizeBytes);
            metaEl.title = displayNode.totalFiles + ' files';
          } else {
            metaEl.textContent = String(displayNode.totalFiles);
            metaEl.title = formatBytes(displayNode.sizeBytes);
          }
        } else {
          metaEl.textContent = '—';
          metaEl.style.opacity = '0.5';
        }
        row.appendChild(metaEl);
      }

      // Hover action buttons — overlay on the right (sidebar) or inline after name (tab)
      //
      // Expand uses 3-tier progressive escalation:
      //   1. Target is collapsed → expand target only
      //   2. Target is expanded, not all direct children expanded → expand all direct children
      //   3. Target is expanded, all direct children expanded → recursively expand entire subtree
      //
      // Collapse mirrors expand with 3-tier progressive de-escalation:
      //   1. Any descendant beyond direct children is expanded → collapse those deeper descendants
      //      (direct children stay expanded, giving the user a "flatten to one level" step)
      //   2. Some/all direct children are expanded (no deeper) → collapse all direct children
      //   3. No children are expanded → collapse target itself
      //
      // This design lets the user incrementally drill deeper with repeated expand clicks,
      // and incrementally retreat with repeated collapse clicks, without jarring jumps.
      // Action buttons use data-action + data-path so the delegated click handler
      // in createRenderer can process them without per-element listener closures.
      const actionsEl = document.createElement('div');
      actionsEl.className = 'dir-actions';
      if (displayNode.children.length > 0) {
        const expandBtn = document.createElement('button');
        expandBtn.className = 'dir-action-btn';
        expandBtn.innerHTML = SVG_EXPAND_ALL;
        expandBtn.title = 'Expand children';
        expandBtn.dataset.action = 'expandDir';
        expandBtn.dataset.path = displayNode.path;
        actionsEl.appendChild(expandBtn);

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'dir-action-btn';
        collapseBtn.innerHTML = SVG_COLLAPSE_ALL;
        collapseBtn.title = 'Collapse children';
        collapseBtn.dataset.action = 'collapseDir';
        collapseBtn.dataset.path = displayNode.path;
        actionsEl.appendChild(collapseBtn);
      }
      const focusBtn = document.createElement('button');
      focusBtn.className = 'dir-action-btn';
      focusBtn.innerHTML = SVG_OPEN_IN_TAB;
      focusBtn.title = 'Open in new tab';
      focusBtn.dataset.action = 'openInTab';
      focusBtn.dataset.path = displayNode.path;
      actionsEl.appendChild(focusBtn);
      row.insertBefore(actionsEl, barSpacer);

      // Register this node in nodeMap so the delegated handlers can look it up by path.
      nodeMap.set(displayNode.path, { node: displayNode, hasChildren });

      li.appendChild(row);

      // Children container — lazy: only populate when expanded to avoid building
      // collapsed subtrees during off-screen tree construction for patching.
      if (hasChildren) {
        const childrenEl = document.createElement('ul');
        childrenEl.className = 'children' + (isExpanded ? ' open' : '');

        if (isExpanded) {
          const nextAncestors = [...ancestors, { path: displayNode.path }];

          // Empty dir grouping (only when no filter active)
          if (state.activeFilters.size === 0 && visibleChildren.length > 0) {
            for (const group of groupEmptyDirs(visibleChildren)) {
              if (group.type === 'emptyGroup') {
                if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
                  // Already expanded — render individual dirs
                  for (const n of group.nodes) {
                    childrenEl.appendChild(renderDirNode(n, depth + 1, maxMetric, nextAncestors, clientWidth));
                  }
                } else {
                  childrenEl.appendChild(renderEmptyGroupNode(group.nodes, depth + 1, maxMetric, nextAncestors));
                }
              } else {
                childrenEl.appendChild(renderDirNode(group.node, depth + 1, maxMetric, nextAncestors, clientWidth));
              }
            }
          } else {
            for (const child of visibleChildren) {
              childrenEl.appendChild(renderDirNode(child, depth + 1, maxMetric, nextAncestors, clientWidth));
            }
          }

          // File truncation
          const shouldTruncate = state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(displayNode.path);
          const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
          const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];

          for (const file of shownFiles) {
            childrenEl.appendChild(renderFileNode(file, depth + 1, nextAncestors));
          }
          if (hiddenFiles.length > 0) {
            childrenEl.appendChild(renderTruncatedRow(hiddenFiles, depth + 1, nextAncestors, displayNode.path, maxMetric, clientWidth));
          }
        }
        // When collapsed, childrenEl is left empty — children are rendered lazily on expand.

        li.appendChild(childrenEl);
      }

      return li;
    }

    return {
      // Called at the start of each full renderTree pass to flush stale node references.
      beforeRender() { nodeMap.clear(); },
      dirMatchesFilter, renderIndentGuides, renderFileNode, renderTruncatedRow, renderEmptyGroupNode, renderDirNode,
    };
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
  // Returns nothing; mutates legendEl in-place.
  function renderLegend(legendEl, stats, activeFilters, onToggle) {
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
      item.innerHTML =
        `<span class="legend-swatch" style="background:${lang.color}"></span>` +
        `<span class="legend-name">${escHtml(lang.name)}</span>` +
        `<span class="legend-count">${lang.count}</span>`;
      items.appendChild(item);
    }
    legendEl.appendChild(items);
  }

  // Create a fresh webview state object with default values.
  function createState() {
    const state = {
      activeFilters: new Set(),
      expanded: new Map(),
      truncationExpanded: new Set(),
      emptyGroupExpanded: new Set(),
      truncateThreshold: 4,
      currentSortMode: 'files',
      lastRoots: null,
      lastAutoRescanEnabled: true,
      /** @type {Function|null} */
      render: null,
      /** @type {string} */
      currentRootName: '',
      /** Workspace folder name sent by tabProvider. Empty in sidebar (falls back to currentRootName). */
      workspaceFolderName: '',
    };
    state.scanBar = null;           // Set by main.js / tab.js after creation
    state._rerenderPending = false; // Deduplication flag: collapse rapid calls into one render

    // Convenience shorthand: re-renders with the current roots/flags without re-passing them explicitly.
    // Double rAF: the first frame paints the scan bar as visible; the second
    // frame runs the heavy DOM render.  Without this, show(true) and show(false)
    // both execute before the browser paints, so the bar is never seen.
    state.rerender = () => {
      if (state._rerenderPending) { return; }
      state._rerenderPending = true;
      if (state.scanBar) { state.scanBar.show(true); }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          state._rerenderPending = false;
          state.render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
          if (state.scanBar) { state.scanBar.show(false); }
        });
      });
    };
    return state;
  }

  function walkExpand(state, nodes) {
    for (const n of nodes) {
      state.expanded.set(n.path, true);
      walkExpand(state, n.children || []);
    }
  }

  function walkCollapse(state, nodes) {
    for (const n of nodes) {
      state.expanded.set(n.path, false);
      walkCollapse(state, n.children || []);
    }
  }

  // Tiered expand for the toolbar/sidebar "expand all" button, mirroring per-dir expand button behaviour.
  // Workspace folder nodes (roots) are always-visible containers; their children are the top-level
  // expandable items. The tiers mirror the per-dir button with the virtual workspace root as target:
  // Tier 1: any top-level item not expanded → expand all top-level items
  // Tier 2: all top-level items expanded → recursively expand entire subtree
  function tieredExpandAll(state, roots) {
    const topLevel = roots.flatMap(r => r.children || []);
    if (topLevel.length === 0) { return; }

    const allTopExpanded = topLevel.every(node => {
      const cn = compactedNode(node);
      return cn.children.length === 0 || state.expanded.get(cn.path);
    });

    if (!allTopExpanded) {
      // Tier 1: expand all top-level items that have children
      for (const node of topLevel) {
        if (compactedNode(node).children.length > 0) {
          state.expanded.set(compactedPath(node), true);
        }
      }
      return;
    }

    // Tier 2: recursively expand entire subtree
    walkExpand(state, topLevel);
  }

  // 3-tier collapse for the toolbar/sidebar "collapse all" button, mirroring per-dir collapse button behaviour.
  // Tier 1: any top-level item has expanded descendants → collapse those (keep top-level items open)
  // Tier 2: only top-level items expanded (no deeper descendants) → collapse all top-level items
  // Tier 3: nothing is expanded → no-op
  function tieredCollapseAll(state, roots) {
    const topLevel = roots.flatMap(r => r.children || []);
    if (topLevel.length === 0) { return; }

    const anyTopExpanded = topLevel.some(node => state.expanded.get(compactedPath(node)));
    if (!anyTopExpanded) {
      // Tier 3: nothing to collapse
      return;
    }

    const anyDeeperExpanded = topLevel.some(node => {
      const cn = compactedNode(node);
      return hasExpandedDescendant(state, cn);
    });

    if (anyDeeperExpanded) {
      // Tier 1: collapse everything inside top-level items, keep top-level itself open
      for (const node of topLevel) {
        const cn = compactedNode(node);
        walkCollapse(state, cn.children || []);
      }
    } else {
      // Tier 2: collapse all top-level items
      for (const node of topLevel) {
        state.expanded.set(compactedPath(node), false);
      }
    }
  }

  // Filter helpers — shared by renderDirNode and renderRoots.
  function getVisibleChildren(sortedChildren, activeFilters, matchFn) {
    return activeFilters.size > 0 ? sortedChildren.filter(matchFn) : sortedChildren;
  }
  function getVisibleFiles(sortedFiles, activeFilters) {
    return activeFilters.size > 0 ? sortedFiles.filter(f => activeFilters.has(f.langName)) : sortedFiles;
  }

  // Renders the root-level tree rows into treeEl. Shared between sidebar and tab views.
  // Requires state.lastRoots to be set.
  function renderRoots(renderer, state, treeEl, maxMetric, clientWidth) {
    const roots = state.lastRoots;

    for (const r of roots) {
      state.currentRootName = r.name;
      if (roots.length > 1) {
        const header = document.createElement('li');
        header.className = 'workspace-root-header';
        header.textContent = r.name;
        treeEl.appendChild(header);
      }
      const sortedChildren = sortDirs(r.children, state.currentSortMode);
      const sortedFiles = sortFiles(r.files || []);
      const visibleChildren = getVisibleChildren(sortedChildren, state.activeFilters, c => renderer.dirMatchesFilter(c));
      const visibleFiles = getVisibleFiles(sortedFiles, state.activeFilters);
      if (state.activeFilters.size === 0 && visibleChildren.length > 0) {
        for (const group of groupEmptyDirs(visibleChildren)) {
          if (group.type === 'emptyGroup') {
            if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
              for (const n of group.nodes) { treeEl.appendChild(renderer.renderDirNode(n, 0, maxMetric, [], clientWidth)); }
            } else {
              treeEl.appendChild(renderer.renderEmptyGroupNode(group.nodes, 0, maxMetric, []));
            }
          } else {
            treeEl.appendChild(renderer.renderDirNode(group.node, 0, maxMetric, [], clientWidth));
          }
        }
      } else {
        for (const child of visibleChildren) {
          treeEl.appendChild(renderer.renderDirNode(child, 0, maxMetric, [], clientWidth));
        }
      }
      const shouldTruncate = state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(r.path);
      const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
      const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];
      for (const file of shownFiles) { treeEl.appendChild(renderer.renderFileNode(file, 0, [])); }
      if (hiddenFiles.length > 0) {
        treeEl.appendChild(renderer.renderTruncatedRow(hiddenFiles, 0, [], r.path, maxMetric, clientWidth));
      }
    }
  }

  // ── Shared view helpers ───────────────────────────────────────────────────

  /**
   * Creates the "auto-rescan disabled" warning banner with a wired Refresh button.
   * @param {object} vscode — VS Code webview API (for postMessage)
   * @returns {HTMLElement}
   */
  function createRescanWarning(vscode) {
    const warn = document.createElement('div');
    warn.className = 'rescan-warning';
    warn.innerHTML = `
      <span class="rescan-warning-icon">${SVG_WARNING}</span>
      <span>Auto-rescan disabled (large repo)</span>
      <button class="rescan-btn">Refresh</button>
    `;
    warn.querySelector('.rescan-btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
    return warn;
  }

  // ── Incremental DOM patching ─────────────────────────────────────────────
  //
  // On file-change rescans the tree structure is typically stable (same directories,
  // same files, possibly different counts/bar widths). patchTreeChildren/patchDirLi
  // reuse existing <li> DOM nodes rather than replacing the whole tree, which:
  //   • Preserves scroll position (no parent innerHTML wipe)
  //   • Avoids visual flicker for unchanged nodes
  //   • Updates only what changed (bar widths, file counts)
  //
  // Each <li> produced by renderDirNode carries data-node-path so matching is O(1).

  /**
   * Patches oldEl's direct children to match newEl's, keyed by data-node-path.
   * Keyed nodes (dirs) are updated in-place via patchDirLi; unkeyed nodes (file
   * rows, truncated rows, empty-group rows, workspace headers) are replaced
   * wholesale.  The reconciled list is built in a DocumentFragment and swapped
   * in one shot so only a single reflow occurs.
   * @param {HTMLElement} oldEl
   * @param {HTMLElement} newEl
   */
  function patchTreeChildren(oldEl, newEl) {
    // Index existing keyed children for O(1) lookup.
    const oldByPath = new Map();
    for (const child of oldEl.children) {
      const p = child.dataset.nodePath;
      if (p !== undefined) { oldByPath.set(p, child); }
    }

    // Build the reconciled child list: reuse matched old dir nodes, take new
    // nodes for everything else (files, truncated rows, headers, new dirs).
    const fragment = document.createDocumentFragment();
    for (const newChild of [...newEl.children]) {
      const p = newChild.dataset.nodePath;
      const oldChild = (p !== undefined) ? oldByPath.get(p) : undefined;

      if (oldChild) {
        oldByPath.delete(p);
        patchDirLi(oldChild, newChild);
        fragment.appendChild(oldChild);
      } else {
        fragment.appendChild(newChild);
      }
    }

    // Replace all children at once — drops stale/unkeyed old nodes, preserves
    // the parent element identity (and therefore scroll position).
    while (oldEl.firstChild) { oldEl.removeChild(oldEl.firstChild); }
    oldEl.appendChild(fragment);
  }

  /**
   * Updates a single dir <li> in place: bar width/segments, file count, and
   * recurses into the children <ul>. Non-structural changes only (hover actions,
   * chevron state, dir name are left as-is since they don't change on rescan).
   * @param {HTMLElement} oldLi
   * @param {HTMLElement} newLi
   */
  function patchDirLi(oldLi, newLi) {
    const oldRow = oldLi.querySelector(':scope > .dir-row');
    const newRow = newLi.querySelector(':scope > .dir-row');
    if (oldRow && newRow) {
      // Update bar-wrap width and segment colors/widths.
      const oldBarWrap = oldRow.querySelector('.bar-wrap');
      const newBarWrap = newRow.querySelector('.bar-wrap');
      if (oldBarWrap && newBarWrap) {
        oldBarWrap.style.width = newBarWrap.style.width;
        const oldBar = oldBarWrap.querySelector('.bar');
        const newBar = newBarWrap.querySelector('.bar');
        // Replace bar segments in one shot — they are small and cheap to recreate.
        if (oldBar && newBar) { oldBar.replaceWith(newBar); }
      } else if (!oldBarWrap && newBarWrap) {
        // Dir went from 0 files to >0 — insert bar before file-count.
        const countEl = oldRow.querySelector('.file-count');
        if (countEl) { countEl.before(newBarWrap); }
        else { oldRow.appendChild(newBarWrap); }
      } else if (oldBarWrap && !newBarWrap) {
        // Dir went to 0 files — remove bar.
        oldBarWrap.remove();
      }

      // Update file count text, title, and inline style (opacity for empty dirs).
      const oldCount = oldRow.querySelector('.file-count');
      const newCount = newRow.querySelector('.file-count');
      if (oldCount && newCount) {
        oldCount.textContent = newCount.textContent;
        oldCount.title = newCount.title;
        // Preserve width — it will be re-equalized after patching.
        oldCount.style.cssText = newCount.style.cssText;
        oldCount.style.width = '';
      }
    }

    // Reconcile children <ul> — the open/closed class may have changed, and the
    // children themselves may have been added, removed, or reordered.
    const oldChildren = oldLi.querySelector(':scope > ul.children');
    const newChildren = newLi.querySelector(':scope > ul.children');
    if (oldChildren && newChildren) {
      oldChildren.className = newChildren.className;
      patchTreeChildren(oldChildren, newChildren);
    } else if (!oldChildren && newChildren) {
      oldLi.appendChild(newChildren);
    } else if (oldChildren && !newChildren) {
      oldChildren.remove();
    }
  }

  /**
   * Renders the tree <ul> into rootEl. If rootEl already contains a <ul class="tree">
   * from a previous render, patches it incrementally (preserves scroll, avoids flicker).
   * Otherwise creates and appends a new tree element (first render or after loading/error).
   * @param {object} state
   * @param {object} renderer
   * @param {HTMLElement} rootEl
   * @param {{ cssClass?: string }} [opts]
   */
  function renderTree(state, renderer, rootEl, opts) {
    // Clear the nodeMap so stale entries from the previous render don't persist.
    if (renderer.beforeRender) { renderer.beforeRender(); }
    const maxMetric = computeMaxMetric(state.lastRoots, state.currentSortMode, false);
    const clientWidth = rootEl.clientWidth;
    const treeClass = 'tree' +
      (opts && opts.cssClass ? ' ' + opts.cssClass : '') +
      (state.currentSortMode === 'size' ? ' sort-size' : '');

    const existingTree = rootEl.querySelector(':scope > ul.tree');
    if (existingTree) {
      // Incremental path: build the new tree off-screen, then reconcile with existing DOM.
      existingTree.className = treeClass;
      const newTreeEl = document.createElement('ul');
      newTreeEl.className = treeClass;
      renderRoots(renderer, state, newTreeEl, maxMetric, clientWidth);
      patchTreeChildren(existingTree, newTreeEl);
    } else {
      // First render (or after loading/error cleared the container): full creation.
      const treeEl = document.createElement('ul');
      treeEl.className = treeClass;
      renderRoots(renderer, state, treeEl, maxMetric, clientWidth);
      rootEl.appendChild(treeEl);
    }

  }

  /**
   * Creates a window 'message' handler that handles common message types
   * (scanning, loading, update, filter, expandAll, collapseAll, error).
   *
   * @param {object} state
   * @param {object} scanBar
   * @param {HTMLElement} rootEl
   * @param {object} deps
   *   deps.render(roots, autoRescanEnabled, sortMode) — the view's render function
   *   deps.resolveUpdateSortMode?(msg) — returns the sortMode to use for 'update'; defaults to msg.sortMode
   *   deps.onBeforeUpdate?(msg) — called synchronously before rAF on 'update'
   *   deps.onAfterRender?(msg) — called inside rAF after render on 'update'
   *   deps.onLoading?() — called after clearing rootEl on 'loading'
   *   deps.onFilter?(hadFilters) — called after filter state update + re-render
   *   deps.onExpandAll?() — called after tieredExpandAll + re-render
   *   deps.onCollapseAll?() — called after tieredCollapseAll + re-render
   * @returns {function} — pass directly to window.addEventListener('message', ...)
   */
  function createMessageHandler(state, scanBar, rootEl, deps) {
    return function (event) {
      const message = event.data;
      switch (message.type) {
        case 'scanning':
          scanBar.show(true);
          break;
        case 'loading':
          scanBar.show(false);
          rootEl.innerHTML = '<div class="loading">Scanning workspace…</div>';
          if (deps.onLoading) { deps.onLoading(); }
          break;
        case 'update':
          if (deps.onBeforeUpdate) { deps.onBeforeUpdate(message); }
          scanBar.show(true);
          requestAnimationFrame(() => {
            const sortMode = deps.resolveUpdateSortMode ? deps.resolveUpdateSortMode(message) : message.sortMode;
            deps.render(message.roots, message.autoRescanEnabled, sortMode);
            scanBar.show(false);
            if (deps.onAfterRender) { deps.onAfterRender(message); }
          });
          break;
        case 'filter': {
          const hadFilters = state.activeFilters.size > 0;
          state.activeFilters = new Set(message.langs || []);
          if (!hadFilters && state.activeFilters.size > 0) { state.expanded.clear(); }
          if (state.lastRoots) {
            state.rerender();
          }
          if (deps.onFilter) { deps.onFilter(hadFilters); }
          break;
        }
        case 'expandAll':
          if (state.lastRoots) {
            tieredExpandAll(state, state.lastRoots);
            state.rerender();
            if (deps.onExpandAll) { deps.onExpandAll(); }
          }
          break;
        case 'collapseAll':
          if (state.lastRoots) {
            tieredCollapseAll(state, state.lastRoots);
            state.truncationExpanded.clear();
            state.emptyGroupExpanded.clear();
            state.rerender();
            if (deps.onCollapseAll) { deps.onCollapseAll(); }
          }
          break;
        case 'updateSortMode':
          // Lightweight sort-mode change from sidebarProvider.updateSortMode():
          // avoids re-serializing the full tree when only the sort order changed.
          state.currentSortMode = message.sortMode || 'files';
          if (state.lastRoots) { state.rerender(); }
          break;
        case 'updateTruncation':
          // Lightweight truncation change from sidebarProvider.updateTruncateThreshold():
          // avoids re-serializing the full tree when only the truncation threshold changed.
          if (typeof message.truncateThreshold === 'number' && message.truncateThreshold !== state.truncateThreshold) {
            state.truncationExpanded.clear();
            state.emptyGroupExpanded.clear();
          }
          if (typeof message.truncateThreshold === 'number') { state.truncateThreshold = message.truncateThreshold; }
          if (state.lastRoots) { state.rerender(); }
          break;
        case 'error':
          scanBar.show(false);
          rootEl.innerHTML = `<div class="error">Error: ${escHtml(message.message)}</div>`;
          break;
      }
    };
  }

  window.DirviewShared = {
    SVG_CHEVRON, SVG_PLUS, SVG_WARNING,
    SVG_EYE, SVG_EYE_CLOSED, SVG_FOLD, SVG_UNFOLD, SVG_EXPAND_ALL, SVG_COLLAPSE_ALL, SVG_OPEN_IN_TAB,
    SVG_SORT_FILES, SVG_SORT_NAME, SVG_SORT_SIZE,
    escHtml, formatBytes, sortDirs, sortFiles, computeMaxMetric, groupEmptyDirs,
    createScanBar, createTooltip, createRenderer,
    computeStats, renderLegend, createState,
    walkExpand, walkCollapse, tieredExpandAll, tieredCollapseAll, renderRoots,
    createRescanWarning, renderTree, createMessageHandler,
    patchTreeChildren, patchDirLi,
  };
})();
