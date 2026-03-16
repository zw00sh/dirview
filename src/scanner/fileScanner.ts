import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DirNode, FileNode } from './types';
import { IgnoreFilter } from './ignoreFilter';
import { getLangInfo } from '../language/languageMap';
import { isVcsDir } from './constants';
import { parallelMap } from './concurrency';

export interface ScanResult {
  roots: DirNode[];
  totalFiles: number;
  isLocal: boolean;
}

export async function scanWorkspace(showIgnored: boolean, signal?: AbortSignal): Promise<ScanResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { roots: [], totalFiles: 0, isLocal: true };
  }

  const maxDepth = vscode.workspace.getConfiguration('dirview').get<number>('maxDepth', 0);
  const isLocal = folders.every(f => f.uri.scheme === 'file');

  const roots = await Promise.all(folders.map(async (folder) => {
    const filter = new IgnoreFilter(folder.uri, showIgnored);
    await filter.init();
    const visitedPaths = new Set<string>();
    if (isLocal) {
      return scanDirLocal(folder.uri.fsPath, folder.name, '', filter, visitedPaths, 0, maxDepth, signal);
    }
    return scanDirRemote(folder.uri, folder.name, '', filter, visitedPaths, 0, maxDepth, signal);
  }));

  let totalFiles = 0;
  for (const node of roots) { totalFiles += node.totalFiles; }

  return { roots, totalFiles, isLocal };
}

/** Fast local scan using raw Node.js fs — no vscode API overhead. */
async function scanDirLocal(
  dirPath: string,
  name: string,
  relPath: string,
  filter: IgnoreFilter,
  visitedPaths: Set<string>,
  depth: number,
  maxDepth: number,
  signal?: AbortSignal
): Promise<DirNode> {
  if (signal?.aborted) { return emptyNode(name, relPath); }

  const realPath = dirPath;
  if (visitedPaths.has(realPath)) {
    return emptyNode(name, relPath);
  }
  visitedPaths.add(realPath);

  const node: DirNode = {
    name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [],
  };

  if (maxDepth > 0 && depth > maxDepth) { return node; }
  if (signal?.aborted) { return node; }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return node;
  }

  const localIg = await filter.loadLocalIgnoreByPath(dirPath);

  const pendingDirs: { entryName: string; entryRelPath: string; entryPath: string }[] = [];
  const pendingFiles: { entryName: string; entryPath: string }[] = [];

  for (const entry of entries) {
    const entryName = entry.name;
    const entryRelPath = relPath ? `${relPath}/${entryName}` : entryName;

    if (entry.isDirectory()) {
      if (isVcsDir(entryName)) { continue; }
      if (filter.shouldExcludeDirSync(entryName, entryRelPath, localIg)) { continue; }
      pendingDirs.push({ entryName, entryRelPath, entryPath: path.join(dirPath, entryName) });
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      if (filter.shouldExcludeFileSync(entryName, entryRelPath, localIg)) { continue; }
      pendingFiles.push({ entryName, entryPath: path.join(dirPath, entryName) });
    }
  }

  const childResults = await parallelMap(
    pendingDirs,
    ({ entryName, entryRelPath, entryPath }) =>
      scanDirLocal(entryPath, entryName, entryRelPath, filter, visitedPaths, depth + 1, maxDepth, signal),
    20,
    signal
  );

  if (signal?.aborted) { return node; }

  const typeCounts = new Map<string, { color: string; count: number }>();

  for (const child of childResults) {
    node.children.push(child);
    node.totalFiles += child.totalFiles;
    node.sizeBytes += child.sizeBytes;
    for (const s of child.stats) {
      const existing = typeCounts.get(s.name);
      if (existing) { existing.count += s.count; }
      else { typeCounts.set(s.name, { color: s.color, count: s.count }); }
    }
  }

  const fileSizes = await parallelMap(
    pendingFiles,
    async ({ entryPath }) => {
      try { return (await fs.promises.stat(entryPath)).size; }
      catch { return 0; }
    },
    50
  );

  for (let i = 0; i < pendingFiles.length; i++) {
    const { entryName, entryPath } = pendingFiles[i];
    const sizeBytes = fileSizes[i];
    const lang = getLangInfo(entryName);
    node.totalFiles++;
    node.sizeBytes += sizeBytes;

    node.files.push({ name: entryName, path: entryPath, langName: lang.name, langColor: lang.color, sizeBytes });

    const existing = typeCounts.get(lang.name);
    if (existing) { existing.count++; }
    else { typeCounts.set(lang.name, { color: lang.color, count: 1 }); }
  }

  node.stats = Array.from(typeCounts.entries())
    .map(([n, { color, count }]) => ({ name: n, color, count }))
    .sort((a, b) => b.count - a.count);

  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));

  return node;
}

/** Remote scan using vscode.workspace.fs — supports SSH, containers, etc.
 *  Skips stat calls (no file sizes on remote filesystems). */
async function scanDirRemote(
  dirUri: vscode.Uri,
  name: string,
  relPath: string,
  filter: IgnoreFilter,
  visitedPaths: Set<string>,
  depth: number,
  maxDepth: number,
  signal?: AbortSignal
): Promise<DirNode> {
  if (signal?.aborted) { return emptyNode(name, relPath); }

  const fsPath = dirUri.fsPath;
  if (visitedPaths.has(fsPath)) {
    return emptyNode(name, relPath);
  }
  visitedPaths.add(fsPath);

  const node: DirNode = {
    name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [],
  };

  if (maxDepth > 0 && depth > maxDepth) { return node; }
  if (signal?.aborted) { return node; }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return node;
  }

  const localIg = await filter.loadLocalIgnore(dirUri);

  const pendingDirs: { entryName: string; entryRelPath: string; entryUri: vscode.Uri }[] = [];
  const pendingFiles: { entryName: string; entryUri: vscode.Uri }[] = [];

  for (const [entryName, fileType] of entries) {
    const entryRelPath = relPath ? `${relPath}/${entryName}` : entryName;

    const isSymlink = (fileType & vscode.FileType.SymbolicLink) !== 0;
    const isDir = (fileType & vscode.FileType.Directory) !== 0;
    const isFile = (fileType & vscode.FileType.File) !== 0;

    if (isDir || (isSymlink && !isFile)) {
      if (isVcsDir(entryName)) { continue; }
      if (filter.shouldExcludeDirSync(entryName, entryRelPath, localIg)) { continue; }
      pendingDirs.push({ entryName, entryRelPath, entryUri: vscode.Uri.joinPath(dirUri, entryName) });
    } else if (isFile || isSymlink) {
      if (filter.shouldExcludeFileSync(entryName, entryRelPath, localIg)) { continue; }
      pendingFiles.push({ entryName, entryUri: vscode.Uri.joinPath(dirUri, entryName) });
    }
  }

  const childResults = await parallelMap(
    pendingDirs,
    ({ entryName, entryRelPath, entryUri }) =>
      scanDirRemote(entryUri, entryName, entryRelPath, filter, visitedPaths, depth + 1, maxDepth, signal),
    20,
    signal
  );

  if (signal?.aborted) { return node; }

  const typeCounts = new Map<string, { color: string; count: number }>();

  for (const child of childResults) {
    node.children.push(child);
    node.totalFiles += child.totalFiles;
    node.sizeBytes += child.sizeBytes;
    for (const s of child.stats) {
      const existing = typeCounts.get(s.name);
      if (existing) { existing.count += s.count; }
      else { typeCounts.set(s.name, { color: s.color, count: s.count }); }
    }
  }

  // No stat calls on remote — file sizes unavailable.
  for (const { entryName, entryUri } of pendingFiles) {
    const lang = getLangInfo(entryName);
    node.totalFiles++;

    node.files.push({ name: entryName, path: entryUri.fsPath, langName: lang.name, langColor: lang.color, sizeBytes: 0 });

    const existing = typeCounts.get(lang.name);
    if (existing) { existing.count++; }
    else { typeCounts.set(lang.name, { color: lang.color, count: 1 }); }
  }

  node.stats = Array.from(typeCounts.entries())
    .map(([n, { color, count }]) => ({ name: n, color, count }))
    .sort((a, b) => b.count - a.count);

  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));

  return node;
}

function emptyNode(name: string, path: string): DirNode {
  return { name, path, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [] };
}
