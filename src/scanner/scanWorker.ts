/**
 * Worker thread for local filesystem scanning.
 * No vscode imports — runs entirely on raw Node.js APIs.
 */
import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import type { ScanWorkerRequest, ScanWorkerResponse } from './types';
import { IgnoreFilterBase } from './ignoreFilterBase';
import { parallelMap } from './concurrency';
import { scanDirCore, type ScanAdapter } from './scanDirCore';

// ── Local filesystem adapter ──────────────────────────────────────────────

class LocalAdapter implements ScanAdapter<string> {
  constructor(private signal: AbortSignal) {}

  async readDir(dirPath: string) {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries.map(d => ({
        name: d.name,
        isDir: d.isDirectory(),
        isFile: d.isFile() || d.isSymbolicLink(),
      }));
    } catch {
      return null;
    }
  }

  joinPath(parent: string, child: string) {
    return path.join(parent, child);
  }

  pathKey(dirPath: string) {
    return dirPath;
  }

  async loadLocalIgnore(filter: IgnoreFilterBase, dirPath: string) {
    return filter.loadLocalIgnoreByPath(dirPath);
  }

  isAborted() {
    return this.signal.aborted;
  }

  async getFileSizes(files: Array<{ name: string; path: string }>) {
    return parallelMap(
      files,
      async ({ path: filePath }) => {
        try { return (await fs.promises.stat(filePath)).size; }
        catch { return 0; }
      },
      50
    );
  }
}

// ── Message handler ──────────────────────────────────────────────────────

let currentAc: AbortController | null = null;

parentPort!.on('message', async (msg: ScanWorkerRequest) => {
  if (msg.type === 'abort') {
    currentAc?.abort();
    return;
  }

  if (msg.type === 'scan') {
    const ac = new AbortController();
    currentAc = ac;
    const { id, folders, maxDepth, showIgnored, filesExcludePatterns } = msg;

    try {
      const adapter = new LocalAdapter(ac.signal);
      const roots = await Promise.all(folders.map(async (folder, i) => {
        const filter = new IgnoreFilterBase();
        await filter.initFromPatterns(folder.fsPath, showIgnored, filesExcludePatterns[i] || []);
        const visitedPaths = new Set<string>();
        return scanDirCore(adapter, folder.fsPath, folder.name, '', filter, visitedPaths, 0, maxDepth);
      }));

      if (ac.signal.aborted) {
        parentPort!.postMessage({ type: 'aborted', id } satisfies ScanWorkerResponse);
        return;
      }

      let totalFiles = 0;
      for (const node of roots) { totalFiles += node.totalFiles; }

      parentPort!.postMessage({ type: 'result', id, roots, totalFiles } satisfies ScanWorkerResponse);
    } catch (err) {
      parentPort!.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) } satisfies ScanWorkerResponse);
    }
  }
});
