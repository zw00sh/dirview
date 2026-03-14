import * as vscode from 'vscode';
import { DirNode, ScanUpdatePayload } from '../scanner/types';
import { SortMode } from '../config';
import { buildWebviewHtml } from './buildWebviewHtml';
import { handleCommonMessage, setupVisibilityReplay } from './providerUtils';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastUpdate: ScanUpdatePayload | undefined;
  debug = false;

  onRefresh?: () => void;
  onOpenDirInTab?: (dirPath: string) => void;
  onFocusSearch?: () => void;
  onDebugResult?: (msg: { id?: number; result?: string; error?: string }) => void;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.view.title = 'Tree';

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: { command: string; path?: string; line?: number; id?: number; result?: string; error?: string }) => {
      if (message.command === 'focusSearch') {
        this.onFocusSearch?.();
        return;
      }
      if (message.command === 'debugEvalResult') {
        this.onDebugResult?.(message);
        return;
      }
      handleCommonMessage(message, {
        onRefresh: this.onRefresh,
        onOpenDirInTab: this.onOpenDirInTab,
      });
    });

    setupVisibilityReplay(webviewView, () =>
      this.lastUpdate ? { type: 'update', ...this.lastUpdate } : undefined
    );
  }

  // Only show loading indicator on first load (when no data exists yet)
  showLoading(): void {
    if (!this.lastUpdate) {
      this.view?.webview.postMessage({ type: 'loading' });
    }
  }

  showScanning(): void {
    this.view?.webview.postMessage({ type: 'scanning' });
  }

  update(payload: ScanUpdatePayload): void {
    this.lastUpdate = payload;
    const { roots, autoRescanEnabled, sortMode, truncateThreshold } = payload;
    this.view?.webview.postMessage({ type: 'update', roots, autoRescanEnabled, sortMode, truncateThreshold });
  }

  updateTruncateThreshold(truncateThreshold: number): void {
    if (!this.lastUpdate) { return; }
    this.lastUpdate = { ...this.lastUpdate, truncateThreshold };
    // Lightweight message: no need to re-serialize the full tree when only the
    // truncation threshold changed. The webview re-renders from cached roots.
    this.view?.webview.postMessage({ type: 'updateTruncation', truncateThreshold });
  }

  updateSortMode(sortMode: SortMode): void {
    if (!this.lastUpdate) { return; }
    this.lastUpdate = { ...this.lastUpdate, sortMode };
    // Lightweight message: no need to re-serialize the full tree when only the
    // sort mode changed. The webview re-renders from cached roots.
    this.view?.webview.postMessage({ type: 'updateSortMode', sortMode });
  }


  /** Forward full search results from the search fold to the tree webview. */
  postSearchResults(data: { matches: Record<string, any[]> | null; fileCount: number; matchCount: number; truncated: boolean }): void {
    this.view?.webview.postMessage({ type: 'searchResults', ...data });
  }

  /** Forward a streaming batch of search results to the tree webview. */
  postSearchResultsBatch(data: { matches: Record<string, any[]>; fileCount: number; matchCount: number }): void {
    this.view?.webview.postMessage({ type: 'searchResultsBatch', ...data });
  }

  /** Signal that all search result batches have been delivered. */
  postSearchResultsDone(data: { fileCount: number; matchCount: number; truncated: boolean }): void {
    this.view?.webview.postMessage({ type: 'searchResultsDone', ...data });
  }

  /** Notify the tree webview that a search is in progress. */
  postSearchProgress(): void {
    this.view?.webview.postMessage({ type: 'searchProgress' });
  }

  /** Clear the active search in the tree webview. */
  clearSearch(): void {
    this.view?.webview.postMessage({ type: 'searchResults', matches: null });
  }

  setFilter(langs: string[]): void {
    this.view?.webview.postMessage({ type: 'filter', langs });
  }

  expandAll(): void {
    this.view?.webview.postMessage({ type: 'expandAll' });
  }

  collapseAll(): void {
    this.view?.webview.postMessage({ type: 'collapseAll' });
  }

  showError(message: string): void {
    this.view?.webview.postMessage({ type: 'error', message });
  }

  /** Send a debugEval message to the webview (only works when debug=true). */
  debugEval(script: string, id: number): void {
    this.view?.webview.postMessage({ type: 'debugEval', script, id });
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this.extensionUri, {
      scripts: ['shared.js', 'main.js'],
      styles: ['style.css'],
      title: 'Directory Breakdown',
      bodyAttrs: `data-vscode-context='{"preventDefaultContextMenuItems": true}'`,
      debug: this.debug,
    });
  }
}
