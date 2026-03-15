// Core tree renderer for dirview webviews.
// ES module — imported by main.ts, tab.ts, etc.

import { SVG_CHEVRON, SVG_PLUS, SVG_EXPAND_ALL, SVG_COLLAPSE_ALL, SVG_OPEN_IN_TAB } from './shared-icons';
import {
  escHtml, formatBytes, sortDirs, sortFiles, groupEmptyDirs,
  compactedNode, compactedPath, getVisibleChildren, getVisibleFiles, computeBarWidth,
} from './shared-utils';
import { setupDelegatedEvents } from './shared-renderer-events';
import {
  renderMatchLine as _renderMatchLine,
  renderContextLine as _renderContextLine,
  renderMoreMatchesRow as _renderMoreMatchesRow,
  renderFileMatches as _renderFileMatches,
} from './shared-renderer-matches';
import type { DirNode, FileNode, FileTypeStats, WebviewState, SortMode, RendererDeps, RendererOptions, Renderer, IndentAncestor, SearchMatch, NodeMapEntry, RendererContext } from './types';

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
export function createRenderer(state: WebviewState, deps: RendererDeps): Renderer {
  const { vscode, root, tooltip } = deps;
  const opts: RendererOptions = deps.options || {};

  // Map from displayNode.path → { node: DirNode, hasChildren: boolean }.
  // Populated during renderDirNode calls; cleared by beforeRender() at the start of
  // each full re-render. Used by delegated event handlers to avoid per-element closures.
  const nodeMap: Map<string, NodeMapEntry> = new Map();

  // WeakMap cache for search-result matching — reset by beforeRender() each render cycle.
  // Prevents redundant recursive tree walks when the same node is checked multiple times.
  // Wrapped in ref objects so reassignment in beforeRender is visible to all modules.
  const searchMatchCache = { current: new WeakMap<DirNode, boolean>() };
  const fileFilterMatchCache = { current: new WeakMap<DirNode, boolean>() };

  // Build the shared context object that extracted modules access.
  const ctx: RendererContext = {
    state,
    deps,
    opts,
    nodeMap,
    searchMatchCache,
    fileFilterMatchCache,
    root,
    tooltip,
    vscode,
    renderIndentGuides: null!, // assigned below after definition
  };

  // ── Delegated event handlers ─────────────────────────────────────────────
  setupDelegatedEvents(ctx);

  function dirMatchesFilter(node: DirNode): boolean {
    if (state.activeFilters.size === 0) { return true; }
    return node.stats.some(s => state.activeFilters.has(s.name) && s.count > 0);
  }

  function renderIndentGuides(depth: number, ancestors: IndentAncestor[]): HTMLSpanElement {
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
        // File-match guides collapse the file's match group rather than a directory.
        if (ancestor.isFileMatch) {
          guide.dataset.guideIsFileMatch = '1';
        }
      }
      container.appendChild(guide);
    }
    return container;
  }

  // Wire up renderIndentGuides on the context so extracted modules can use it.
  ctx.renderIndentGuides = renderIndentGuides;

  // Returns true if any descendant file matches the client-side filename filter.
  // Used when regex file filter is active. Memoized per render cycle.
  function dirMatchesFileFilter(node: DirNode): boolean {
    if (!state.fileFilterFn) { return true; }
    const cached = fileFilterMatchCache.current.get(node);
    if (cached !== undefined) { return cached; }
    for (const f of (node.files || [])) {
      if (state.fileFilterFn(f.name) &&
        (state.activeFilters.size === 0 || state.activeFilters.has(f.langName))) {
        fileFilterMatchCache.current.set(node, true);
        return true;
      }
    }
    for (const c of (node.children || [])) {
      if (dirMatchesFileFilter(c)) {
        fileFilterMatchCache.current.set(node, true);
        return true;
      }
    }
    fileFilterMatchCache.current.set(node, false);
    return false;
  }

  // Returns true if any descendant file of node has a path in state.searchResults.
  // Short-circuits as soon as a match is found; results are memoized in searchMatchCache.
  function dirMatchesSearch(node: DirNode): boolean {
    if (!state.searchResults) { return true; }
    const cached = searchMatchCache.current.get(node);
    if (cached !== undefined) { return cached; }
    for (const f of (node.files || [])) {
      if (state.searchResults.has(f.path) &&
        (state.activeFilters.size === 0 || state.activeFilters.has(f.langName))) {
        searchMatchCache.current.set(node, true);
        return true;
      }
    }
    for (const c of (node.children || [])) {
      if (dirMatchesSearch(c)) {
        searchMatchCache.current.set(node, true);
        return true;
      }
    }
    searchMatchCache.current.set(node, false);
    return false;
  }

  function renderFileNode(file: FileNode, depth: number, ancestors: IndentAncestor[]): HTMLLIElement {
    const li = document.createElement('li');
    const hasMatches = !!(state.searchResults?.has(file.path) && state.searchResults.get(file.path)!.length > 0);
    const row = document.createElement('div');
    row.className = 'file-row clickable' + (hasMatches ? ' has-matches' : '');
    // For files without matches: data-action opens the file via delegated click handler.
    // For files with matches: click is handled below (toggle vs. open-file by target).
    if (!hasMatches) {
      row.dataset.action = 'openFile';
    }
    row.dataset.path = file.path;
    row.setAttribute('data-vscode-context', JSON.stringify({
      webviewSection: 'file',
      path: file.path,
      preventDefaultContextMenuItems: true
    }));
    row.appendChild(renderIndentGuides(depth, ancestors));

    if (hasMatches) {
      // Chevron for collapsible matches — sits in the chevron slot before the dot.
      const matchChevron = document.createElement('span');
      const isCollapsed = state.matchesCollapsed.has(file.path);
      matchChevron.className = 'chevron' + (isCollapsed ? '' : ' open');
      matchChevron.innerHTML = SVG_CHEVRON;
      row.appendChild(matchChevron);
    }

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
    if (hasMatches) {
      // Clicking the filename opens the file; clicking elsewhere on the row toggles matches.
      nameEl.dataset.action = 'openFile';
      nameEl.dataset.path = file.path;
    }
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

  function renderTruncatedRow(hiddenFiles: FileNode[], depth: number, ancestors: IndentAncestor[], dirPath: string, maxMetric: number, clientWidth: number): HTMLLIElement {
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
    const langMap = new Map<string, { color: string; count: number; sizeBytes: number }>();
    for (const f of hiddenFiles) {
      if (f.langName) {
        const ex = langMap.get(f.langName);
        if (ex) { ex.count++; ex.sizeBytes += (f.sizeBytes || 0); }
        else { langMap.set(f.langName, { color: f.langColor, count: 1, sizeBytes: f.sizeBytes || 0 }); }
      }
    }
    const isSizeSort = state.currentSortMode === 'size';
    const langs = Array.from(langMap.entries()).sort((a, b) =>
      isSizeSort ? b[1].sizeBytes - a[1].sizeBytes : b[1].count - a[1].count
    );

    // Register synthetic node for tooltip hover
    nodeMap.set(truncKey, {
      node: {
        totalFiles: hiddenFiles.length,
        stats: langs.map(([name, { color, count }]) => ({ name, color, count })),
      },
      hasChildren: false as const,
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
      const barWrapWidth = computeBarWidth(pct, clientWidth, root, opts);

      const barWrap = document.createElement('div');
      barWrap.className = 'bar-wrap';
      barWrap.style.width = barWrapWidth + 'px';

      const bar = document.createElement('div');
      bar.className = 'bar';

      for (const [, { color, count, sizeBytes }] of langs) {
        const segMetric = isSizeSort ? sizeBytes : count;
        const segTotal = isSizeSort ? totalBytes : totalCount;
        const segPct = (segMetric / segTotal) * 100;
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

  function renderEmptyGroupNode(nodes: DirNode[], depth: number, maxMetric: number, ancestors: IndentAncestor[]): HTMLLIElement {
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
    metaEl.textContent = '\u2014';
    metaEl.style.opacity = '0.5';
    row.appendChild(metaEl);

    li.appendChild(row);

    return li;
  }

  function renderDirNode(node: DirNode, depth: number, maxMetric: number, ancestors: IndentAncestor[], clientWidth: number): HTMLLIElement {
    const li = document.createElement('li');

    // Compact folders: collapse chain of dirs with exactly 1 child dir and 0 files.
    // Skip sortDirs inside the loop — single-child arrays don't need sorting.
    let displayNode: DirNode = node;
    let displayName: string = node.name;
    const compactSegments: Array<{ name: string; path: string }> = [{ name: node.name, path: node.path }];
    while (true) {
      const children = displayNode.children;
      const files = displayNode.files || [];
      let vChildren: DirNode[] = state.activeFilters.size > 0
        ? children.filter(c => dirMatchesFilter(c))
        : children;
      let vFiles: FileNode[] = state.activeFilters.size > 0
        ? files.filter(f => state.activeFilters.has(f.langName))
        : files;
      // Also apply search filter when active — only compact through dirs with a single matching child.
      if (state.searchResults) {
        vChildren = vChildren.filter(c => dirMatchesSearch(c));
        vFiles = vFiles.filter(f => state.searchResults!.has(f.path));
      }
      if (state.fileFilterFn) {
        vChildren = vChildren.filter(c => dirMatchesFileFilter(c));
        vFiles = vFiles.filter(f => state.fileFilterFn!(f.name));
      }
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
    // Record implicit depth-0 expansion so button state reflects reality after initial render.
    // Skip during active filter/search to avoid recording ephemeral auto-expanded state.
    if (!state.expanded.has(displayNode.path) && depth === 0 && state.activeFilters.size === 0 && !state.searchResults) {
      state.expanded.set(displayNode.path, true);
    }

    const sortedChildren: DirNode[] = sortDirs(displayNode.children, state.currentSortMode);
    const sortedFiles: FileNode[] = sortFiles(displayNode.files || []);

    // Apply language filter and search results filter
    const visibleChildren: DirNode[] = getVisibleChildren(sortedChildren, state.activeFilters, dirMatchesFilter, state.searchResults, (c: DirNode) => dirMatchesSearch(c), state.fileFilterFn, (c: DirNode) => dirMatchesFileFilter(c));
    const visibleFiles: FileNode[] = getVisibleFiles(sortedFiles, state.activeFilters, state.searchResults, state.fileFilterFn);

    const hasChildren = visibleChildren.length > 0 || visibleFiles.length > 0;

    // Dir row
    const row = document.createElement('div');
    row.className = 'dir-row' + (displayNode.totalFiles === 0 ? ' empty-dir' : '');

    // Sticky positioning: dirs with children stick at a depth-based top offset so
    // ancestors remain visible while scrolling through long child lists.
    if (hasChildren) {
      row.classList.add('sticky-dir');
      row.style.setProperty('--depth', String(depth));
    }
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

    // In tab mode (onNavigate set), render ancestor breadcrumb for the root node of a subdir tab.
    // For workspace root tabs (state.dirPath falsy), the root name renders normally below.
    if (depth === 0 && typeof deps.onNavigate === 'function' && state.dirPath) {
      const segments = state.dirPath.split('/');
      const hasRootName = !!state.workspaceFolderName;
      const allNames = hasRootName ? [state.workspaceFolderName, ...segments] : segments;
      for (let i = 0; i < allNames.length; i++) {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'path-sep';
          sep.textContent = ' / ';
          nameEl.appendChild(sep);
        }
        const offset = hasRootName ? i - 1 : i;
        const segPath = offset < 0 ? '' : segments.slice(0, offset + 1).join('/');
        const seg = document.createElement('span');
        seg.className = 'path-segment';
        seg.dataset.navigatePath = segPath;
        seg.textContent = allNames[i];
        nameEl.appendChild(seg);
      }
    } else if (compactSegments.length === 1) {
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

    // Proportional bar — skip for root node when hideRootBar is set (tab breadcrumb row)
    if (displayNode.totalFiles > 0 && !(depth === 0 && opts.hideRootBar)) {
      const metric = state.currentSortMode === 'size' ? displayNode.sizeBytes : displayNode.totalFiles;
      const pct = metric / maxMetric;
      const barWrapWidth = computeBarWidth(pct, clientWidth, root, opts);

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
        metaEl.textContent = '\u2014';
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
        const nextAncestors: IndentAncestor[] = [...ancestors, { path: displayNode.path }];

        // Empty dir grouping (only when no filter and no search active)
        if (state.activeFilters.size === 0 && !state.searchResults && visibleChildren.length > 0) {
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

        // File truncation — disabled when search is active (all matched files must be shown).
        // Also disabled when depth === 0 and there are no directory children (single-dir root):
        // truncation at the root level is confusing when all files are already at the top level.
        const isSingleDirRoot = depth === 0 && visibleChildren.length === 0;
        const shouldTruncate = !state.searchResults && !isSingleDirRoot && state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(displayNode.path);
        const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
        const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];

        for (const file of shownFiles) {
          childrenEl.appendChild(renderFileNode(file, depth + 1, nextAncestors));
          // Match lines sit at depth+2, one level below the file row. Include the
          // file in the ancestors array so the indent guide at the file's depth is
          // clickable — clicking it collapses the file's match group.
          const fileAncestors: IndentAncestor[] = [...nextAncestors, { path: file.path, isFileMatch: true }];
          _renderFileMatches(ctx, childrenEl, file, depth + 2, fileAncestors);
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
    beforeRender() {
      nodeMap.clear();
      searchMatchCache.current = new WeakMap();
      fileFilterMatchCache.current = new WeakMap();
    },
    dirMatchesFilter,
    dirMatchesSearch,
    dirMatchesFileFilter,
    renderIndentGuides,
    renderFileNode,
    renderMatchLine: (file, matchGroup, depth, ancestors, dedent) =>
      _renderMatchLine(ctx, file, matchGroup, depth, ancestors, dedent),
    renderContextLine: (file, match, depth, ancestors, dedent) =>
      _renderContextLine(ctx, file, match, depth, ancestors, dedent),
    renderMoreMatchesRow: (count, depth, ancestors, filePath) =>
      _renderMoreMatchesRow(ctx, count, depth, ancestors, filePath),
    renderFileMatches: (container, file, depth, ancestors) =>
      _renderFileMatches(ctx, container, file, depth, ancestors),
    renderTruncatedRow,
    renderEmptyGroupNode,
    renderDirNode,
  };
}
