/**
 * Worker thread for local filesystem scanning.
 * No vscode imports — runs entirely on raw Node.js APIs.
 */
import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { DirNode } from './types';
import { IgnoreFilterBase } from './ignoreFilterBase';
import { getLangInfo } from '../language/languageMap';
import { isVcsDir } from './constants';
import { parallelMap } from './concurrency';

/** Module-level abort flag — replaces AbortSignal across thread boundary. */
let aborted = false;

async function scanDirLocal(
  dirPath: string,
  name: string,
  relPath: string,
  filter: IgnoreFilterBase,
  visitedPaths: Set<string>,
  depth: number,
  maxDepth: number,
): Promise<DirNode> {
  if (aborted) { return emptyNode(name, relPath); }

  if (visitedPaths.has(dirPath)) {
    return emptyNode(name, relPath);
  }
  visitedPaths.add(dirPath);

  const node: DirNode = {
    name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [],
  };

  if (maxDepth > 0 && depth > maxDepth) { return node; }
  if (aborted) { return node; }

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
      scanDirLocal(entryPath, entryName, entryRelPath, filter, visitedPaths, depth + 1, maxDepth),
    20,
  );

  if (aborted) { return node; }

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

function emptyNode(name: string, relPath: string): DirNode {
  return { name, path: relPath, stats: [], totalFiles: 0, sizeBytes: 0, files: [], children: [] };
}

// ── Message handler ──────────────────────────────────────────────────────

parentPort!.on('message', async (msg: { type: string; id?: number; folders?: Array<{ fsPath: string; name: string }>; maxDepth?: number; showIgnored?: boolean; filesExcludePatterns?: string[][] }) => {
  if (msg.type === 'abort') {
    aborted = true;
    return;
  }

  if (msg.type === 'scan') {
    aborted = false;
    const { id, folders, maxDepth, showIgnored, filesExcludePatterns } = msg as {
      id: number;
      folders: Array<{ fsPath: string; name: string }>;
      maxDepth: number;
      showIgnored: boolean;
      filesExcludePatterns: string[][];
    };

    try {
      const roots = await Promise.all(folders.map(async (folder, i) => {
        const filter = new IgnoreFilterBase();
        await filter.initFromPatterns(folder.fsPath, showIgnored, filesExcludePatterns[i] || []);
        const visitedPaths = new Set<string>();
        return scanDirLocal(folder.fsPath, folder.name, '', filter, visitedPaths, 0, maxDepth);
      }));

      if (aborted) {
        parentPort!.postMessage({ type: 'aborted', id });
        return;
      }

      let totalFiles = 0;
      for (const node of roots) { totalFiles += node.totalFiles; }

      parentPort!.postMessage({ type: 'result', id, roots, totalFiles });
    } catch (err) {
      parentPort!.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
    }
  }
});
