import * as vscode from 'vscode';
import { DirNode, FileNode } from './types';
import { IgnoreFilter } from './ignoreFilter';
import { getLangInfo } from '../language/languageMap';
import { isVcsDir } from './constants';
import { parallelMap } from './concurrency';

export interface ScanResult {
  roots: DirNode[];
  totalFiles: number;
}

export async function scanWorkspace(showIgnored: boolean, signal?: AbortSignal): Promise<ScanResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { roots: [], totalFiles: 0 };
  }

  const maxDepth = vscode.workspace.getConfiguration('dirview').get<number>('maxDepth', 0);

  // Scan all workspace folders in parallel — each has its own independent filter/visited state.
  // Promise.all preserves order, so roots are always in the same order as workspaceFolders.
  const roots = await Promise.all(folders.map(async (folder) => {
    const filter = new IgnoreFilter(folder.uri, showIgnored);
    await filter.init();
    const visitedPaths = new Set<string>();
    return scanDir(folder.uri, folder.name, '', filter, visitedPaths, 0, maxDepth, signal);
  }));

  let totalFiles = 0;
  for (const node of roots) { totalFiles += node.totalFiles; }

  return { roots, totalFiles };
}

async function scanDir(
  dirUri: vscode.Uri,
  name: string,
  relPath: string,
  filter: IgnoreFilter,
  visitedPaths: Set<string>,
  depth: number,
  maxDepth: number,
  signal?: AbortSignal
): Promise<DirNode> {
  // Return a partial node immediately if the scan was cancelled.
  if (signal?.aborted) { return emptyNode(name, relPath); }

  const fsPath = dirUri.fsPath;
  if (visitedPaths.has(fsPath)) {
    return emptyNode(name, relPath);
  }

  // Add to the shared visited set. This is safe because parallelMap runs in a
  // single JS thread — no concurrent mutation. Using a shared set (instead of
  // per-branch copies) ensures sibling branches detect symlinks to the same target.
  visitedPaths.add(fsPath);

  const node: DirNode = {
    name,
    path: relPath,
    stats: [],
    totalFiles: 0,
    sizeBytes: 0,
    files: [],
    children: [],
  };

  if (maxDepth > 0 && depth > maxDepth) {
    return node;
  }

  if (signal?.aborted) { return node; }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch (err) {
    if (DEV_MODE) { console.warn(`dirview: failed to read ${dirUri.fsPath}:`, err); }
    return node;
  }

  // Pass 1: classify and filter entries sequentially (filter may do async gitignore loads)
  const pendingDirs: { entryName: string; entryRelPath: string; entryUri: vscode.Uri }[] = [];
  const pendingFiles: { entryName: string; entryUri: vscode.Uri }[] = [];

  for (const [entryName, fileType] of entries) {
    const entryRelPath = relPath ? `${relPath}/${entryName}` : entryName;
    const entryUri = vscode.Uri.joinPath(dirUri, entryName);

    const isSymlink = (fileType & vscode.FileType.SymbolicLink) !== 0;
    const isDir = (fileType & vscode.FileType.Directory) !== 0;
    const isFile = (fileType & vscode.FileType.File) !== 0;

    if (isDir || (isSymlink && !isFile)) {
      if (isVcsDir(entryName)) { continue; }
      const exclude = await filter.shouldExcludeDir(entryName, entryRelPath, dirUri);
      if (exclude) { continue; }
      pendingDirs.push({ entryName, entryRelPath, entryUri });
    } else if (isFile || isSymlink) {
      const exclude = await filter.shouldExcludeFile(entryName, entryRelPath, dirUri);
      if (exclude) { continue; }
      pendingFiles.push({ entryName, entryUri });
    }
  }

  // Pass 2a: scan subdirectories in parallel (each gets its own copy of visitedPaths)
  const childResults = await parallelMap(
    pendingDirs,
    ({ entryName, entryRelPath, entryUri }) =>
      scanDir(entryUri, entryName, entryRelPath, filter, visitedPaths, depth + 1, maxDepth, signal),
    20,
    signal
  );

  // Return early if cancelled — childResults may contain empty placeholders.
  if (signal?.aborted) { return node; }

  const typeCounts = new Map<string, { color: string; count: number }>();

  for (const child of childResults) {
    node.children.push(child);
    node.totalFiles += child.totalFiles;
    node.sizeBytes += child.sizeBytes;
    for (const s of child.stats) {
      const existing = typeCounts.get(s.name);
      if (existing) {
        existing.count += s.count;
      } else {
        typeCounts.set(s.name, { color: s.color, count: s.count });
      }
    }
  }

  // Pass 2b: stat all files in parallel
  const fileSizes = await parallelMap(
    pendingFiles,
    async ({ entryUri }) => {
      try {
        const stat = await vscode.workspace.fs.stat(entryUri);
        return stat.size;
      } catch {
        return 0;
      }
    },
    50
  );

  for (let i = 0; i < pendingFiles.length; i++) {
    const { entryName, entryUri } = pendingFiles[i];
    const sizeBytes = fileSizes[i];
    const lang = getLangInfo(entryName);
    node.totalFiles++;
    node.sizeBytes += sizeBytes;

    const fileNode: FileNode = {
      name: entryName,
      path: entryUri.fsPath,
      langName: lang.name,
      langColor: lang.color,
      sizeBytes,
    };
    node.files.push(fileNode);

    const existing = typeCounts.get(lang.name);
    if (existing) {
      existing.count++;
    } else {
      typeCounts.set(lang.name, { color: lang.color, count: 1 });
    }
  }

  node.stats = Array.from(typeCounts.entries())
    .map(([n, { color, count }]) => ({ name: n, color, count }))
    .sort((a, b) => b.count - a.count);

  // Default sort: by name (sorting by file count / size is done client-side)
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));

  return node;
}

function emptyNode(name: string, path: string): DirNode {
  return { name, path, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [] };
}
