import { SortMode } from '../config';

export interface ScanUpdatePayload {
  roots: DirNode[];
  autoRescanEnabled: boolean;
  sortMode: SortMode;
  truncateThreshold: number;
  showIgnored: boolean;
  sidebarStickyHeadersEnabled: boolean;
  tabStickyHeadersEnabled: boolean;
  isLocal: boolean;
}

export interface FileTypeStats {
  name: string;
  color: string;
  count: number;
  sizeBytes: number;
  lineCount: number;
}

export interface FileNode {
  name: string;
  path: string;      // absolute fsPath (for opening in editor)
  langName: string;
  langColor: string;
  sizeBytes: number;
  lineCount: number;
  isBinary?: boolean; // true when file contains null bytes (binary detection)
}

export interface DirNode {
  name: string;
  path: string;           // relative to workspace root
  stats: FileTypeStats[]; // sorted by count desc, covers full subtree
  totalFiles: number;
  sizeBytes: number;      // total bytes of all files in subtree
  totalLines: number;     // total line count of all files in subtree
  files: FileNode[];      // direct file children of this directory
  children: DirNode[];
}

// ── Worker thread message types ──────────────────────────────────────────

export type ScanWorkerRequest =
  | { type: 'scan'; id: number; folders: Array<{ fsPath: string; name: string }>; maxDepth: number; showIgnored: boolean; filesExcludePatterns: string[][] }
  | { type: 'abort' };

export type ScanWorkerResponse =
  | { type: 'result'; id: number; roots: DirNode[]; totalFiles: number }
  | { type: 'error'; id: number; message: string }
  | { type: 'aborted'; id: number };
