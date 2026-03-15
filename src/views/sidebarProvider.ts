import * as vscode from 'vscode';
import { DirNode, ScanUpdatePayload } from '../scanner/types';
import { SortMode } from '../config';
import { buildWebviewHtml, SHARED_SCRIPTS } from './buildWebviewHtml';
import { handleCommonMessage, setupVisibilityReplay } from './providerUtils';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastUpdate: ScanUpdatePayload | undefined;
  debug = false;

  onRefresh?: () => void;
  onOpenDirInTab?: (dirPath: string) => void;
  onDebugResult?: (msg: { id?: number; result?: string; error?: string }) => void;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    // Default title; overridden below if scan data already arrived before this view was shown.
    this.view.title = 'Tree';
    if (this.lastUpdate) {
      const roots = this.lastUpdate.roots;
      this.view.title = roots.length === 1 ? roots[0].name : 'Files';
    }

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: { command: string; path?: string; line?: number; id?: number; result?: string; error?: string }) => {
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

  showScanning(): void {
    this.view?.webview.postMessage({ type: 'scanning' });
  }

  update(payload: ScanUpdatePayload): void {
    this.lastUpdate = payload;
    const { roots, autoRescanEnabled, sortMode, truncateThreshold } = payload;
    if (this.view) {
      this.view.title = roots.length === 1 ? roots[0].name : 'Files';
    }
    const stickyHeadersEnabled = payload.sidebarStickyHeadersEnabled;
    this.view?.webview.postMessage({ type: 'update', roots, autoRescanEnabled, sortMode, truncateThreshold, stickyHeadersEnabled });
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


  updateStickyHeaders(enabled: boolean): void {
    this.view?.webview.postMessage({ type: 'updateStickyHeaders', enabled });
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
      scripts: [...SHARED_SCRIPTS, 'main.js'],
      styles: ['style.css'],
      title: 'Directory Breakdown',
      bodyAttrs: `data-vscode-context='{"preventDefaultContextMenuItems": true}'`,
      debug: this.debug,
    });
  }
}
