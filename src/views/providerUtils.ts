import * as path from 'path';
import * as vscode from 'vscode';
import { SearchService, SearchMatch } from '../search/searchService';
import { getLangInfo } from '../language/languageMap';
import { highlightLine } from '../highlight/highlighter';

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
  message: { command: string; pattern?: string; caseSensitive?: boolean; useRegex?: boolean; include?: string; glob?: string },
  searchService: SearchService,
  postMessage: (msg: object) => void,
  rootPaths: string[]
): boolean {
  if (message.command === 'search' && message.pattern !== undefined) {
    postMessage({ type: 'searchProgress' });
    const MAX_MATCH_LINES = 5;
    const CONCURRENCY = 10;

    // Highlights the first MAX_MATCH_LINES matches per file with concurrency limiting,
    // strips lineText beyond the render cap, and returns a serialisable object.
    async function highlightAndSerialize(batch: Map<string, SearchMatch[]>): Promise<Record<string, SearchMatch[]>> {
      const executing = new Set<Promise<void>>();
      for (const [filePath, matches] of batch) {
        const task = (async () => {
          const langName = getLangInfo(path.basename(filePath)).name;
          for (const match of matches.slice(0, MAX_MATCH_LINES)) {
            const html = await highlightLine(match.lineText, match.column, match.matchLength, langName);
            if (html !== undefined) { match.highlightedHtml = html; }
          }
        })();
        const p = task.then(() => { executing.delete(p); });
        executing.add(p);
        if (executing.size >= CONCURRENCY) { await Promise.race(executing); }
      }
      await Promise.all(executing);
      const obj: Record<string, SearchMatch[]> = {};
      for (const [p, m] of batch) {
        for (let i = MAX_MATCH_LINES; i < m.length; i++) { delete m[i].lineText; }
        obj[p] = m;
      }
      return obj;
    }

    // Track in-flight batch highlights so we can wait for them before sending 'done'.
    const pendingBatches: Promise<void>[] = [];

    const { result } = searchService.searchWorkspace(
      message.pattern,
      rootPaths,
      {
        caseSensitive: message.caseSensitive, useRegex: message.useRegex, include: message.include,
        onBatch: (batch, totals) => {
          const p = highlightAndSerialize(batch).then((matchesObj) => {
            postMessage({ type: 'searchResultsBatch', matches: matchesObj, fileCount: totals.fileCount, matchCount: totals.matchCount });
          });
          pendingBatches.push(p);
        },
      }
    );
    result.then(async (r) => {
      // Wait for all in-flight batch highlights to complete before signalling done.
      await Promise.all(pendingBatches);
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
