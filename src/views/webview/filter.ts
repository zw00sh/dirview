// Pre-render tree filtering layer.
// Produces a shallow-cloned tree with only visible nodes, so the renderer
// can render unconditionally without any filtering logic.

import type { DirNode, FileNode, SearchMatch } from './types';

export interface FilterInputs {
  activeFilters: Set<string>;
  searchResults: Map<string, SearchMatch[]> | null;
  searchAncestorPaths: Set<string> | null;
  searchResultsVersion: number;
}

export interface FilteredTree {
  roots: DirNode[];
  isFiltered: boolean;
  /** Total number of files visible after filtering. */
  totalVisibleFiles: number;
  /** Total search matches across visible files (0 when no search is active). */
  totalVisibleMatches: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

let cachedRoots: DirNode[] | null = null;
let cachedActiveFilters: Set<string> | null = null;
let cachedVersion = -1;
let cachedResult: FilteredTree | null = null;

function cacheValid(roots: DirNode[], inputs: FilterInputs): boolean {
  return (
    cachedResult !== null &&
    cachedRoots === roots &&
    cachedActiveFilters === inputs.activeFilters &&
    cachedVersion === inputs.searchResultsVersion
  );
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Produces a filtered view of the tree. When no filters are active,
 * returns the original roots unchanged (zero allocation).
 *
 * Each DirNode in the result has:
 * - children: only dirs containing at least one matching descendant
 * - files: only files matching all active filters
 * - stats/totalFiles/sizeBytes/path/name: unchanged (shared by reference)
 */
export function filterTree(roots: DirNode[], inputs: FilterInputs): FilteredTree {
  const { activeFilters, searchResults, searchAncestorPaths } = inputs;

  const isFiltered = activeFilters.size > 0 || searchResults !== null;

  // No filters active — return originals
  if (!isFiltered) {
    let total = 0;
    for (const r of roots) total += r.totalFiles;
    cachedResult = { roots, isFiltered: false, totalVisibleFiles: total, totalVisibleMatches: 0 };
    cachedRoots = roots;
    cachedActiveFilters = activeFilters;
    cachedVersion = inputs.searchResultsVersion;
    return cachedResult;
  }

  // Check cache
  if (cacheValid(roots, inputs)) {
    return cachedResult!;
  }

  // Build file predicate
  const hasLangFilter = activeFilters.size > 0;
  const hasSearchFilter = searchResults !== null;

  function fileVisible(f: FileNode): boolean {
    if (hasLangFilter && !activeFilters.has(f.langName)) return false;
    if (hasSearchFilter && !searchResults!.has(f.path)) return false;
    return true;
  }

  // Fast path: when only search is active (no lang filter), use ancestor
  // path index for O(1) directory checks instead of recursive tree walks.
  const useAncestorIndex = hasSearchFilter && !hasLangFilter && searchAncestorPaths !== null;

  // Recompute stats/totalFiles/sizeBytes on a filtered clone from its
  // filtered files + already-recomputed children (bottom-up).
  function recomputeNodeStats(clone: DirNode): void {
    const counts = new Map<string, { color: string; count: number }>();
    let totalFiles = 0;
    let sizeBytes = 0;

    for (const f of clone.files || []) {
      const ex = counts.get(f.langName);
      if (ex) { ex.count++; } else { counts.set(f.langName, { color: f.langColor, count: 1 }); }
      totalFiles++;
      sizeBytes += f.sizeBytes || 0;
    }
    for (const c of clone.children) {
      for (const s of c.stats) {
        const ex = counts.get(s.name);
        if (ex) { ex.count += s.count; } else { counts.set(s.name, { color: s.color, count: s.count }); }
      }
      totalFiles += c.totalFiles;
      sizeBytes += c.sizeBytes;
    }

    clone.stats = Array.from(counts.entries())
      .map(([name, { color, count }]) => ({ name, color, count }))
      .sort((a, b) => b.count - a.count);
    clone.totalFiles = totalFiles;
    clone.sizeBytes = sizeBytes;
  }

  // Memoize per-node results for this filterTree call
  const memo = new WeakMap<DirNode, DirNode | null>();

  function filterNode(node: DirNode): DirNode | null {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;

    // Fast path: ancestor index says this dir has no matching descendants
    if (useAncestorIndex && !searchAncestorPaths!.has(node.path)) {
      // Still need to check if this node has direct file matches
      const filteredFiles = (node.files || []).filter(f => fileVisible(f));
      if (filteredFiles.length === 0) {
        memo.set(node, null);
        return null;
      }
      // Has file matches but no child matches — shallow clone with no children
      const clone = { ...node, children: [], files: filteredFiles };
      recomputeNodeStats(clone);
      memo.set(node, clone);
      return clone;
    }

    // Filter files
    const filteredFiles = (node.files || []).filter(f => fileVisible(f));

    // Filter children recursively
    const filteredChildren: DirNode[] = [];
    for (const child of node.children) {
      const fc = filterNode(child);
      if (fc !== null) filteredChildren.push(fc);
    }

    // Prune if nothing visible
    if (filteredFiles.length === 0 && filteredChildren.length === 0) {
      memo.set(node, null);
      return null;
    }

    // Shallow clone with filtered arrays and recomputed stats
    const clone = { ...node, children: filteredChildren, files: filteredFiles };
    recomputeNodeStats(clone);
    memo.set(node, clone);
    return clone;
  }

  const filteredRoots: DirNode[] = [];
  let totalVisibleFiles = 0;
  let totalVisibleMatches = 0;
  for (const root of roots) {
    const fr = filterNode(root);
    if (fr !== null) filteredRoots.push(fr);
  }
  // Count visible files and matches by walking the filtered tree.
  function countFiles(node: DirNode): void {
    for (const f of (node.files || [])) {
      totalVisibleFiles++;
      if (hasSearchFilter) {
        const m = searchResults!.get(f.path);
        if (m) { for (let i = 0; i < m.length; i++) { if (!m[i].isContext) totalVisibleMatches++; } }
      }
    }
    for (const c of node.children) countFiles(c);
  }
  for (const r of filteredRoots) countFiles(r);

  const result: FilteredTree = { roots: filteredRoots, isFiltered: true, totalVisibleFiles, totalVisibleMatches };

  // Update cache
  cachedResult = result;
  cachedRoots = roots;
  cachedActiveFilters = activeFilters;
  cachedVersion = inputs.searchResultsVersion;

  return result;
}
