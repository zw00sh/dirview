import { Worker } from 'worker_threads';
import * as path from 'path';
import type { DirNode } from './types';

export interface WorkerScanResult {
  roots: DirNode[];
  totalFiles: number;
}

/**
 * Main-thread wrapper around the scan worker.
 * Provides a promise-based API and handles abort/lifecycle.
 */
export class ScanWorkerClient {
  private worker: Worker;
  private nextId = 0;
  private pending = new Map<number, {
    resolve: (result: WorkerScanResult) => void;
    reject: (err: Error) => void;
  }>();

  constructor() {
    this.worker = new Worker(path.join(__dirname, 'scanWorker.js'));
    this.worker.on('message', (msg: { type: string; id: number; roots?: DirNode[]; totalFiles?: number; message?: string }) => {
      const entry = this.pending.get(msg.id);
      if (!entry) { return; }
      this.pending.delete(msg.id);
      if (msg.type === 'result') {
        entry.resolve({ roots: msg.roots!, totalFiles: msg.totalFiles! });
      } else if (msg.type === 'error') {
        entry.reject(new Error(msg.message ?? 'Worker scan failed'));
      } else if (msg.type === 'aborted') {
        entry.reject(new Error('Scan aborted'));
      }
    });
    this.worker.on('error', (err) => {
      for (const [, entry] of this.pending) {
        entry.reject(err);
      }
      this.pending.clear();
    });
  }

  scan(
    folders: Array<{ fsPath: string; name: string }>,
    maxDepth: number,
    showIgnored: boolean,
    filesExcludePatterns: string[][],
  ): Promise<WorkerScanResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'scan', id, folders, maxDepth, showIgnored, filesExcludePatterns });
    });
  }

  abort(): void {
    this.worker.postMessage({ type: 'abort' });
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Scan aborted'));
    }
    this.pending.clear();
  }

  dispose(): void {
    this.abort();
    this.worker.terminate();
  }
}
