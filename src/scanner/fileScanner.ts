import * as vscode from 'vscode';
import { DirNode } from './types';
import { IgnoreFilter } from './ignoreFilter';
import type { IgnoreFilterBase } from './ignoreFilterBase';
import type { ScanWorkerClient } from './scanWorkerClient';
import { scanDirCore, type ScanAdapter } from './scanDirCore';

export interface ScanResult {
  roots: DirNode[];
  totalFiles: number;
  isLocal: boolean;
}

// ── Remote filesystem adapter ─────────────────────────────────────────────

class RemoteAdapter implements ScanAdapter<vscode.Uri> {
  constructor(private signal?: AbortSignal) {}

  async readDir(dirUri: vscode.Uri) {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      return entries.map(([name, fileType]) => {
        const isDir = (fileType & vscode.FileType.Directory) !== 0;
        const isFile = (fileType & vscode.FileType.File) !== 0;
        return {
          name,
          isDir,
          isFile,
        };
      });
    } catch {
      return null;
    }
  }

  joinPath(parent: vscode.Uri, child: string) {
    return vscode.Uri.joinPath(parent, child);
  }

  pathKey(dirUri: vscode.Uri) {
    return dirUri.fsPath;
  }

  async loadLocalIgnore(filter: IgnoreFilterBase, dirUri: vscode.Uri) {
    return (filter as IgnoreFilter).loadLocalIgnore(dirUri);
  }

  isAborted() {
    return this.signal?.aborted ?? false;
  }

  async getFileMetrics(files: Array<{ name: string; path: vscode.Uri }>) {
    return new Array(files.length).fill({ sizeBytes: 0, lineCount: 0 });
  }
}

// ── Scan entry point ──────────────────────────────────────────────────────

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
  const adapter = new RemoteAdapter(signal);
  const roots = await Promise.all(folders.map(async (folder) => {
    const filter = new IgnoreFilter(folder.uri, showIgnored);
    await filter.init();
    const visitedPaths = new Set<string>();
    return scanDirCore(adapter, folder.uri, folder.name, '', filter, visitedPaths, 0, maxDepth);
  }));

  let totalFiles = 0;
  for (const node of roots) { totalFiles += node.totalFiles; }

  return { roots, totalFiles, isLocal };
}
