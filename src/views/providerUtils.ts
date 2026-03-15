import * as path from 'path';
import * as vscode from 'vscode';
import { SearchService, SearchMatch } from '../search/searchService';
import { getLangInfo } from '../language/languageMap';
import { highlightGroup } from '../highlight/highlighter';

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
    // Builds match groups from sorted matches using the same context-buffering +
    // midpoint-split logic as the frontend's renderFileMatches (shared-renderer.js).
    // Each group contains indices into the original matches array and the lines to
    // highlight as a single multi-line block for correct grammar state.
    function buildMatchGroups(matches: SearchMatch[]): Array<{
      indices: number[];
      lines: Array<{ rawText: string; ranges: Array<{ col: number; len: number }> }>;
    }> {
      const sorted = matches.map((m, i) => ({ m, i }));
      // Matches arrive sorted by line from the backend; defensive sort.
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

        // Build match line entry: one line with all same-line match ranges
        const matchLineEntry = {
          rawText: m.lineText || '',
          ranges: sameLineEntries.map(e => ({ col: e.m.column, len: e.m.matchLength })),
        };
        const matchIndices = sameLineEntries.map(e => e.i);

        // Split buffered context between previous group and this group at midpoint
        if (contextBuffer.length > 0) {
          if (groups.length === 0) {
            // All buffered context belongs to this group as contextBefore
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
            // Append first half to previous group's contextAfter
            const prevGroup = groups[groups.length - 1];
            for (let ci = 0; ci < mid; ci++) {
              prevGroup.indices.push(contextBuffer[ci].i);
              prevGroup.lines.push({
                rawText: contextBuffer[ci].m.lineText || '',
                ranges: [],
              });
            }
            // Second half becomes this group's contextBefore
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

    async function highlightBatch(batch: Map<string, SearchMatch[]>): Promise<Array<{ path: string; idx: number; html: string }>> {
      const executing = new Set<Promise<void>>();
      const patches: Array<{ path: string; idx: number; html: string }> = [];
      for (const [filePath, matches] of batch) {
        const task = (async () => {
          const langName = getLangInfo(path.basename(filePath)).name;
          const groups = buildMatchGroups(matches);
          for (const group of groups) {
            // Skip groups where all lines have no text
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
