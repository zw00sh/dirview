// FlatRow types for virtual scrolling.
// Each row in the flattened tree is a discriminated union member with a pre-computed
// height and cumulative offsetY for O(1) position lookup during scroll rendering.

import type { DirNode, FileNode, SearchMatch, IndentAncestor } from '../types';

// ── Row heights (px) ─────────────────────────────────────────────────────────

export const ROW_HEIGHT_DIR = 22;
export const ROW_HEIGHT_FILE = 22;
export const ROW_HEIGHT_TRUNCATED = 22;
export const ROW_HEIGHT_MORE_MATCHES = 22;
export const ROW_HEIGHT_MATCH_LINE = 18;
export const ROW_HEIGHT_CONTEXT_LINE = 18;
export const ROW_HEIGHT_MATCH_SPACER = 6;

// ── FlatRow base fields ──────────────────────────────────────────────────────

interface FlatRowBase {
  key: string;
  depth: number;
  height: number;
  offsetY: number;        // computed in post-pass
  ancestors: IndentAncestor[];
}

// ── FlatRow variants ─────────────────────────────────────────────────────────

export interface DirFlatRow extends FlatRowBase {
  type: 'dir';
  height: typeof ROW_HEIGHT_DIR;
  /** The display node after folder compaction. Used for keys, sticky-overlay indexing,
   *  and expand-state lookups — all of which key on the leaf of a compacted chain. */
  node: DirNode;
  /** The pre-compaction node, when compaction collapsed a single-child chain. The
   *  renderer needs this so it can rebuild the full "parent / child" segment chain
   *  for display; using only `node` would drop the parent name and make sorts look
   *  broken (sort key is the parent's name, but display would show only the leaf). */
  originalNode?: DirNode;
  isExpanded: boolean;
  hasChildren: boolean;
  maxMetric: number;
  clientWidth: number;
  /** True when this row represents a workspace folder root in a multi-root workspace.
   *  Renderer uses this to display a workspace icon and (optionally) distinct styling. */
  isWorkspaceRoot?: boolean;
}

export interface FileFlatRow extends FlatRowBase {
  type: 'file';
  height: typeof ROW_HEIGHT_FILE;
  file: FileNode;
  /** Whether this file has search matches (pre-computed at flatten time so the renderer
   *  doesn't need to read global search state). */
  hasMatches: boolean;
  maxFileMetric: number;
  clientWidth: number;
}

export interface TruncatedFlatRow extends FlatRowBase {
  type: 'truncated';
  height: typeof ROW_HEIGHT_TRUNCATED;
  hiddenFiles: FileNode[];
  dirPath: string;
  maxMetric: number;
  clientWidth: number;
}

/** A single merged match group — contains match lines + context lines rendered as one block. */
export interface MatchGroupFlatRow extends FlatRowBase {
  type: 'matchGroup';
  file: FileNode;
  /** Pre-grouped match data: each entry has matchGroup (same-line matches) + contextBefore. */
  matches: Array<{
    matchGroup: SearchMatch[];
    matchLine: number;
    contextBefore: SearchMatch[];
  }>;
  contextAfter: SearchMatch[];
  dedent: number;
  /** Whether there's a line gap before this group (renders a spacer). */
  hasGap: boolean;
}

export interface MoreMatchesFlatRow {
  type: 'moreMatches';
  key: string;
  depth: number;
  height: typeof ROW_HEIGHT_MORE_MATCHES;
  offsetY: number;
  count: number;
  filePath: string;
  ancestors: IndentAncestor[];
}

export type FlatRow =
  | DirFlatRow
  | FileFlatRow
  | TruncatedFlatRow
  | MatchGroupFlatRow
  | MoreMatchesFlatRow;

// ── Flatten result ───────────────────────────────────────────────────────────

export interface FlattenResult {
  flatRows: FlatRow[];
  totalHeight: number;
  totalVisibleFiles: number;
  totalVisibleMatches: number;
  /** Roots after filterTree — stats/totalFiles/sizeBytes reflect the filtered subset. */
  filteredRoots: DirNode[];
  /** Per-language stats reflecting search/include/exclude only (not language filters). */
  searchFilteredStats: Array<{ name: string; color: string; count: number }>;
}

export interface FlattenOptions {
  /** Client width for bar scaling. Defaults to 300 if not provided. */
  clientWidth?: number;
}
