import * as vscode from 'vscode';
import { SearchService, SearchMatch } from '../search/searchService';

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
    const { result } = searchService.searchWorkspace(
      message.pattern,
      rootPaths,
      { caseSensitive: message.caseSensitive, useRegex: message.useRegex, include: message.include }
    );
    result.then((r) => {
      const matchesObj: Record<string, SearchMatch[]> = {};
      for (const [p, m] of r.matches) { matchesObj[p] = m; }
      postMessage({ type: 'searchResults', matches: matchesObj, fileCount: r.fileCount, matchCount: r.matchCount, truncated: r.truncated });
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
