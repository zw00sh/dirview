import * as vscode from 'vscode';
import { ScanUpdatePayload } from '../scanner/types';
import { SortMode } from '../config';
import { buildWebviewHtml } from './buildWebviewHtml';
import { handleCommonMessage, setupVisibilityReplay, post } from './providerUtils';
import type { WebviewToBackendMessage } from './webview/types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastUpdate: ScanUpdatePayload | undefined;
  private disposables: vscode.Disposable[] = [];
  onRefresh?: () => void;
  onOpenDirInTab?: (dirPath: string) => void;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeListeners();
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

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: WebviewToBackendMessage) => {
        handleCommonMessage(message, {
          onRefresh: this.onRefresh,
          onOpenDirInTab: this.onOpenDirInTab,
        });
      })
    );

    setupVisibilityReplay(webviewView, () => {
      if (!this.lastUpdate) { return undefined; }
      const { roots, autoRescanEnabled, sortMode, truncateThreshold, sidebarStickyHeadersEnabled: stickyHeadersEnabled, isLocal } = this.lastUpdate;
      return { type: 'update', roots, autoRescanEnabled, sortMode, truncateThreshold, stickyHeadersEnabled, isLocal };
    });
  }

  showScanning(): void {
    if (this.view) { post(this.view.webview, { type: 'scanning' }); }
  }

  update(payload: ScanUpdatePayload): void {
    this.lastUpdate = payload;
    const { roots, autoRescanEnabled, sortMode, truncateThreshold } = payload;
    if (this.view) {
      this.view.title = roots.length === 1 ? roots[0].name : 'Files';
    }
    const stickyHeadersEnabled = payload.sidebarStickyHeadersEnabled;
    const isLocal = payload.isLocal;
    if (this.view) { post(this.view.webview, { type: 'update', roots, autoRescanEnabled, sortMode, truncateThreshold, stickyHeadersEnabled, isLocal }); }
  }

  updateTruncateThreshold(truncateThreshold: number): void {
    if (!this.lastUpdate) { return; }
    this.lastUpdate = { ...this.lastUpdate, truncateThreshold };
    // Lightweight message: no need to re-serialize the full tree when only the
    // truncation threshold changed. The webview re-renders from cached roots.
    if (this.view) { post(this.view.webview, { type: 'updateTruncation', truncateThreshold }); }
  }

  updateSortMode(sortMode: SortMode): void {
    if (!this.lastUpdate) { return; }
    this.lastUpdate = { ...this.lastUpdate, sortMode };
    // Lightweight message: no need to re-serialize the full tree when only the
    // sort mode changed. The webview re-renders from cached roots.
    if (this.view) { post(this.view.webview, { type: 'updateSortMode', sortMode }); }
  }

  updateStickyHeaders(enabled: boolean): void {
    if (this.view) { post(this.view.webview, { type: 'updateStickyHeaders', enabled }); }
  }

  setFilter(langs: string[]): void {
    if (this.view) { post(this.view.webview, { type: 'filter', langs }); }
  }

  expandAll(): void {
    if (this.view) { post(this.view.webview, { type: 'expandAll' }); }
  }

  collapseAll(): void {
    if (this.view) { post(this.view.webview, { type: 'collapseAll' }); }
  }

  showError(message: string): void {
    if (this.view) { post(this.view.webview, { type: 'error', message }); }
  }

  private disposeListeners(): void {
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this.extensionUri, {
      scripts: ['main.js'],
      styles: ['style.css', 'sidebar.css'],
      title: 'Directory Breakdown',
      bodyAttrs: `data-vscode-context='{"preventDefaultContextMenuItems": true}'`,
    });
  }
}
