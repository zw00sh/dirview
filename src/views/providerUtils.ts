import * as path from 'path';
import * as vscode from 'vscode';
import { SearchService, SearchMatch } from '../search/searchService';
import { getLangInfo, getGlobsForLanguages } from '../language/languageMap';
import { highlightGroup } from '../highlight/highlighter';
import type { WebviewToBackendMessage, BackendToWebviewMessage } from './webview/types';

/** Optional hook for the bench WebSocket bridge — receives a copy of every outgoing message. */
let bridgeBroadcast: ((msg: BackendToWebviewMessage) => void) | null = null;
export function setBridgeBroadcast(fn: ((msg: BackendToWebviewMessage) => void) | null): void {
  bridgeBroadcast = fn;
}

/** Type-safe wrapper around webview.postMessage for outgoing backend→webview messages. */
export function post(webview: vscode.Webview, msg: BackendToWebviewMessage): void {
  webview.postMessage(msg);
  bridgeBroadcast?.(msg);
}

/** Handles messages that are common to both SidebarProvider and TabProvider.
 *  Returns true if the message was handled, false if the caller should continue processing. */
export function handleCommonMessage(
  message: WebviewToBackendMessage,
  callbacks: {
    onRefresh?: () => void;
    onOpenDirInTab?: (path: string) => void;
  }
): boolean {
  if (message.command === 'refresh') {
    callbacks.onRefresh?.();
    return true;
  }
  if (message.command === 'openFile') {
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
  if (message.command === 'openDirInTab') {
    callbacks.onOpenDirInTab?.(message.path);
    return true;
  }
  return false;
}

/** Handles search-related messages from a webview (search, searchFiles, clearSearch).
 *  Runs the ripgrep search and posts searchProgress / searchResults back via postMessage.
 *  When hasRipgrep is false, content search is rejected and file search falls back to findFiles.
 *  Returns true if the message was handled, false otherwise (non-blocking — fires async). */
export function handleSearchMessage(
  message: WebviewToBackendMessage,
  searchService: SearchService,
  postMessage: (msg: BackendToWebviewMessage) => void,
  rootPaths: string[],
  hasRipgrep = true,
  workspaceRootPaths?: string[],
  onSearchComplete?: () => void,
  scannerContext?: { showIgnored?: boolean; filesExclude?: string[] },
): boolean {
  // rootPaths scopes the ripgrep search (may be a subdirectory for subtree tabs).
  // workspaceRootPaths is used by the webview to convert absolute file paths to
  // workspace-relative DirNode paths. Defaults to rootPaths for workspace-root tabs.
  const wsRoots = workspaceRootPaths ?? rootPaths;
  if (message.command === 'search' && message.pattern !== undefined) {
    if (!hasRipgrep) {
      // No ripgrep — content search is not available. UI should prevent this,
      // but guard against stale messages.
      postMessage({ type: 'searchResults', matches: null, error: 'Content search requires ripgrep' });
      return true;
    }
    postMessage({ type: 'searchProgress', rootPaths: wsRoots });
    // Cap how many lines per file receive syntax highlighting to avoid Shiki overhead
    const CONCURRENCY = 10;

    // Builds match groups from sorted matches using context-buffering + midpoint-split
    // logic matching the frontend's renderFileMatches. Each group contains indices into
    // the original matches array and lines to highlight as a multi-line block for correct
    // grammar state across lines (e.g. block comments, template literals).
    function buildMatchGroups(matches: SearchMatch[]): Array<{
      indices: number[];
      lines: Array<{ rawText: string; ranges: Array<{ col: number; len: number }> }>;
    }> {
      const sorted = matches.map((m, i) => ({ m, i }));
      sorted.sort((a, b) => a.m.line - b.m.line);

      const groups: Array<{
        indices: number[];
        lines: Array<{ rawText: string; ranges: Array<{ col: number; len: number }> }>;
      }> = [];
      let contextBuffer: Array<{ m: SearchMatch; i: number }> = [];

      for (let si = 0; si < sorted.length; ) {
        const { m, i } = sorted[si];

        if (m.isContext) {
          contextBuffer.push({ m, i });
          si++;
          continue;
        }

        // Group consecutive same-line non-context matches
        const sameLineEntries = [{ m, i }];
        let sj = si + 1;
        while (sj < sorted.length && !sorted[sj].m.isContext && sorted[sj].m.line === m.line) {
          sameLineEntries.push(sorted[sj]);
          sj++;
        }

        const matchLineEntry = {
          rawText: m.lineText || '',
          ranges: sameLineEntries.map(e => ({ col: e.m.column, len: e.m.matchLength })),
        };
        const matchIndices = sameLineEntries.map(e => e.i);

        // Split buffered context between previous group and this group at midpoint
        if (contextBuffer.length > 0) {
          if (groups.length === 0) {
            const contextLines = contextBuffer.map(c => ({
              rawText: c.m.lineText || '',
              ranges: [] as Array<{ col: number; len: number }>,
            }));
            const contextIndices = contextBuffer.map(c => c.i);
            groups.push({
              indices: [...contextIndices, ...matchIndices],
              lines: [...contextLines, matchLineEntry],
            });
          } else {
            const mid = Math.ceil(contextBuffer.length / 2);
            const prevGroup = groups[groups.length - 1];
            for (let ci = 0; ci < mid; ci++) {
              prevGroup.indices.push(contextBuffer[ci].i);
              prevGroup.lines.push({
                rawText: contextBuffer[ci].m.lineText || '',
                ranges: [],
              });
            }
            const afterMid = contextBuffer.slice(mid);
            const contextLines = afterMid.map(c => ({
              rawText: c.m.lineText || '',
              ranges: [] as Array<{ col: number; len: number }>,
            }));
            const contextIndices = afterMid.map(c => c.i);
            groups.push({
              indices: [...contextIndices, ...matchIndices],
              lines: [...contextLines, matchLineEntry],
            });
          }
          contextBuffer = [];
        } else {
          groups.push({
            indices: matchIndices,
            lines: [matchLineEntry],
          });
        }

        si = sj;
      }

      // Trailing context goes to last group
      if (contextBuffer.length > 0 && groups.length > 0) {
        const lastGroup = groups[groups.length - 1];
        for (const c of contextBuffer) {
          lastGroup.indices.push(c.i);
          lastGroup.lines.push({
            rawText: c.m.lineText || '',
            ranges: [],
          });
        }
      }

      return groups;
    }

    // Syntax-highlights match groups with concurrency limiting.
    // Groups are highlighted as multi-line blocks preserving grammar state across lines.
    async function highlightBatch(batch: Map<string, SearchMatch[]>): Promise<Array<{ path: string; idx: number; html: string }>> {
      const executing = new Set<Promise<void>>();
      const patches: Array<{ path: string; idx: number; html: string }> = [];
      for (const [filePath, matches] of batch) {
        const task = (async () => {
          const langName = getLangInfo(path.basename(filePath)).name;
          const groups = buildMatchGroups(matches);
          for (const group of groups) {
            if (group.lines.every(l => l.rawText === '')) { continue; }
            const htmls = await highlightGroup(group.lines, langName);
            for (let li = 0; li < htmls.length; li++) {
              const html = htmls[li];
              if (html !== undefined) {
                patches.push({ path: filePath, idx: group.indices[li], html });
              }
            }
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
    // Each promise removes itself on completion to prevent unbounded accumulation.
    const pendingBatches = new Set<Promise<void>>();

    const { result } = searchService.searchWorkspace(
      message.pattern,
      rootPaths,
      {
        caseSensitive: message.caseSensitive, useRegex: message.useRegex, include: message.include, exclude: message.exclude,
        contextLines: message.contextLines,
        showIgnored: scannerContext?.showIgnored, filesExclude: scannerContext?.filesExclude,
        langGlobs: message.langFilters ? getGlobsForLanguages(new Set(message.langFilters)) : undefined,
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
          }).finally(() => { pendingBatches.delete(highlightPromise); });
          pendingBatches.add(highlightPromise);
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
      onSearchComplete?.();
    }).catch((err: Error) => {
      postMessage({ type: 'searchResults', matches: null, error: String(err) });
    });
    return true;
  }

  if (message.command === 'searchFiles' && message.glob !== undefined) {
    postMessage({ type: 'searchProgress', rootPaths: wsRoots });
    if (hasRipgrep) {
      const { result } = searchService.searchFiles(message.glob, rootPaths, message.exclude, scannerContext);
      result.then((r) => {
        const matchesObj: Record<string, []> = {};
        for (const p of r.matches.keys()) { matchesObj[p] = []; }
        postMessage({ type: 'searchResults', matches: matchesObj, fileCount: r.fileCount, matchCount: 0, truncated: r.truncated });
        onSearchComplete?.();
      }).catch((err: Error) => {
        postMessage({ type: 'searchResults', matches: null, error: String(err) });
      });
    } else {
      // Fallback: use vscode.workspace.findFiles when ripgrep is unavailable.
      vscode.workspace.findFiles(message.glob).then((uris) => {
        // Filter to files under rootPaths (for directory-scoped tabs).
        const filtered = rootPaths.length > 0
          ? uris.filter(u => rootPaths.some(r => u.fsPath.startsWith(r)))
          : uris;
        const matchesObj: Record<string, []> = {};
        for (const u of filtered) { matchesObj[u.fsPath] = []; }
        postMessage({ type: 'searchResults', matches: matchesObj, fileCount: filtered.length, matchCount: 0, truncated: false });
        onSearchComplete?.();
      }).catch((err: Error) => {
        postMessage({ type: 'searchResults', matches: null, error: String(err) });
      });
    }
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
  getCachedMessage: () => BackendToWebviewMessage | undefined
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
