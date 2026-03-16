// Pre-render tree filtering layer.
// Produces a shallow-cloned tree with only visible nodes, so the renderer
// can render unconditionally without any filtering logic.

import type { DirNode, FileNode, SearchMatch } from './types';

export interface FilterInputs {
  activeFilters: Set<string>;
  searchResults: Map<string, SearchMatch[]> | null;
  searchAncestorPaths: Set<string> | null;
  fileFilterFn: ((name: string) => boolean) | null;
  searchResultsVersion: number;
}

export interface FilteredTree {
  roots: DirNode[];
  isFiltered: boolean;
}

// ── Cache ────────────────────────────────────────────────────────────────────

let cachedRoots: DirNode[] | null = null;
let cachedActiveFilters: Set<string> | null = null;
let cachedFileFilterFn: ((name: string) => boolean) | null = null;
let cachedVersion = -1;
let cachedResult: FilteredTree | null = null;

function cacheValid(roots: DirNode[], inputs: FilterInputs): boolean {
  return (
    cachedResult !== null &&
    cachedRoots === roots &&
    cachedActiveFilters === inputs.activeFilters &&
    cachedFileFilterFn === inputs.fileFilterFn &&
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
  const { activeFilters, searchResults, searchAncestorPaths, fileFilterFn } = inputs;

  const isFiltered = activeFilters.size > 0 || searchResults !== null || fileFilterFn !== null;

  // No filters active — return originals
  if (!isFiltered) {
    cachedResult = { roots, isFiltered: false };
    cachedRoots = roots;
    cachedActiveFilters = activeFilters;
    cachedFileFilterFn = fileFilterFn;
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
  const hasFileFilter = fileFilterFn !== null;

  function fileVisible(f: FileNode): boolean {
    if (hasLangFilter && !activeFilters.has(f.langName)) return false;
    if (hasSearchFilter && !searchResults!.has(f.path)) return false;
    if (hasFileFilter && !fileFilterFn!(f.name)) return false;
    return true;
  }

  // Fast path: when only search is active (no lang/file filter), use ancestor
  // path index for O(1) directory checks instead of recursive tree walks.
  const useAncestorIndex = hasSearchFilter && !hasLangFilter && !hasFileFilter && searchAncestorPaths !== null;

  // Memoize per-node results for this filterTree call
  const memo = new WeakMap<DirNode, DirNode | null>();

  function filterNode(node: DirNode): DirNode | null {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;

    // Fast path: ancestor index says this dir has no matching descendants
    if (useAncestorIndex && !searchAncestorPaths!.has(node.path)) {
      // Still need to check if this node has direct file matches
      const filteredFiles = (node.files || []).filter(fileVisible);
      if (filteredFiles.length === 0) {
        memo.set(node, null);
        return null;
      }
      // Has file matches but no child matches — shallow clone with no children
      const clone = { ...node, children: [], files: filteredFiles };
      memo.set(node, clone);
      return clone;
    }

    // Filter files
    const filteredFiles = (node.files || []).filter(fileVisible);

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

    // Shallow clone with filtered arrays
    const clone = { ...node, children: filteredChildren, files: filteredFiles };
    memo.set(node, clone);
    return clone;
  }

  const filteredRoots: DirNode[] = [];
  for (const root of roots) {
    const fr = filterNode(root);
    if (fr !== null) filteredRoots.push(fr);
  }

  const result: FilteredTree = { roots: filteredRoots, isFiltered: true };

  // Update cache
  cachedResult = result;
  cachedRoots = roots;
  cachedActiveFilters = activeFilters;
  cachedFileFilterFn = fileFilterFn;
  cachedVersion = inputs.searchResultsVersion;

  return result;
}
