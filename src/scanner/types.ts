import { SortMode } from '../config';

export interface ScanUpdatePayload {
  roots: DirNode[];
  autoRescanEnabled: boolean;
  sortMode: SortMode;
  truncateThreshold: number;
  showIgnored: boolean;
  sidebarStickyHeadersEnabled: boolean;
  tabStickyHeadersEnabled: boolean;
}

export interface FileTypeStats {
  name: string;
  color: string;
  count: number;
}

export interface FileNode {
  name: string;
  path: string;      // absolute fsPath (for opening in editor)
  langName: string;
  langColor: string;
  sizeBytes: number;
}

export interface DirNode {
  name: string;
  path: string;           // relative to workspace root
  stats: FileTypeStats[]; // sorted by count desc, covers full subtree
  totalFiles: number;
  sizeBytes: number;      // total bytes of all files in subtree
  files: FileNode[];      // direct file children of this directory
  children: DirNode[];
}
