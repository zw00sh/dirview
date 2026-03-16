import * as vscode from 'vscode';
import { DirNode } from './types';
import { IgnoreFilter } from './ignoreFilter';
import { getLangInfo } from '../language/languageMap';
import { isVcsDir } from './constants';
import { parallelMap } from './concurrency';
import type { ScanWorkerClient } from './scanWorkerClient';

export interface ScanResult {
  roots: DirNode[];
  totalFiles: number;
  isLocal: boolean;
}

export async function scanWorkspace(
  showIgnored: boolean,
  signal?: AbortSignal,
  workerClient?: ScanWorkerClient,
): Promise<ScanResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { roots: [], totalFiles: 0, isLocal: true };
  }

  const maxDepth = vscode.workspace.getConfiguration('dirview').get<number>('maxDepth', 0);
  const isLocal = folders.every(f => f.uri.scheme === 'file');

  if (isLocal && workerClient) {
    // Read files.exclude config on main thread (vscode API), pass as plain data to worker.
    const filesExcludePatterns = folders.map(f => {
      if (showIgnored) { return []; }
      const config = vscode.workspace.getConfiguration('files', f.uri);
      const exclude = config.get<Record<string, boolean>>('exclude') ?? {};
      return Object.entries(exclude).filter(([, v]) => v).map(([p]) => p);
    });

    // Wire abort signal → worker abort message.
    const abortHandler = () => workerClient.abort();
    signal?.addEventListener('abort', abortHandler, { once: true });

    try {
      const result = await workerClient.scan(
        folders.map(f => ({ fsPath: f.uri.fsPath, name: f.name })),
        maxDepth,
        showIgnored,
        filesExcludePatterns,
      );
      return { ...result, isLocal: true };
    } finally {
      signal?.removeEventListener('abort', abortHandler);
    }
  }

  // Remote path — uses vscode.workspace.fs APIs, stays on main thread.
  const roots = await Promise.all(folders.map(async (folder) => {
    const filter = new IgnoreFilter(folder.uri, showIgnored);
    await filter.init();
    const visitedPaths = new Set<string>();
    return scanDirRemote(folder.uri, folder.name, '', filter, visitedPaths, 0, maxDepth, signal);
  }));

  let totalFiles = 0;
  for (const node of roots) { totalFiles += node.totalFiles; }

  return { roots, totalFiles, isLocal };
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

function emptyNode(name: string, relPath: string): DirNode {
  return { name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [] };
}
