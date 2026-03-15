import * as vscode from 'vscode';
import { buildWebviewHtml, SHARED_SCRIPTS } from './buildWebviewHtml';
import { handleSearchMessage } from './providerUtils';
import { SearchService } from '../search/searchService';

/** SearchProvider owns the standalone Search fold in the sidebar.
 *  It runs ripgrep and forwards results to the tree fold via callbacks.
 *  The search fold only receives status messages (not the full match data). */
export class SearchProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private searchService = new SearchService();

  // Callbacks wired in extension.ts to forward results to the tree fold.
  onSearchResults?: (data: { matches: Record<string, any[]> | null; fileCount: number; matchCount: number; truncated: boolean }) => void;
  onSearchResultsBatch?: (data: { matches: Record<string, any[]>; fileCount: number; matchCount: number }) => void;
  onSearchResultsHighlight?: (data: { patches: Array<{ path: string; idx: number; html: string }> }) => void;
  onSearchResultsDone?: (data: { fileCount: number; matchCount: number; truncated: boolean }) => void;
  onSearchProgress?: () => void;
  onSearchClear?: () => void;
  onDebugResult?: (msg: { id?: number; result?: string; error?: string }) => void;

  debug = false;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: {
      command: string;
      pattern?: string;
      caseSensitive?: boolean;
      useRegex?: boolean;
      include?: string;
      glob?: string;
    }) => {
      const rootPaths = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];

      // Intercept postMessage to split results: tree fold gets full data,
      // search fold gets status-only (no match line data needed there).
      const intercepted = (msg: any) => {
        if (msg.type === 'searchProgress') {
          this.onSearchProgress?.();
          webviewView.webview.postMessage({ type: 'searchStatus', active: true });
        } else if (msg.type === 'searchResultsBatch') {
          this.onSearchResultsBatch?.({
            matches: msg.matches,
            fileCount: msg.fileCount ?? 0,
            matchCount: msg.matchCount ?? 0,
          });
          // Update search fold status with running totals
          webviewView.webview.postMessage({
            type: 'searchStatus',
            active: true,
            fileCount: msg.fileCount ?? 0,
            matchCount: msg.matchCount ?? 0,
          });
        } else if (msg.type === 'searchResultsHighlight') {
          // Forward highlight patches to the tree fold; no status update needed.
          this.onSearchResultsHighlight?.({ patches: msg.patches ?? [] });
        } else if (msg.type === 'searchResultsDone') {
          this.onSearchResultsDone?.({
            fileCount: msg.fileCount ?? 0,
            matchCount: msg.matchCount ?? 0,
            truncated: msg.truncated ?? false,
          });
          webviewView.webview.postMessage({
            type: 'searchStatus',
            active: false,
            fileCount: msg.fileCount ?? 0,
            matchCount: msg.matchCount ?? 0,
            truncated: msg.truncated ?? false,
          });
        } else if (msg.type === 'searchResults') {
          this.onSearchResults?.({
            matches: msg.matches,
            fileCount: msg.fileCount ?? 0,
            matchCount: msg.matchCount ?? 0,
            truncated: msg.truncated ?? false,
          });
          webviewView.webview.postMessage({
            type: 'searchStatus',
            active: false,
            matches: msg.matches,
            fileCount: msg.fileCount ?? 0,
            matchCount: msg.matchCount ?? 0,
            truncated: msg.truncated ?? false,
          });
        }
      };

      if (message.command === 'debugEvalResult') {
        this.onDebugResult?.(message as any);
        return;
      }

      // clearSearch is handled by handleSearchMessage, but we also need to call onSearchClear.
      // Override the clear branch by checking first and calling our callback.
      if (message.command === 'clearSearch') {
        this.searchService.cancel();
        this.onSearchClear?.();
        webviewView.webview.postMessage({ type: 'searchStatus', active: false, matches: null });
        return;
      }

      handleSearchMessage(message, this.searchService, intercepted, rootPaths);
    });

    // Auto-focus input when the fold becomes visible.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        webviewView.webview.postMessage({ type: 'focus' });
      }
    });
  }

  /** Reveals and focuses the search fold (called when Cmd+F is pressed in the tree fold). */
  focusInput(): void {
    this.view?.show(true);
    this.view?.webview.postMessage({ type: 'focus' });
  }

  /** Notifies the search fold how many language filters are active so it can show a pill. */
  setFilterActive(count: number): void {
    this.view?.webview.postMessage({ type: 'filterActive', count });
  }

  /** Send a debugEval message to the webview (only works when debug=true). */
  debugEval(script: string, id: number): void {
    this.view?.webview.postMessage({ type: 'debugEval', script, id });
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this.extensionUri, {
      scripts: [...SHARED_SCRIPTS, 'search.js'],
      styles: ['style.css', 'search.css'],
      title: 'Search',
      debug: this.debug,
    });
  }
}
