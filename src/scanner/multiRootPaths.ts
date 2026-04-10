// Path uniqueness utilities for multi-root workspaces.
//
// In single-root workspaces, DirNode.path is workspace-folder-relative (e.g. '', 'src', 'src/utils').
// In multi-root workspaces, two roots can have subdirectories with the same relative path
// (e.g. both contain 'src'), causing collisions in state.expanded, navigation lookup, etc.
//
// The fix: in multi-root mode, prefix every DirNode.path with its root's name. The root itself
// becomes path === rootName; children become rootName/childPath; etc. FileNode.path is already
// an absolute fsPath and is left unchanged.
//
// Root names are workspace folder basenames, guaranteed unique by VSCode's workspace API.

import type { DirNode } from './types';

/** Recursively prefixes DirNode.path with its root's name. Multi-root only.
 *  Returns NEW DirNode objects without mutating the input tree. FileNode references
 *  are preserved (file paths are absolute, no transform needed).
 *  In single-root mode, returns the input unchanged. */
export function prefixRootPaths(roots: DirNode[]): DirNode[] {
  if (roots.length <= 1) { return roots; }
  return roots.map(r => prefixSubtree(r, r.name));
}

function prefixSubtree(node: DirNode, prefix: string): DirNode {
  // The root itself: its original path is '', so the new path is just the prefix.
  // For descendants, original path is something like 'src/utils' → 'frontend/src/utils'.
  const newPath = node.path === '' ? prefix : prefix + '/' + node.path;
  return {
    name: node.name,
    path: newPath,
    stats: node.stats,
    totalFiles: node.totalFiles,
    sizeBytes: node.sizeBytes,
    totalLines: node.totalLines,
    files: node.files,
    children: node.children.map(c => prefixSubtree(c, prefix)),
  };
}

/** Splits a prefixed path like "frontend/src/scanner" into { rootName, relPath }.
 *  - "frontend/src/scanner" → { rootName: "frontend", relPath: "src/scanner" }
 *  - "frontend"             → { rootName: "frontend", relPath: "" }
 *  - ""                     → { rootName: "", relPath: "" } */
export function splitRootPath(prefixedPath: string): { rootName: string; relPath: string } {
  if (prefixedPath === '') { return { rootName: '', relPath: '' }; }
  const slashIdx = prefixedPath.indexOf('/');
  if (slashIdx === -1) { return { rootName: prefixedPath, relPath: '' }; }
  return { rootName: prefixedPath.slice(0, slashIdx), relPath: prefixedPath.slice(slashIdx + 1) };
}
