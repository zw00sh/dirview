import * as vscode from 'vscode';
import { DirNode, FileNode, FileTypeStats } from './types';
import { IgnoreFilter } from './ignoreFilter';
import { getLangInfo } from '../language/languageMap';
import { VCS_DIRS } from './constants';

export interface ScanResult {
  roots: DirNode[];
  totalFiles: number;
}

export async function scanWorkspace(showIgnored: boolean): Promise<ScanResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { roots: [], totalFiles: 0 };
  }

  const maxDepth = vscode.workspace.getConfiguration('dirview').get<number>('maxDepth', 10);

  const roots: DirNode[] = [];
  let totalFiles = 0;

  for (const folder of folders) {
    const filter = new IgnoreFilter(folder.uri, showIgnored);
    await filter.init();
    const visitedPaths = new Set<string>();
    const node = await scanDir(folder.uri, folder.name, '', filter, visitedPaths, 0, maxDepth);
    roots.push(node);
    totalFiles += node.totalFiles;
  }

  return { roots, totalFiles };
}

async function scanDir(
  dirUri: vscode.Uri,
  name: string,
  relPath: string,
  filter: IgnoreFilter,
  visitedPaths: Set<string>,
  depth: number,
  maxDepth: number
): Promise<DirNode> {
  const fsPath = dirUri.fsPath;
  if (visitedPaths.has(fsPath)) {
    return emptyNode(name, relPath);
  }
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

  if (depth > maxDepth) {
    return node;
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return node;
  }

  const typeCounts = new Map<string, { color: string; count: number }>();

  for (const [entryName, fileType] of entries) {
    const entryRelPath = relPath ? `${relPath}/${entryName}` : entryName;
    const entryUri = vscode.Uri.joinPath(dirUri, entryName);

    const isSymlink = (fileType & vscode.FileType.SymbolicLink) !== 0;
    const isDir = (fileType & vscode.FileType.Directory) !== 0;
    const isFile = (fileType & vscode.FileType.File) !== 0;

    // isDir covers both real directories and symlinks-to-directories (VSCode sets both bits).
    // The isSymlink && !isFile branch catches edge cases (e.g. symlinks to dirs on some platforms).
    if (isDir || (isSymlink && !isFile)) {
      if (VCS_DIRS.has(entryName)) {
        continue;
      }

      const exclude = await filter.shouldExcludeDir(entryName, entryRelPath, dirUri);
      if (exclude) {
        continue;
      }

      const child = await scanDir(entryUri, entryName, entryRelPath, filter, visitedPaths, depth + 1, maxDepth);
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
    } else if (isFile || isSymlink) {
      const exclude = await filter.shouldExcludeFile(entryName, entryRelPath, dirUri);
      if (exclude) {
        continue;
      }

      const lang = getLangInfo(entryName);
      node.totalFiles++;

      // Get file size
      let sizeBytes = 0;
      try {
        const stat = await vscode.workspace.fs.stat(entryUri);
        sizeBytes = stat.size;
      } catch {
        // ignore stat errors
      }
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
  }

  node.stats = Array.from(typeCounts.entries())
    .map(([n, { color, count }]) => ({ name: n, color, count }))
    .sort((a, b) => b.count - a.count);

  // Default sort: by name (sorting by file count / size is done client-side)
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));

  visitedPaths.delete(fsPath);
  return node;
}

function emptyNode(name: string, path: string): DirNode {
  return { name, path, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [] };
}
