// flattenTree — walks the DirNode tree and produces an ordered FlatRow[] with
// pre-computed heights and cumulative offsetY values. Mirrors the recursive
// rendering logic in render-tree.ts and renderer/index.ts exactly.

import { sortDirs, sortFiles, groupEmptyDirs, computeMaxMetric, compactedNode } from '../utils';
import { filterTree } from '../filter';
import { assembleMatchGroups } from '../match-grouping';
import type { DirNode, FileNode, WebviewState, IndentAncestor, SearchMatch } from '../types';
import type {
  FlatRow, FlattenResult, FlattenOptions,
} from './types';
import {
  ROW_HEIGHT_DIR, ROW_HEIGHT_FILE, ROW_HEIGHT_TRUNCATED, ROW_HEIGHT_EMPTY_GROUP,
  ROW_HEIGHT_MATCH_LINE, ROW_HEIGHT_CONTEXT_LINE, ROW_HEIGHT_MATCH_SPACER,
  ROW_HEIGHT_MORE_MATCHES, ROW_HEIGHT_WORKSPACE_HEADER,
} from './types';

/**
 * Flattens a DirNode tree into an ordered FlatRow array for virtual scrolling.
 *
 * The algorithm mirrors renderTree() → renderRoots() → renderDirNode() exactly:
 * 1. filterTree() to prune non-matching nodes
 * 2. computeMaxMetric() for bar scaling
 * 3. Recursive walk with folder compaction, expand/collapse, empty-group grouping,
 *    file truncation, and match flattening
 * 4. Post-pass to compute cumulative offsetY
 */
export function flattenTree(
  state: WebviewState,
  roots: DirNode[],
  opts: FlattenOptions = {},
): FlattenResult {
  const { showRootNode = false, clientWidth = 300 } = opts;

  // ── Step 1: Filter tree ──────────────────────────────────────────────────
  const filtered = filterTree(roots, {
    activeFilters: state.activeFilters,
    searchResults: state.searchResults,
    searchAncestorPaths: state.searchAncestorPaths,
    searchResultsVersion: state.searchResultsVersion,
  });
  const isFiltered = filtered.isFiltered;
  const filteredRoots = filtered.roots;

  // ── Step 2: Compute max metric ───────────────────────────────────────────
  const maxMetric = computeMaxMetric(filteredRoots, state.currentSortMode, false);

  // ── Step 3: Recursive walk ───────────────────────────────────────────────
  const flatRows: FlatRow[] = [];
  let totalVisibleFiles = 0;

  function flattenDirNode(
    node: DirNode,
    depth: number,
    ancestors: IndentAncestor[],
  ): void {
    // Folder compaction: collapse single-child-no-files chains.
    const displayNode = compactedNode(node);

    // Check expanded state — mirrors renderDirNode logic.
    const isExpanded = state.expanded.get(displayNode.path) ?? isFiltered;

    const sortedChildren = sortDirs(displayNode.children, state.currentSortMode);
    const sortedFiles = sortFiles(displayNode.files || []);
    const hasChildren = sortedChildren.length > 0 || sortedFiles.length > 0;

    // Emit DirFlatRow
    flatRows.push({
      type: 'dir',
      key: 'dir:' + displayNode.path,
      depth,
      height: ROW_HEIGHT_DIR,
      offsetY: 0,
      ancestors,
      node: displayNode,
      originalNode: node,
      isExpanded,
      hasChildren,
      maxMetric,
      clientWidth,
    });

    if (!isExpanded || !hasChildren) { return; }

    // Build ancestors for children
    const nextAncestors: IndentAncestor[] = [...ancestors, { path: displayNode.path }];

    // ── Children (dirs) ──────────────────────────────────────────────────
    if (!isFiltered && sortedChildren.length > 0) {
      // Empty dir grouping — only when no filter is active
      for (const group of groupEmptyDirs(sortedChildren)) {
        if (group.type === 'emptyGroup') {
          if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
            for (const n of group.nodes) {
              flattenDirNode(n, depth + 1, nextAncestors);
            }
          } else {
            flatRows.push({
              type: 'emptyGroup',
              key: 'emptyGroup:' + group.nodes[0].path,
              depth: depth + 1,
              height: ROW_HEIGHT_EMPTY_GROUP,
              offsetY: 0,
              ancestors: nextAncestors,
              nodes: group.nodes,
              maxMetric,
            });
          }
        } else {
          flattenDirNode(group.node, depth + 1, nextAncestors);
        }
      }
    } else {
      for (const child of sortedChildren) {
        flattenDirNode(child, depth + 1, nextAncestors);
      }
    }

    // ── Files ────────────────────────────────────────────────────────────
    // File truncation — disabled when filter is active or when dir has no subdirectories (single-dir root).
    const isSingleDirRoot = depth === 0 && sortedChildren.length === 0;
    const threshold = state.truncateThreshold;
    const shouldTruncate = !isFiltered && !isSingleDirRoot && threshold > 0
      && sortedFiles.length > threshold && !state.truncationExpanded.has(displayNode.path);
    const shownFiles = shouldTruncate ? sortedFiles.slice(0, threshold) : sortedFiles;
    const hiddenFiles = shouldTruncate ? sortedFiles.slice(threshold) : [];

    for (const file of shownFiles) {
      flatRows.push({
        type: 'file',
        key: 'file:' + file.path,
        depth: depth + 1,
        height: ROW_HEIGHT_FILE,
        offsetY: 0,
        ancestors: nextAncestors,
        file,
      });
      totalVisibleFiles++;

      // Match flattening for search results
      flattenFileMatches(file, depth + 2, nextAncestors);
    }

    if (hiddenFiles.length > 0) {
      flatRows.push({
        type: 'truncated',
        key: 'truncated:' + displayNode.path,
        depth: depth + 1,
        height: ROW_HEIGHT_TRUNCATED,
        offsetY: 0,
        ancestors: nextAncestors,
        hiddenFiles,
        dirPath: displayNode.path,
        maxMetric,
        clientWidth,
      });
    }
  }

  /**
   * Flattens search match rows for a file. Mirrors renderFileMatches() in matches.ts.
   */
  function flattenFileMatches(
    file: FileNode,
    depth: number,
    parentAncestors: IndentAncestor[],
  ): void {
    if (!state.searchResults?.has(file.path)) { return; }
    const fileMatches = state.searchResults.get(file.path);
    if (!fileMatches || fileMatches.length === 0) { return; }
    if (state.matchesCollapsed.has(file.path)) { return; }

    const ancestors: IndentAncestor[] = [...parentAncestors, { path: file.path, isFileMatch: true }];

    // Sort by line number
    const sorted = fileMatches.slice().sort((a, b) => a.line - b.line);

    const groups = assembleMatchGroups(sorted);

    // ── Emit MatchGroupFlatRows ──────────────────────────────────────────
    const threshold = state.truncateThreshold;
    const shouldTruncateMatches = threshold > 0 && groups.length > threshold && !state.truncationExpanded.has(file.path);

    let prevLastLine: number | null = null;

    for (let gi = 0; gi < groups.length; gi++) {
      if (shouldTruncateMatches && gi >= threshold) { break; }

      const g = groups[gi];
      const firstMatch = g.matches[0];
      const firstLineInGroup = firstMatch.contextBefore.length > 0
        ? firstMatch.contextBefore[0].line : firstMatch.matchLine;

      // Detect gap from previous group
      const hasGap = prevLastLine !== null && firstLineInGroup > prevLastLine + 1;

      // Compute height: each match line + context line = 18px, plus spacer if gap
      let lineCount = g.contextAfter.length;
      for (const me of g.matches) {
        lineCount += me.contextBefore.length + 1; // +1 for the match line itself
      }
      const groupHeight = lineCount * ROW_HEIGHT_MATCH_LINE + (hasGap ? ROW_HEIGHT_MATCH_SPACER : 0);

      flatRows.push({
        type: 'matchGroup',
        key: 'group:' + file.path + ':' + firstMatch.matchGroup[0].line,
        depth,
        height: groupHeight,
        offsetY: 0,
        ancestors,
        file,
        matches: g.matches,
        contextAfter: g.contextAfter,
        dedent: g.dedent,
        hasGap,
      });

      // Track last line for gap detection
      const lastMatchEntry = g.matches[g.matches.length - 1];
      prevLastLine = g.contextAfter.length > 0
        ? g.contextAfter[g.contextAfter.length - 1].line
        : lastMatchEntry.matchLine;
    }

    if (shouldTruncateMatches) {
      flatRows.push({
        type: 'moreMatches',
        key: 'more:' + file.path,
        depth,
        height: ROW_HEIGHT_MORE_MATCHES,
        offsetY: 0,
        count: groups.length - threshold,
        filePath: file.path,
        ancestors,
      });
    }
  }

  // ── Root handling ────────────────────────────────────────────────────────
  // Mirrors renderRoots() logic.

  if (showRootNode) {
    // Tab mode: each root is a visible depth-0 node, always expanded.
    for (const r of filteredRoots) {
      const cn = compactedNode(r);
      if (!state.expanded.has(cn.path)) { state.expanded.set(cn.path, true); }
      flattenDirNode(r, 0, []);
    }
  } else {
    // Sidebar mode: roots' children at depth 0
    for (const r of filteredRoots) {
      if (filteredRoots.length > 1) {
        flatRows.push({
          type: 'workspaceHeader',
          key: 'wsHeader:' + r.name,
          depth: 0,
          height: ROW_HEIGHT_WORKSPACE_HEADER,
          offsetY: 0,
          name: r.name,
          ancestors: [],
        });
      }

      const sortedChildren = sortDirs(r.children, state.currentSortMode);
      const sortedFiles = sortFiles(r.files || []);

      // Empty dir grouping — only when no filter is active
      if (!isFiltered && sortedChildren.length > 0) {
        for (const group of groupEmptyDirs(sortedChildren)) {
          if (group.type === 'emptyGroup') {
            if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
              for (const n of group.nodes) {
                flattenDirNode(n, 0, []);
              }
            } else {
              flatRows.push({
                type: 'emptyGroup',
                key: 'emptyGroup:' + group.nodes[0].path,
                depth: 0,
                height: ROW_HEIGHT_EMPTY_GROUP,
                offsetY: 0,
                ancestors: [],
                nodes: group.nodes,
                maxMetric,
              });
            }
          } else {
            flattenDirNode(group.node, 0, []);
          }
        }
      } else {
        for (const child of sortedChildren) {
          flattenDirNode(child, 0, []);
        }
      }

      // Root-level file truncation — mirrors renderRoots()
      const isSingleDirRoot = sortedChildren.length === 0;
      const threshold = state.truncateThreshold;
      const shouldTruncate = !isFiltered && !isSingleDirRoot && threshold > 0
        && sortedFiles.length > threshold && !state.truncationExpanded.has(r.path);
      const shownFiles = shouldTruncate ? sortedFiles.slice(0, threshold) : sortedFiles;
      const hiddenFiles = shouldTruncate ? sortedFiles.slice(threshold) : [];

      for (const file of shownFiles) {
        flatRows.push({
          type: 'file',
          key: 'file:' + file.path,
          depth: 0,
          height: ROW_HEIGHT_FILE,
          offsetY: 0,
          ancestors: [],
          file,
        });
        totalVisibleFiles++;

        flattenFileMatches(file, 1, []);
      }

      if (hiddenFiles.length > 0) {
        flatRows.push({
          type: 'truncated',
          key: 'truncated:' + r.path,
          depth: 0,
          height: ROW_HEIGHT_TRUNCATED,
          offsetY: 0,
          ancestors: [],
          hiddenFiles,
          dirPath: r.path,
          maxMetric,
          clientWidth,
        });
      }
    }
  }

  // ── Step 4: Post-pass — compute cumulative offsetY ───────────────────────
  let cumY = 0;
  for (const row of flatRows) {
    (row as any).offsetY = cumY;
    cumY += row.height;
  }

  return {
    flatRows,
    totalHeight: cumY,
    totalVisibleFiles,
    totalVisibleMatches: filtered.totalVisibleMatches,
    filteredRoots,
    searchFilteredStats: filtered.searchFilteredStats,
  };
}
