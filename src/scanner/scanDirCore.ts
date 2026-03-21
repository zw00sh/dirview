/**
 * Shared directory scan algorithm — no vscode imports.
 * Used by both the worker thread (local scans) and main thread (remote scans)
 * via I/O adapters that abstract filesystem operations.
 */
import type { DirNode, FileNode } from './types';
import type { IgnoreFilterBase } from './ignoreFilterBase';
import type { Ignore } from 'ignore';
import { getLangInfo } from '../language/languageMap';
import { isVcsDir } from './constants';
import { parallelMap } from './concurrency';

/** Normalized directory entry returned by the adapter. */
export interface DirEntry {
  name: string;
  isDir: boolean;
  isFile: boolean;
}

/** I/O adapter: abstracts filesystem operations so the scan algorithm
 *  can work on both local (worker thread) and remote (main thread) filesystems. */
export interface ScanAdapter<TPath> {
  /** Read directory entries. Returns null on error. */
  readDir(dirPath: TPath): Promise<DirEntry[] | null>;
  /** Join a parent path with a child name. */
  joinPath(parent: TPath, child: string): TPath;
  /** Get a stable string key for deduplication (symlink cycle detection) and FileNode.path. */
  pathKey(dirPath: TPath): string;
  /** Load local .gitignore for a directory. */
  loadLocalIgnore(filter: IgnoreFilterBase, dirPath: TPath): Promise<Ignore>;
  /** Check if the scan has been aborted. */
  isAborted(): boolean;
  /** Get file metrics (size + line count) for a batch of files.
   *  Remote adapters return all zeros (no stat/content available). */
  getFileMetrics(files: Array<{ name: string; path: TPath }>): Promise<Array<{ sizeBytes: number; lineCount: number; isBinary?: boolean }>>;
}

export function emptyNode(name: string, relPath: string): DirNode {
  return { name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, totalLines: 0, files: [], children: [] };
}

export async function scanDirCore<TPath>(
  adapter: ScanAdapter<TPath>,
  dirPath: TPath,
  name: string,
  relPath: string,
  filter: IgnoreFilterBase,
  visitedPaths: Set<string>,
  depth: number,
  maxDepth: number,
): Promise<DirNode> {
  if (adapter.isAborted()) { return emptyNode(name, relPath); }

  const key = adapter.pathKey(dirPath);
  if (visitedPaths.has(key)) { return emptyNode(name, relPath); }
  visitedPaths.add(key);

  const node: DirNode = {
    name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, totalLines: 0, files: [], children: [],
  };

  if (maxDepth > 0 && depth > maxDepth) { return node; }
  if (adapter.isAborted()) { return node; }

  const entries = await adapter.readDir(dirPath);
  if (!entries) { return node; }

  const localIg = await adapter.loadLocalIgnore(filter, dirPath);

  const pendingDirs: { entryName: string; entryRelPath: string; entryPath: TPath }[] = [];
  const pendingFiles: { entryName: string; entryPath: TPath }[] = [];

  for (const entry of entries) {
    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

    if (entry.isDir) {
      if (isVcsDir(entry.name)) { continue; }
      if (filter.shouldExcludeDirSync(entry.name, entryRelPath, localIg)) { continue; }
      pendingDirs.push({ entryName: entry.name, entryRelPath, entryPath: adapter.joinPath(dirPath, entry.name) });
    } else if (entry.isFile) {
      if (filter.shouldExcludeFileSync(entry.name, entryRelPath, localIg)) { continue; }
      pendingFiles.push({ entryName: entry.name, entryPath: adapter.joinPath(dirPath, entry.name) });
    }
  }

  const childResults = await parallelMap(
    pendingDirs,
    ({ entryName, entryRelPath, entryPath }) =>
      scanDirCore(adapter, entryPath, entryName, entryRelPath, filter, visitedPaths, depth + 1, maxDepth),
    20,
  );

  if (adapter.isAborted()) { return node; }

  const typeCounts = new Map<string, { color: string; count: number; sizeBytes: number; lineCount: number }>();

  for (const child of childResults) {
    node.children.push(child);
    node.totalFiles += child.totalFiles;
    node.sizeBytes += child.sizeBytes;
    node.totalLines += child.totalLines;
    for (const s of child.stats) {
      const existing = typeCounts.get(s.name);
      if (existing) { existing.count += s.count; existing.sizeBytes += s.sizeBytes; existing.lineCount += s.lineCount; }
      else { typeCounts.set(s.name, { color: s.color, count: s.count, sizeBytes: s.sizeBytes, lineCount: s.lineCount }); }
    }
  }

  const fileMetrics = await adapter.getFileMetrics(pendingFiles.map(f => ({ name: f.entryName, path: f.entryPath })));

  for (let i = 0; i < pendingFiles.length; i++) {
    const { entryName, entryPath } = pendingFiles[i];
    const { sizeBytes, lineCount, isBinary } = fileMetrics[i];
    const lang = getLangInfo(entryName);
    node.totalFiles++;
    node.sizeBytes += sizeBytes;
    node.totalLines += lineCount;

    const fileNode: FileNode = { name: entryName, path: adapter.pathKey(entryPath), langName: lang.name, langColor: lang.color, sizeBytes, lineCount };
    if (isBinary) { fileNode.isBinary = true; }
    node.files.push(fileNode);

    const existing = typeCounts.get(lang.name);
    if (existing) { existing.count++; existing.sizeBytes += sizeBytes; existing.lineCount += lineCount; }
    else { typeCounts.set(lang.name, { color: lang.color, count: 1, sizeBytes, lineCount }); }
  }

  node.stats = Array.from(typeCounts.entries())
    .map(([n, { color, count, sizeBytes, lineCount }]) => ({ name: n, color, count, sizeBytes, lineCount }))
    .sort((a, b) => b.count - a.count);

  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));

  return node;
}
