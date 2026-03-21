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
        isFile: d.isFile(),
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

  async getFileMetrics(files: Array<{ name: string; path: string }>) {
    return parallelMap(
      files,
      async ({ path: filePath }) => {
        let fd: fs.promises.FileHandle | null = null;
        try {
          fd = await fs.promises.open(filePath, 'r');
          const stat = await fd.stat();
          const sizeBytes = stat.size;
          if (sizeBytes === 0) { return { sizeBytes: 0, lineCount: 0 }; }
          const readLen = Math.min(sizeBytes, 1024 * 1024); // cap at 1MB
          const buf = Buffer.allocUnsafe(readLen);
          await fd.read(buf, 0, readLen, 0);
          // Binary detection: check first 8KB for null bytes
          const checkLen = Math.min(readLen, 8192);
          for (let i = 0; i < checkLen; i++) {
            if (buf[i] === 0) { return { sizeBytes, lineCount: 0, isBinary: true }; }
          }
          // Count newlines
          let lineCount = 0;
          for (let i = 0; i < readLen; i++) {
            if (buf[i] === 0x0A) { lineCount++; }
          }
          return { sizeBytes, lineCount };
        } catch {
          return { sizeBytes: 0, lineCount: 0 };
        } finally {
          await fd?.close();
        }
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
