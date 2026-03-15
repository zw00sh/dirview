import * as path from 'path';
import * as vscode from 'vscode';
import { SearchService, SearchMatch } from '../search/searchService';
import { getLangInfo } from '../language/languageMap';
import { highlightLine, highlightLineMulti } from '../highlight/highlighter';

/** Handles messages that are common to both SidebarProvider and TabProvider.
 *  Returns true if the message was handled, false if the caller should continue processing. */
export function handleCommonMessage(
  message: { command: string; path?: string; line?: number },
  callbacks: {
    onRefresh?: () => void;
    onOpenDirInTab?: (path: string) => void;
  }
): boolean {
  if (message.command === 'refresh') {
    callbacks.onRefresh?.();
    return true;
  }
  if (message.command === 'openFile' && message.path) {
    const uri = vscode.Uri.file(message.path);
    if (typeof message.line === 'number' && message.line > 0) {
      // Open file with cursor positioned at the matched line.
      const pos = new vscode.Position(message.line - 1, 0);
      vscode.window.showTextDocument(uri, { selection: new vscode.Range(pos, pos) });
    } else {
      vscode.commands.executeCommand('vscode.open', uri);
    }
    return true;
  }
  if (message.command === 'openDirInTab' && message.path) {
    callbacks.onOpenDirInTab?.(message.path);
    return true;
  }
  return false;
}

/** Handles search-related messages from a webview (search, searchFiles, clearSearch).
 *  Runs the ripgrep search and posts searchProgress / searchResults back via postMessage.
 *  Returns true if the message was handled, false otherwise (non-blocking — fires async). */
export function handleSearchMessage(
  message: { command: string; pattern?: string; caseSensitive?: boolean; useRegex?: boolean; include?: string; glob?: string; contextLines?: number },
  searchService: SearchService,
  postMessage: (msg: object) => void,
  rootPaths: string[]
): boolean {
  if (message.command === 'search' && message.pattern !== undefined) {
    postMessage({ type: 'searchProgress' });
    // Cap how many lines per file receive syntax highlighting to avoid Shiki overhead
    const CONCURRENCY = 10;

    // Syntax-highlights entries up to the render cap per file with concurrency limiting.
    // Context lines are highlighted too (matchLength=0 produces syntax-highlighted HTML
    // without a match-highlight span). Returns { path, idx, html } patches.
    async function highlightBatch(batch: Map<string, SearchMatch[]>): Promise<Array<{ path: string; idx: number; html: string }>> {
      const executing = new Set<Promise<void>>();
      const patches: Array<{ path: string; idx: number; html: string }> = [];
      for (const [filePath, matches] of batch) {
        const task = (async () => {
          const langName = getLangInfo(path.basename(filePath)).name;
          for (let i = 0; i < matches.length; ) {
            const m = matches[i];
            if (m.lineText === undefined) { i++; continue; }
            // Group consecutive same-line non-context matches
            const groupIndices = [i];
            let j = i + 1;
            while (j < matches.length && !matches[j].isContext && matches[j].line === m.line) {
              groupIndices.push(j);
              j++;
            }
            if (groupIndices.length > 1) {
              // Multi-match line: highlight all ranges together
              const ranges = groupIndices.map(idx => ({ col: matches[idx].column, len: matches[idx].matchLength }));
              const html = await highlightLineMulti(m.lineText, ranges, langName);
              if (html !== undefined) {
                for (const idx of groupIndices) { patches.push({ path: filePath, idx, html }); }
              }
            } else {
              // Single match: use the standard path
              const html = await highlightLine(m.lineText, m.column, m.matchLength, langName);
              if (html !== undefined) { patches.push({ path: filePath, idx: i, html }); }
            }
            i = j;
          }
        })();
        const p = task.then(() => { executing.delete(p); });
        executing.add(p);
        if (executing.size >= CONCURRENCY) { await Promise.race(executing); }
      }
      await Promise.all(executing);
      return patches;
    }

    // Track in-flight batch highlights so we can wait for them before sending 'done'.
    const pendingBatches: Promise<void>[] = [];

    const { result } = searchService.searchWorkspace(
      message.pattern,
      rootPaths,
      {
        caseSensitive: message.caseSensitive, useRegex: message.useRegex, include: message.include,
        contextLines: message.contextLines,
        onBatch: (batch, totals) => {
          // Send plain-text batch immediately — no waiting for syntax highlighting.
          // All match lineText is preserved; truncation display is managed client-side.
          if (searchService.getGeneration() !== searchGen) { return; }
          const plainObj: Record<string, SearchMatch[]> = {};
          for (const [p, m] of batch) { plainObj[p] = m; }
          postMessage({ type: 'searchResultsBatch', matches: plainObj, fileCount: totals.fileCount, matchCount: totals.matchCount });
          // Asynchronously highlight and post a patch once done.
          const highlightPromise = highlightBatch(batch).then((patches) => {
            if (searchService.getGeneration() !== searchGen) { return; }
            if (patches.length > 0) {
              postMessage({ type: 'searchResultsHighlight', patches });
            }
          });
          pendingBatches.push(highlightPromise);
        },
      }
    );
    // Snapshot generation *after* searchWorkspace (which calls cancel() internally,
    // bumping the generation). This matches the generation the search is actually using.
    const searchGen = searchService.getGeneration();
    result.then(async (r) => {
      // Wait for all in-flight batch highlights to complete before signalling done.
      await Promise.all(pendingBatches);
      if (searchService.getGeneration() !== searchGen) { return; }
      postMessage({ type: 'searchResultsDone', fileCount: r.fileCount, matchCount: r.matchCount, truncated: r.truncated });
    }).catch((err: Error) => {
      postMessage({ type: 'searchResults', matches: null, error: String(err) });
    });
    return true;
  }

  if (message.command === 'searchFiles' && message.glob !== undefined) {
    postMessage({ type: 'searchProgress' });
    const { result } = searchService.searchFiles(message.glob, rootPaths);
    result.then((r) => {
      const matchesObj: Record<string, []> = {};
      for (const p of r.matches.keys()) { matchesObj[p] = []; }
      postMessage({ type: 'searchResults', matches: matchesObj, fileCount: r.fileCount, matchCount: 0, truncated: r.truncated });
    }).catch((err: Error) => {
      postMessage({ type: 'searchResults', matches: null, error: String(err) });
    });
    return true;
  }

  if (message.command === 'clearSearch') {
    searchService.cancel();
    postMessage({ type: 'searchResults', matches: null });
    return true;
  }

  return false;
}

/** Wires visibility-change and initial-replay for a WebviewView.
 *  getCachedMessage() is called each time; if it returns undefined the replay is skipped. */
export function setupVisibilityReplay(
  webviewView: vscode.WebviewView,
  getCachedMessage: () => object | undefined
): void {
  webviewView.onDidChangeVisibility(() => {
    if (webviewView.visible) {
      const msg = getCachedMessage();
      if (msg) { webviewView.webview.postMessage(msg); }
    }
  });

  const initial = getCachedMessage();
  if (initial) {
    setTimeout(() => {
      const msg = getCachedMessage();
      if (msg) { webviewView.webview.postMessage(msg); }
    }, 100);
  }
}
