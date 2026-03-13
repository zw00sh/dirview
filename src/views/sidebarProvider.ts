import * as vscode from 'vscode';
import { DirNode, ScanUpdatePayload } from '../scanner/types';
import { SortMode } from '../config';
import { buildWebviewHtml } from './buildWebviewHtml';
import { handleCommonMessage, setupVisibilityReplay } from './providerUtils';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastUpdate: ScanUpdatePayload | undefined;

  onRefresh?: () => void;
  onOpenDirInTab?: (dirPath: string) => void;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  private getSortDescription(sortMode: SortMode): string {
    if (sortMode === 'name') { return 'name'; }
    if (sortMode === 'size') { return 'size'; }
    return 'count';
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.view.title = 'Tree';
    this.view.description = this.lastUpdate ? this.getSortDescription(this.lastUpdate.sortMode) : 'count';

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: { command: string; path?: string }) => {
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
    if (this.view) { this.view.description = this.getSortDescription(sortMode); }
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
    if (this.view) { this.view.description = this.getSortDescription(sortMode); }
    // Lightweight message: no need to re-serialize the full tree when only the
    // sort mode changed. The webview re-renders from cached roots.
    this.view?.webview.postMessage({ type: 'updateSortMode', sortMode });
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

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this.extensionUri, {
      scripts: ['shared.js', 'main.js'],
      styles: ['style.css'],
      title: 'Directory Breakdown',
      bodyAttrs: `data-vscode-context='{"preventDefaultContextMenuItems": true}'`,
    });
  }
}
