// Core tree renderer for dirview webviews.
// ES module — imported by main.ts, tab.ts, etc.

import { SVG_CHEVRON, SVG_PLUS, SVG_EXPAND_ALL, SVG_COLLAPSE_ALL, SVG_OPEN_IN_TAB } from '../icons';
import {
  escHtml, formatBytes, formatLines, sortDirs, sortFiles, groupEmptyDirs,
  compactedNode, compactedPath, computeBarWidth,
} from '../utils';
import { setupDelegatedEvents } from './events';
import {
  renderMatchLine as _renderMatchLine,
  renderContextLine as _renderContextLine,
  renderMoreMatchesRow as _renderMoreMatchesRow,
  renderFileMatches as _renderFileMatches,
} from './matches';
import { h } from '../h';
import type { DirNode, FileNode, FileTypeStats, WebviewState, SortMode, RendererDeps, RendererOptions, Renderer, IndentAncestor, SearchMatch, NodeMapEntry, RendererContext } from '../types';

// Creates render helpers bound to a mutable state object.
// The tree is pre-filtered by filterTree() before reaching the renderer —
// children/files arrays already contain only visible nodes.
export function createRenderer(state: WebviewState, deps: RendererDeps): Renderer {
  const { vscode, root, tooltip } = deps;
  const opts: RendererOptions = deps.options || {};

  // Map from displayNode.path → { node: DirNode, hasChildren: boolean }.
  // Populated during renderDirNode calls; cleared by beforeRender() at the start of
  // each full re-render. Used by delegated event handlers to avoid per-element closures.
  const nodeMap: Map<string, NodeMapEntry> = new Map();

  // Per-render file metric max — set via setMaxFileMetric() before each render pass.
  // Used by renderFileNode to scale file bars globally.
  let _maxFileMetric = 0;
  let _clientWidth = 0;

  // Build the shared context object that extracted modules access.
  const ctx: RendererContext = {
    state,
    deps,
    opts,
    nodeMap,
    root,
    tooltip,
    vscode,
    renderIndentGuides: null!, // assigned below after definition
  };

  // ── Delegated event handlers ─────────────────────────────────────────────
  setupDelegatedEvents(ctx);

  function renderIndentGuides(depth: number, ancestors: IndentAncestor[]): HTMLSpanElement {
    const guides: HTMLSpanElement[] = [];
    for (let i = 0; i < depth; i++) {
      const ancestor = ancestors[i];
      guides.push(h('span', {
        className: 'indent-guide',
        dataset: ancestor ? {
          guidePath: ancestor.path,
          action: 'collapseGuide',
          ...(ancestor.isFileMatch ? { guideIsFileMatch: '1' } : {}),
        } : undefined,
      }));
    }
    return h('span', { className: 'indent-guides' }, ...guides);
  }

  // Wire up renderIndentGuides on the context so extracted modules can use it.
  ctx.renderIndentGuides = renderIndentGuides;

  function renderFileNode(file: FileNode, depth: number, ancestors: IndentAncestor[], hasMatchesOverride?: boolean, maxFileMetric?: number, clientWidth?: number): HTMLLIElement {
    // Virtual path passes pre-computed hasMatches from FlatRow; non-virtual path falls back to state lookup.
    const hasMatches = hasMatchesOverride ?? !!(state.searchResults?.has(file.path) && state.searchResults.get(file.path)!.length > 0);
    const row = h('div', {
      className: 'file-row clickable' + (hasMatches ? ' has-matches' : ''),
      // For files without matches: data-action opens the file via delegated click handler.
      // For files with matches: click is handled below (toggle vs. open-file by target).
      dataset: {
        ...(!hasMatches ? { action: 'openFile' } : {}),
        path: file.path,
      },
      attr: { 'data-vscode-context': JSON.stringify({
        webviewSection: 'file',
        path: file.path,
        preventDefaultContextMenuItems: true,
      }) },
    }, renderIndentGuides(depth, ancestors));

    if (hasMatches) {
      // Chevron for collapsible matches — sits in the chevron slot before the dot.
      const isCollapsed = state.matchesCollapsed.has(file.path);
      row.appendChild(h('span', {
        className: 'chevron' + (isCollapsed ? '' : ' open'),
        innerHTML: SVG_CHEVRON,
      }));
    }

    const dotSlot = h('span', { className: 'chevron' },
      h('span', { className: 'file-dot', style: { backgroundColor: file.langColor }, title: file.langName }),
    );
    row.appendChild(dotSlot);

    const nameEl = h('span', {
      className: 'file-name',
      textContent: file.name,
      title: file.path,
      dataset: hasMatches ? { action: 'openFile', path: file.path } : undefined,
    });
    row.appendChild(nameEl);

    // Hover hint icon — non-interactive, just indicates "click to open"
    row.appendChild(h('span', {
      className: 'file-open-hint',
      innerHTML: SVG_OPEN_IN_TAB,
    }));

    row.appendChild(h('div', { className: 'bar-spacer' }));

    // File bar: proportional to the file's metric relative to the global max file metric.
    // Uses sizeBytes in files/name/size modes, lineCount in lines mode.
    // Sqrt scaling matches directory bar scaling for consistency.
    if (maxFileMetric && maxFileMetric > 0) {
      const isLines = state.currentSortMode === 'lines';
      const fileMetric = isLines ? (file.lineCount || 0) : (file.sizeBytes || 0);
      const pct = fileMetric / maxFileMetric;
      const barWrapWidth = computeBarWidth(pct, clientWidth || 0, root, opts, 9);

      row.appendChild(h('div', { className: 'bar-wrap', style: { width: barWrapWidth + 'px' } },
        h('div', { className: 'bar' },
          h('div', { className: 'bar-segment', style: { width: '100%', backgroundColor: file.langColor } }),
        ),
      ));
    } else {
      // Fallback: colored dot when no metric context available
      row.appendChild(h('span', {
        className: 'file-dot',
        style: { backgroundColor: file.langColor },
        title: file.langName,
      }));
    }

    if (!opts.hideCounts) {
      const isLines = state.currentSortMode === 'lines';
      let countText: string;
      if (isLines) {
        countText = file.isBinary ? 'BIN' : (file.lineCount > 0 ? formatLines(file.lineCount) : '');
      } else {
        countText = file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : '';
      }
      row.appendChild(h('span', {
        className: 'file-count',
        textContent: countText,
      }));
    }

    return h('li', { dataset: { nodePath: 'file:' + file.path } }, row);
  }

  function renderTruncatedRow(hiddenFiles: FileNode[], depth: number, ancestors: IndentAncestor[], dirPath: string, maxMetric: number, clientWidth: number): HTMLLIElement {
    // Use a synthetic path so the delegated tooltip handler can look up this row's stats.
    const truncKey = dirPath + '\0truncated';
    const row = h('div', {
      className: 'dir-row truncated-row',
      dataset: { action: 'expandTruncated', dirPath, path: truncKey },
    }, renderIndentGuides(depth, ancestors));

    row.appendChild(h('span', { className: 'chevron', innerHTML: SVG_PLUS }));

    // Colored dots for unique language types among hidden files
    const langMap = new Map<string, { color: string; count: number; sizeBytes: number; lineCount: number }>();
    for (const f of hiddenFiles) {
      if (f.langName) {
        const ex = langMap.get(f.langName);
        if (ex) { ex.count++; ex.sizeBytes += (f.sizeBytes || 0); ex.lineCount += (f.lineCount || 0); }
        else { langMap.set(f.langName, { color: f.langColor, count: 1, sizeBytes: f.sizeBytes || 0, lineCount: f.lineCount || 0 }); }
      }
    }
    const sortMode = state.currentSortMode;
    const langs = Array.from(langMap.entries()).sort((a, b) =>
      sortMode === 'size' ? b[1].sizeBytes - a[1].sizeBytes
        : sortMode === 'lines' ? b[1].lineCount - a[1].lineCount
        : b[1].count - a[1].count
    );

    // Register synthetic node for tooltip hover
    const totalTruncBytes = hiddenFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0);
    const totalTruncLines = hiddenFiles.reduce((s, f) => s + (f.lineCount || 0), 0);
    nodeMap.set(truncKey, {
      node: {
        totalFiles: hiddenFiles.length,
        sizeBytes: totalTruncBytes,
        totalLines: totalTruncLines,
        stats: langs.map(([name, { color, count, sizeBytes, lineCount }]) => ({ name, color, count, sizeBytes, lineCount })),
      },
      hasChildren: false as const,
    });

    row.appendChild(h('span', { className: 'truncated-dots' },
      ...langs.slice(0, 5).map(([langName, { color }]) =>
        h('span', { className: 'file-dot', style: { backgroundColor: color }, title: langName })
      ),
    ));

    row.appendChild(h('span', { className: 'dir-name', textContent: `${hiddenFiles.length} more file${hiddenFiles.length !== 1 ? 's' : ''}` }));
    row.appendChild(h('div', { className: 'bar-spacer' }));

    // Proportional bar showing language makeup of hidden files
    if (langs.length > 0 && maxMetric > 0) {
      const totalCount = hiddenFiles.length;
      const metric = sortMode === 'size' ? totalTruncBytes : sortMode === 'lines' ? totalTruncLines : totalCount;
      const pct = metric / maxMetric;
      const barWrapWidth = computeBarWidth(pct, clientWidth, root, opts, 9);

      row.appendChild(h('div', { className: 'bar-wrap', style: { width: barWrapWidth + 'px' } },
        h('div', { className: 'bar' },
          ...langs.map(([, { color, count, sizeBytes, lineCount }]) => {
            const segMetric = sortMode === 'size' ? sizeBytes : sortMode === 'lines' ? lineCount : count;
            const segTotal = sortMode === 'size' ? totalTruncBytes : sortMode === 'lines' ? totalTruncLines : totalCount;
            return h('div', { className: 'bar-segment', style: { width: (segMetric / segTotal) * 100 + '%', backgroundColor: color } });
          }),
        ),
      ));
    }

    // Right column: file count, size, or lines depending on sort mode
    if (!opts.hideCounts) {
      const metaEl = h('span', { className: 'file-count' });
      if (sortMode === 'size') {
        metaEl.textContent = totalTruncBytes > 0 ? formatBytes(totalTruncBytes) : '';
        metaEl.title = hiddenFiles.length + ' files';
      } else if (sortMode === 'lines') {
        metaEl.textContent = totalTruncLines > 0 ? formatLines(totalTruncLines) : '';
        metaEl.title = hiddenFiles.length + ' files';
      } else {
        metaEl.textContent = String(hiddenFiles.length);
        metaEl.title = totalTruncBytes > 0 ? formatBytes(totalTruncBytes) : '';
      }
      row.appendChild(metaEl);
    }

    return h('li', row);
  }

  function renderEmptyGroupNode(nodes: DirNode[], depth: number, maxMetric: number, ancestors: IndentAncestor[]): HTMLLIElement {
    const groupKey = nodes[0].path;

    const row = h('div', {
      className: 'dir-row empty-group-row',
      dataset: { action: 'expandEmptyGroup', groupKey },
    },
      renderIndentGuides(depth, ancestors),
      h('span', { className: 'chevron', innerHTML: SVG_PLUS }),
      h('span', { className: 'dir-name', textContent: `${nodes.length} empty director${nodes.length !== 1 ? 'ies' : 'y'}` }),
      h('div', { className: 'bar-spacer' }),
      // Always show "—" for empty group rows (visual alignment with other rows)
      h('span', { className: 'file-count', textContent: '\u2014', style: { opacity: '0.5' } }),
    );

    return h('li', row);
  }

  // Renders just the directory row (<li> with <div class="dir-row">) without children.
  // Used by the virtual scroller to render flat dir rows. Also called internally by
  // renderDirNode() which adds the children <ul> on top.
  function renderDirRow(node: DirNode, depth: number, maxMetric: number, ancestors: IndentAncestor[], clientWidth: number): HTMLLIElement {
    // Compact folders: collapse chain of dirs with exactly 1 child dir and 0 files.
    // Tree is pre-filtered, so children/files are already the visible set.
    let displayNode: DirNode = node;
    let displayName: string = node.name;
    const compactSegments: Array<{ name: string; path: string }> = [{ name: node.name, path: node.path }];
    while (displayNode.children.length === 1 && (displayNode.files || []).length === 0) {
      displayName += ' / ' + displayNode.children[0].name;
      compactSegments.push({ name: displayNode.children[0].name, path: displayNode.children[0].path });
      displayNode = displayNode.children[0];
    }

    const li = h('li', { dataset: { nodePath: displayNode.path } });

    // Explicit entry, or implicitly expanded when filtered.
    const shouldExpand = state.expanded.get(displayNode.path) ?? !!state._isFiltered;

    const sortedChildren: DirNode[] = sortDirs(displayNode.children, state.currentSortMode);
    const sortedFiles: FileNode[] = sortFiles(displayNode.files || []);

    const hasChildren = sortedChildren.length > 0 || sortedFiles.length > 0;

    // Dir row
    const row = h('div', {
      className: 'dir-row' + (displayNode.totalFiles === 0 ? ' empty-dir' : ''),
      attr: {
        'data-path': displayNode.path,
        'data-vscode-context': JSON.stringify({
          webviewSection: 'directory',
          path: displayNode.path,
          rootName: state.workspaceFolderName || state.currentRootName,
          preventDefaultContextMenuItems: true,
        }),
      },
    });

    // Sticky positioning: dirs with children stick at a depth-based top offset so
    // ancestors remain visible while scrolling through long child lists.
    if (hasChildren) {
      row.classList.add('sticky-dir');
      row.style.setProperty('--depth', String(depth));
    }

    // skipDepthZeroGuides=true (sidebar): omit the empty indent-guides container at depth 0
    if (!opts.skipDepthZeroGuides || depth > 0) {
      row.appendChild(renderIndentGuides(depth, ancestors));
    }

    // Chevron
    row.appendChild(h('span', {
      className: 'chevron' + (hasChildren ? (shouldExpand ? ' open' : '') : ' leaf'),
      innerHTML: SVG_CHEVRON,
    }));

    // Name — for compacted paths, render each segment separately with dimmed separators
    // and per-segment data-vscode-context for RMB "copy path" etc on individual segments.
    const nameEl = h('span', { className: 'dir-name', title: displayNode.path || displayName });

    if (compactSegments.length === 1) {
      nameEl.textContent = compactSegments[0].name;
    } else {
      for (let i = 0; i < compactSegments.length; i++) {
        if (i > 0) {
          nameEl.appendChild(h('span', { className: 'path-sep', textContent: ' / ' }));
        }
        nameEl.appendChild(h('span', {
          className: 'path-segment',
          textContent: compactSegments[i].name,
          attr: { 'data-vscode-context': JSON.stringify({
            webviewSection: 'directory',
            path: compactSegments[i].path,
            rootName: state.workspaceFolderName || state.currentRootName,
            preventDefaultContextMenuItems: true,
          }) },
        }));
      }
    }

    row.appendChild(nameEl);

    // Hover action buttons — overlay on the right (sidebar) or inline after name (tab)
    const actionsEl = h('div', { className: 'dir-actions' },
      ...(displayNode.children.length > 0 ? [
        h('button', {
          className: 'dir-action-btn',
          innerHTML: SVG_EXPAND_ALL,
          title: 'Expand children',
          dataset: { action: 'expandDir', path: displayNode.path },
        }),
        h('button', {
          className: 'dir-action-btn',
          innerHTML: SVG_COLLAPSE_ALL,
          title: 'Collapse children',
          dataset: { action: 'collapseDir', path: displayNode.path },
        }),
      ] : []),
      h('button', {
        className: 'dir-action-btn',
        innerHTML: SVG_OPEN_IN_TAB,
        title: 'Open in new tab',
        dataset: { action: 'openInTab', path: displayNode.path },
      }),
    );

    // Flex spacer pushes bar + count to the right
    const barSpacer = h('div', { className: 'bar-spacer' });
    row.appendChild(barSpacer);
    row.insertBefore(actionsEl, barSpacer);

    if (displayNode.totalFiles > 0) {
      const sm = state.currentSortMode;
      const metric = sm === 'size' ? displayNode.sizeBytes : sm === 'lines' ? displayNode.totalLines : displayNode.totalFiles;
      const pct = metric / maxMetric;
      const barWrapWidth = computeBarWidth(pct, clientWidth, root, opts, 9);

      row.appendChild(h('div', { className: 'bar-wrap', style: { width: barWrapWidth + 'px' } },
        h('div', { className: 'bar' },
          ...displayNode.stats.map(s => {
            const segW = sm === 'size'
              ? (displayNode.sizeBytes > 0 ? (s.sizeBytes / displayNode.sizeBytes) * 100 : 0)
              : sm === 'lines'
              ? (displayNode.totalLines > 0 ? (s.lineCount / displayNode.totalLines) * 100 : 0)
              : (s.count / displayNode.totalFiles) * 100;
            return h('div', { className: 'bar-segment', style: { width: segW + '%', backgroundColor: s.color } });
          }),
        ),
      ));
    }

    // Right column: file count, size, or lines depending on sort mode.
    // Empty dirs always show "—" for visual alignment, even when hideCounts is set.
    if (!opts.hideCounts || displayNode.totalFiles === 0) {
      const metaEl = h('span', { className: 'file-count' });
      if (displayNode.totalFiles > 0) {
        if (state.currentSortMode === 'size') {
          metaEl.textContent = formatBytes(displayNode.sizeBytes);
          metaEl.title = displayNode.totalFiles + ' files';
        } else if (state.currentSortMode === 'lines') {
          metaEl.textContent = formatLines(displayNode.totalLines);
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

    // Register this node in nodeMap so the delegated handlers can look it up by path.
    nodeMap.set(displayNode.path, { node: displayNode, hasChildren });

    li.appendChild(row);

    return li;
  }

  function renderDirNode(node: DirNode, depth: number, maxMetric: number, ancestors: IndentAncestor[], clientWidth: number): HTMLLIElement {
    // Render the <li> + <div class="dir-row"> via renderDirRow (shared with virtual scroller).
    const li = renderDirRow(node, depth, maxMetric, ancestors, clientWidth);

    // Retrieve the display node from nodeMap — renderDirRow registered it under the
    // compacted path which is stored as li's data-node-path.
    const displayPath = li.dataset.nodePath!;
    const entry = nodeMap.get(displayPath)!;
    const displayNode = entry.node as DirNode;
    const hasChildren = entry.hasChildren;

    // Explicit entry, or implicitly expanded when filtered.
    const shouldExpand = state.expanded.get(displayNode.path) ?? !!state._isFiltered;

    const sortedChildren: DirNode[] = sortDirs(displayNode.children, state.currentSortMode);
    const sortedFiles: FileNode[] = sortFiles(displayNode.files || []);

    // Children container — lazy: only populate when expanded to avoid building
    // collapsed subtrees during off-screen tree construction for patching.
    if (hasChildren) {
      const childrenEl = h('ul', { className: 'children' + (shouldExpand ? ' open' : '') });

      if (shouldExpand) {
        const nextAncestors: IndentAncestor[] = [...ancestors, { path: displayNode.path }];

        // Empty dir grouping — only when no filter is active (filtered trees already pruned)
        if (!state._isFiltered && sortedChildren.length > 0) {
          for (const group of groupEmptyDirs(sortedChildren)) {
            if (group.type === 'emptyGroup') {
              if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
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
          for (const child of sortedChildren) {
            childrenEl.appendChild(renderDirNode(child, depth + 1, maxMetric, nextAncestors, clientWidth));
          }
        }

        // File truncation — disabled when filter is active (all matched files must be shown).
        const isSingleDirRoot = depth === 0 && sortedChildren.length === 0;
        const shouldTruncate = !state._isFiltered && !isSingleDirRoot && state.truncateThreshold > 0 && sortedFiles.length > state.truncateThreshold && !state.truncationExpanded.has(displayNode.path);
        const shownFiles = shouldTruncate ? sortedFiles.slice(0, state.truncateThreshold) : sortedFiles;
        const hiddenFiles = shouldTruncate ? sortedFiles.slice(state.truncateThreshold) : [];

        for (const file of shownFiles) {
          childrenEl.appendChild(renderFileNode(file, depth + 1, nextAncestors, undefined, _maxFileMetric, _clientWidth));
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
    },
    // Sets the global file metric context for the current render pass.
    // Used by the non-virtual path (renderDirNode) to pass file bar scaling to renderFileNode.
    setFileMetricContext(maxFileMetric: number, clientWidth: number) {
      _maxFileMetric = maxFileMetric;
      _clientWidth = clientWidth;
    },
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
    renderDirRow,
    renderDirNode,
  };
}
