import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ fsPath: p }) },
  Position: class { constructor(public line: number, public char: number) {} },
  Range: class { constructor(public start: any, public end: any) {} },
  window: { showTextDocument: vi.fn() },
  commands: { executeCommand: vi.fn() },
}));

// highlightGroup mock — returns a resolved promise with fake HTML strings per line.
// Tests can override via highlightDeferred to control async timing.
let highlightDeferred: { resolve: (v: (string | undefined)[]) => void; promise: Promise<(string | undefined)[]> } | null = null;
vi.mock('../highlight/highlighter', () => ({
  highlightGroup: vi.fn((lines: Array<{ rawText: string; ranges: Array<{ col: number; len: number }> }>, _lang: string) => {
    if (highlightDeferred) { return highlightDeferred.promise; }
    return Promise.resolve(lines.map(() => '<span>highlighted</span>'));
  }),
}));

vi.mock('../language/languageMap', () => ({
  getLangInfo: (_name: string) => ({ name: 'TypeScript', color: '#3178c6' }),
}));

import { handleSearchMessage, handleCommonMessage } from './providerUtils';
import type { SearchService, SearchMatch, SearchResult, SearchOptions } from '../search/searchService';
import * as vscode from 'vscode';

// --- Fake SearchService ---

/** Creates a fake SearchService where the caller controls batch delivery and resolution.
 *  Each call to searchWorkspace returns a handle with its own batch/resolve methods. */
function createFakeSearchService() {
  let gen = 0;
  // Current search's callbacks (overwritten on each searchWorkspace call).
  let currentOnBatch: SearchOptions['onBatch'] | undefined;
  let currentResolve: ((r: SearchResult) => void) | undefined;
  let currentReject: ((err: Error) => void) | undefined;
  let currentFilesResolve: ((r: SearchResult) => void) | undefined;
  let currentFilesReject: ((err: Error) => void) | undefined;
  // History of per-search handles for tests that need to resolve earlier searches.
  const searches: Array<{
    deliverBatch: (batch: Map<string, SearchMatch[]>, totals: { fileCount: number; matchCount: number }) => void;
    resolve: (r: SearchResult) => void;
  }> = [];

  const service = {
    getGeneration() { return gen; },
    cancel() { gen++; },
    searchWorkspace(_pattern: string, _rootPaths: string[], options: SearchOptions = {}) {
      // Mimics real searchWorkspace: cancel() bumps gen, then snapshot.
      service.cancel();
      const onBatch = options.onBatch;
      let resolveResult: ((r: SearchResult) => void) | undefined;
      let rejectResult: ((err: Error) => void) | undefined;
      const resultPromise = new Promise<SearchResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      currentOnBatch = onBatch;
      currentResolve = resolveResult;
      currentReject = rejectResult;
      const handle = {
        deliverBatch(batch: Map<string, SearchMatch[]>, totals: { fileCount: number; matchCount: number }) {
          onBatch?.(batch, totals);
        },
        resolve(r: SearchResult) { resolveResult?.(r); },
      };
      searches.push(handle);
      return { result: resultPromise, cancel: () => service.cancel() };
    },
    searchFiles(_glob: string, _rootPaths: string[]) {
      service.cancel();
      let resolveFiles: ((r: SearchResult) => void) | undefined;
      let rejectFiles: ((err: Error) => void) | undefined;
      const resultPromise = new Promise<SearchResult>((resolve, reject) => {
        resolveFiles = resolve;
        rejectFiles = reject;
      });
      currentFilesResolve = resolveFiles;
      currentFilesReject = rejectFiles;
      return { result: resultPromise, cancel: () => service.cancel() };
    },
    // Convenience: deliver batch / resolve / reject on the latest search.
    deliverBatch(batch: Map<string, SearchMatch[]>, totals: { fileCount: number; matchCount: number }) {
      currentOnBatch?.(batch, totals);
    },
    resolveSearch(r: SearchResult) { currentResolve?.(r); },
    rejectSearch(err: Error) { currentReject?.(err); },
    resolveFiles(r: SearchResult) { currentFilesResolve?.(r); },
    rejectFiles(err: Error) { currentFilesReject?.(err); },
    // Access per-search handles by index (0 = first search, 1 = second, etc.)
    getSearch(index: number) { return searches[index]; },
  } as unknown as SearchService & {
    deliverBatch: (batch: Map<string, SearchMatch[]>, totals: { fileCount: number; matchCount: number }) => void;
    resolveSearch: (r: SearchResult) => void;
    rejectSearch: (err: Error) => void;
    resolveFiles: (r: SearchResult) => void;
    rejectFiles: (err: Error) => void;
    getSearch: (index: number) => { deliverBatch: (batch: Map<string, SearchMatch[]>, totals: { fileCount: number; matchCount: number }) => void; resolve: (r: SearchResult) => void };
  };

  return service;
}

function makeMatch(line: number, text: string): SearchMatch {
  return { line, column: 0, matchLength: 3, lineText: text };
}

// --- Tests ---

describe('handleSearchMessage — generation guard', () => {
  let messages: any[];
  let postMessage: (msg: object) => void;

  beforeEach(() => {
    messages = [];
    postMessage = (msg) => messages.push(msg);
    highlightDeferred = null;
  });

  it('delivers batch immediately, then highlight patch, then done', async () => {
    const service = createFakeSearchService();

    handleSearchMessage(
      { command: 'search', pattern: 'api' },
      service, postMessage, ['/ws']
    );

    // Deliver a batch — plain-text batch should be posted immediately (no waiting for Shiki).
    const batch = new Map([['/ws/a.ts', [makeMatch(1, 'const api = 1;')]]]);
    service.deliverBatch(batch, { fileCount: 1, matchCount: 1 });

    // Plain batch is sent synchronously inside onBatch.
    expect(messages.some((m: any) => m.type === 'searchResultsBatch')).toBe(true);
    const batchMsg = messages.find((m: any) => m.type === 'searchResultsBatch');
    expect(batchMsg.matches).toHaveProperty('/ws/a.ts');

    // Highlight patch arrives asynchronously after Shiki resolves.
    await vi.waitFor(() => {
      expect(messages.some((m: any) => m.type === 'searchResultsHighlight')).toBe(true);
    });
    const highlightMsg = messages.find((m: any) => m.type === 'searchResultsHighlight');
    expect(highlightMsg.patches).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/ws/a.ts', idx: 0 })])
    );

    // Resolve the search
    service.resolveSearch({ matches: new Map(), fileCount: 1, matchCount: 1, truncated: false });

    await vi.waitFor(() => {
      expect(messages.some((m: any) => m.type === 'searchResultsDone')).toBe(true);
    });
    const doneMsg = messages.find((m: any) => m.type === 'searchResultsDone');
    expect(doneMsg.fileCount).toBe(1);
  });

  it('discards stale highlight patch when a newer search starts', async () => {
    const service = createFakeSearchService();

    // Control highlight timing so we can interleave a second search before highlights finish.
    let resolveHighlight!: (v: (string | undefined)[]) => void;
    highlightDeferred = {
      promise: new Promise((r) => { resolveHighlight = r; }),
      resolve: null as any,
    };

    // First search: "ap"
    handleSearchMessage(
      { command: 'search', pattern: 'ap' },
      service, postMessage, ['/ws']
    );

    // Deliver a batch for "ap" — plain batch goes out immediately; highlight is still pending.
    const apBatch = new Map([['/ws/a.ts', [makeMatch(1, 'const ap = 1;')]]]);
    service.deliverBatch(apBatch, { fileCount: 1, matchCount: 1 });

    // Plain batch was posted synchronously.
    expect(messages.some((m: any) => m.type === 'searchResultsBatch' && '/ws/a.ts' in (m.matches ?? {}))).toBe(true);

    // Second search: "api" — bumps generation via cancel().
    // Reset deferred so the second search's highlights resolve immediately.
    const staleResolve = resolveHighlight;
    highlightDeferred = null;

    handleSearchMessage(
      { command: 'search', pattern: 'api' },
      service, postMessage, ['/ws']
    );

    // Now resolve the stale "ap" highlight — the generation guard should discard it.
    staleResolve(['<span>stale</span>']);
    await new Promise((r) => setTimeout(r, 50));

    // No searchResultsHighlight should contain patches for the stale "ap" batch.
    const highlightMessages = messages.filter((m: any) => m.type === 'searchResultsHighlight');
    const hasStaleHighlight = highlightMessages.some(
      (m: any) => m.patches?.some((p: any) => p.path === '/ws/a.ts')
    );
    expect(hasStaleHighlight).toBe(false);
  });

  it('discards stale searchResultsDone when a newer search starts', async () => {
    const service = createFakeSearchService();

    // First search
    handleSearchMessage(
      { command: 'search', pattern: 'ap' },
      service, postMessage, ['/ws']
    );
    const firstSearch = service.getSearch(0);

    // Second search — bumps generation
    handleSearchMessage(
      { command: 'search', pattern: 'api' },
      service, postMessage, ['/ws']
    );

    // Resolve the first search's result promise (stale) via its own handle.
    firstSearch.resolve({ matches: new Map(), fileCount: 10, matchCount: 50, truncated: false });
    await new Promise((r) => setTimeout(r, 50));

    // The stale 'done' should NOT be posted (generation mismatch).
    const doneMessages = messages.filter((m: any) => m.type === 'searchResultsDone');
    expect(doneMessages).toHaveLength(0);
  });

  it('generation snapshot is taken after searchWorkspace (not before)', async () => {
    const service = createFakeSearchService();

    // Single search — the critical check is that batches ARE delivered
    // (would fail if snapshot were taken before searchWorkspace, since
    // searchWorkspace calls cancel() which bumps generation).
    handleSearchMessage(
      { command: 'search', pattern: 'test' },
      service, postMessage, ['/ws']
    );

    const batch = new Map([['/ws/b.ts', [makeMatch(5, 'test()')]]]);
    service.deliverBatch(batch, { fileCount: 1, matchCount: 1 });

    await vi.waitFor(() => {
      expect(messages.some((m: any) => m.type === 'searchResultsBatch')).toBe(true);
    });

    service.resolveSearch({ matches: new Map(), fileCount: 1, matchCount: 1, truncated: false });

    await vi.waitFor(() => {
      expect(messages.some((m: any) => m.type === 'searchResultsDone')).toBe(true);
    });

    // Plain batch, highlight patch, and done were all delivered — generation snapshot was correct.
    expect(messages.filter((m: any) => m.type === 'searchResultsBatch')).toHaveLength(1);
    expect(messages.filter((m: any) => m.type === 'searchResultsHighlight')).toHaveLength(1);
    expect(messages.filter((m: any) => m.type === 'searchResultsDone')).toHaveLength(1);
  });
});

describe('handleSearchMessage — webview clears stale results', () => {
  it('searchProgress is sent before any batch processing', () => {
    const messages: any[] = [];
    const service = createFakeSearchService();

    handleSearchMessage(
      { command: 'search', pattern: 'test' },
      service, (msg) => messages.push(msg), ['/ws']
    );

    // searchProgress must be the very first message
    expect(messages[0]).toEqual({ type: 'searchProgress' });
  });
});

describe('handleSearchMessage — searchFiles', () => {
  let messages: any[];
  let postMessage: (msg: object) => void;

  beforeEach(() => {
    messages = [];
    postMessage = (msg) => messages.push(msg);
    highlightDeferred = null;
  });

  it('sends searchProgress before the file search', () => {
    const service = createFakeSearchService();
    handleSearchMessage({ command: 'searchFiles', glob: '*.ts' }, service, postMessage, ['/ws']);
    expect(messages[0]).toEqual({ type: 'searchProgress' });
  });

  it('posts searchResults with file paths and empty match arrays on resolve', async () => {
    const service = createFakeSearchService();
    handleSearchMessage({ command: 'searchFiles', glob: '*.ts' }, service, postMessage, ['/ws']);

    const fileMatches = new Map([['/ws/a.ts', [] as SearchMatch[]], ['/ws/b.ts', [] as SearchMatch[]]]);
    (service as any).resolveFiles({ matches: fileMatches, fileCount: 2, matchCount: 0, truncated: false });

    await vi.waitFor(() => {
      expect(messages.some((m: any) => m.type === 'searchResults')).toBe(true);
    });
    const result = messages.find((m: any) => m.type === 'searchResults');
    expect(result.matches).toHaveProperty('/ws/a.ts');
    expect(result.matches).toHaveProperty('/ws/b.ts');
    expect(result.matches['/ws/a.ts']).toEqual([]);
    expect(result.fileCount).toBe(2);
    expect(result.matchCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('passes truncated flag through', async () => {
    const service = createFakeSearchService();
    handleSearchMessage({ command: 'searchFiles', glob: '*.ts' }, service, postMessage, ['/ws']);
    (service as any).resolveFiles({ matches: new Map([['/ws/a.ts', []]]), fileCount: 1, matchCount: 0, truncated: true });
    await vi.waitFor(() => expect(messages.some((m: any) => m.type === 'searchResults')).toBe(true));
    expect(messages.find((m: any) => m.type === 'searchResults').truncated).toBe(true);
  });

  it('posts error message on rejection', async () => {
    const service = createFakeSearchService();
    handleSearchMessage({ command: 'searchFiles', glob: '*.ts' }, service, postMessage, ['/ws']);
    (service as any).rejectFiles(new Error('rg not found'));
    await vi.waitFor(() => expect(messages.some((m: any) => m.type === 'searchResults')).toBe(true));
    const result = messages.find((m: any) => m.type === 'searchResults');
    expect(result.matches).toBeNull();
    expect(result.error).toContain('rg not found');
  });
});

describe('handleSearchMessage — clearSearch', () => {
  it('posts searchResults with null matches', () => {
    const messages: any[] = [];
    const service = createFakeSearchService();
    const returned = handleSearchMessage({ command: 'clearSearch' }, service, (m) => messages.push(m), ['/ws']);
    expect(messages).toEqual([{ type: 'searchResults', matches: null }]);
    expect(returned).toBe(true);
  });
});

describe('handleSearchMessage — miscellaneous', () => {
  it('returns false for an unknown command', () => {
    const service = createFakeSearchService();
    const result = handleSearchMessage({ command: 'unknownCmd' }, service, () => {}, ['/ws']);
    expect(result).toBe(false);
  });

  it('posts error message when searchWorkspace promise rejects', async () => {
    const messages: any[] = [];
    const service = createFakeSearchService();
    handleSearchMessage({ command: 'search', pattern: 'test' }, service, (m) => messages.push(m), ['/ws']);
    (service as any).rejectSearch(new Error('spawn failed'));
    await vi.waitFor(() => expect(messages.some((m: any) => m.type === 'searchResults')).toBe(true));
    const result = messages.find((m: any) => m.type === 'searchResults');
    expect(result.matches).toBeNull();
    expect(result.error).toContain('spawn failed');
  });

  it('preserves lineText for all matches in the batch message (client-side truncation)', () => {
    const messages: any[] = [];
    const service = createFakeSearchService();
    handleSearchMessage({ command: 'search', pattern: 'x' }, service, (m) => messages.push(m), ['/ws']);

    // 7 matches — all should retain lineText (truncation is now managed client-side)
    const rawMatches = [1, 2, 3, 4, 5, 6, 7].map(line => makeMatch(line, `line ${line}`));
    service.deliverBatch(new Map([['/ws/a.ts', rawMatches]]), { fileCount: 1, matchCount: 7 });

    const batchMsg = messages.find((m: any) => m.type === 'searchResultsBatch');
    const sentMatches: SearchMatch[] = batchMsg.matches['/ws/a.ts'];
    // All 7 matches should have lineText preserved
    for (let i = 0; i < 7; i++) {
      expect(sentMatches[i].lineText).toBe(`line ${i + 1}`);
    }
  });
});

// --- handleCommonMessage ---

describe('handleCommonMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refresh — calls onRefresh and returns true', () => {
    const onRefresh = vi.fn();
    const result = handleCommonMessage({ command: 'refresh' }, { onRefresh });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('openFile without line — calls vscode.open and returns true', () => {
    const result = handleCommonMessage({ command: 'openFile', path: '/a/foo.ts' }, {});
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.open', { fsPath: '/a/foo.ts' });
    expect(result).toBe(true);
  });

  it('openFile with line — calls showTextDocument with position and returns true', () => {
    const result = handleCommonMessage({ command: 'openFile', path: '/a/foo.ts', line: 5 }, {});
    expect(vscode.window.showTextDocument).toHaveBeenCalledOnce();
    const [uri, opts] = (vscode.window.showTextDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(uri).toEqual({ fsPath: '/a/foo.ts' });
    // Position should be line-1=4, char 0
    expect(opts.selection.start.line).toBe(4);
    expect(opts.selection.start.char).toBe(0);
    expect(result).toBe(true);
  });

  it('openFile without path — returns false', () => {
    const result = handleCommonMessage({ command: 'openFile' }, {});
    expect(result).toBe(false);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('openDirInTab — calls onOpenDirInTab and returns true', () => {
    const onOpenDirInTab = vi.fn();
    const result = handleCommonMessage({ command: 'openDirInTab', path: '/a/subdir' }, { onOpenDirInTab });
    expect(onOpenDirInTab).toHaveBeenCalledWith('/a/subdir');
    expect(result).toBe(true);
  });

  it('unknown command — returns false', () => {
    const result = handleCommonMessage({ command: 'unknownCmd' }, {});
    expect(result).toBe(false);
  });
});
