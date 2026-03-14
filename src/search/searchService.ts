import * as child_process from 'child_process';

export interface SearchMatch {
  line: number;
  column: number;
  matchLength: number;
  lineText: string;
  /** Pre-rendered syntax-highlighted HTML with match-highlight span injected. Set by the
   *  backend after ripgrep resolves; absent for file-glob results or unknown languages. */
  highlightedHtml?: string;
}

export interface SearchResult {
  matches: Map<string, SearchMatch[]>;
  fileCount: number;
  matchCount: number;
  truncated: boolean;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  useRegex?: boolean;
  include?: string;
  /** Called with partial results as they arrive. Batches are flushed every BATCH_FLUSH_FILES
   *  new files or BATCH_FLUSH_MS milliseconds, whichever comes first. */
  onBatch?: (batch: Map<string, SearchMatch[]>, totals: { fileCount: number; matchCount: number }) => void;
}

const MAX_FILES = 2000;
const MAX_MATCHES = 20000;

export class SearchService {
  private currentProcess: child_process.ChildProcess | null = null;
  private rgPath: string;
  // Monotonically increasing counter: incremented on each new search so stale
  // promise callbacks from a cancelled search can detect they're outdated.
  private generation = 0;

  constructor() {
    try {
      // @vscode/ripgrep is marked external in esbuild so it resolves from node_modules at runtime.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const rg = require('@vscode/ripgrep');
      this.rgPath = rg.rgPath;
    } catch {
      // Fall back to system rg if the package isn't available (shouldn't happen in practice).
      this.rgPath = 'rg';
    }
  }

  /** Returns the current search generation. Callers can snapshot this value
   *  and compare later to detect whether a newer search has been started. */
  getGeneration(): number { return this.generation; }

  cancel(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
    // Bump generation so any in-flight promise callbacks discard their results.
    this.generation++;
  }

  searchWorkspace(
    pattern: string,
    rootPaths: string[],
    options: SearchOptions = {}
  ): { result: Promise<SearchResult>; cancel: () => void } {
    this.cancel();
    const generation = this.generation;
    const onBatch = options.onBatch;

    const args: string[] = ['--json', '--max-filesize', '1M', '-e', pattern];
    if (!options.caseSensitive) { args.push('-i'); }
    if (!options.useRegex) { args.push('--fixed-strings'); }
    if (options.include) { args.push('--glob', options.include); }
    args.push(...rootPaths);

    const proc = child_process.spawn(this.rgPath, args);
    this.currentProcess = proc;

    const BATCH_FLUSH_FILES = 50;
    const BATCH_FLUSH_MS = 200;

    const result = new Promise<SearchResult>((resolve, reject) => {
      const matches = new Map<string, SearchMatch[]>();
      let fileCount = 0;
      let matchCount = 0;
      let truncated = false;
      let buffer = '';
      let errorOutput = '';

      // Batch accumulator for progressive delivery
      let batchBuffer = new Map<string, SearchMatch[]>();
      let batchFileCount = 0;
      let batchTimer: ReturnType<typeof setTimeout> | null = null;

      const flushBatch = () => {
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
        if (batchBuffer.size === 0 || generation !== this.generation) { return; }
        const batch = batchBuffer;
        batchBuffer = new Map();
        batchFileCount = 0;
        onBatch!(batch, { fileCount, matchCount });
      };

      const scheduleBatchFlush = () => {
        if (!onBatch || batchTimer) { return; }
        batchTimer = setTimeout(flushBatch, BATCH_FLUSH_MS);
      };

      proc.stdout.on('data', (chunk: Buffer) => {
        if (truncated) { return; }
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) { continue; }
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'match') {
              const filePath: string = obj.data.path.text;
              const lineNum: number = obj.data.line_number;
              const lineText = (obj.data.lines?.text ?? '').replace(/\n$/, '');
              for (const submatch of (obj.data.submatches ?? [])) {
                if (matchCount >= MAX_MATCHES) { truncated = true; return; }
                if (!matches.has(filePath)) {
                  if (fileCount >= MAX_FILES) { truncated = true; return; }
                  matches.set(filePath, []);
                  fileCount++;
                  if (onBatch) { batchFileCount++; }
                }
                const match: SearchMatch = {
                  line: lineNum,
                  column: submatch.start,
                  matchLength: submatch.end - submatch.start,
                  lineText,
                };
                matches.get(filePath)!.push(match);
                matchCount++;

                // Also accumulate in batch buffer for progressive delivery
                if (onBatch) {
                  if (!batchBuffer.has(filePath)) { batchBuffer.set(filePath, []); }
                  batchBuffer.get(filePath)!.push(match);
                }
              }
            }
          } catch { /* ignore JSON parse errors */ }
        }
        // Flush batch if file threshold reached
        if (onBatch && batchFileCount >= BATCH_FLUSH_FILES) {
          flushBatch();
        } else if (onBatch && batchBuffer.size > 0) {
          scheduleBatchFlush();
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString(); });

      proc.on('close', (code: number | null) => {
        if (this.currentProcess === proc) { this.currentProcess = null; }
        if (generation !== this.generation) { return; } // Cancelled — discard stale results
        // Flush any remaining batch before resolving
        if (onBatch && batchBuffer.size > 0) { flushBatch(); }
        // exit code 0 = matches found, 1 = no matches (both are success in rg)
        if (code !== null && code !== 0 && code !== 1 && matches.size === 0 && errorOutput) {
          reject(new Error(errorOutput.trim()));
        } else {
          resolve({ matches, fileCount, matchCount, truncated });
        }
      });

      proc.on('error', (err: Error) => {
        if (this.currentProcess === proc) { this.currentProcess = null; }
        if (generation !== this.generation) { return; }
        reject(err);
      });
    });

    return { result, cancel: () => this.cancel() };
  }

  searchFiles(
    glob: string,
    rootPaths: string[]
  ): { result: Promise<SearchResult>; cancel: () => void } {
    this.cancel();
    const generation = this.generation;

    const args: string[] = ['--files', '--glob', glob, ...rootPaths];
    const proc = child_process.spawn(this.rgPath, args);
    this.currentProcess = proc;

    const result = new Promise<SearchResult>((resolve, reject) => {
      const matches = new Map<string, SearchMatch[]>();
      let fileCount = 0;
      let truncated = false;
      let buffer = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { continue; }
          if (fileCount >= MAX_FILES) { truncated = true; continue; }
          matches.set(trimmed, []);
          fileCount++;
        }
      });

      proc.on('close', () => {
        if (this.currentProcess === proc) { this.currentProcess = null; }
        if (generation !== this.generation) { return; }
        resolve({ matches, fileCount, matchCount: 0, truncated });
      });

      proc.on('error', (err: Error) => {
        if (this.currentProcess === proc) { this.currentProcess = null; }
        if (generation !== this.generation) { return; }
        reject(err);
      });
    });

    return { result, cancel: () => this.cancel() };
  }
}
