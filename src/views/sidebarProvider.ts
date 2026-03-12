import * as vscode from 'vscode';
import { DirNode } from '../scanner/types';
import { SortMode } from '../config';
import { getNonce } from './getNonce';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastUpdate: { roots: DirNode[]; autoRescanEnabled: boolean; sortMode: SortMode; truncateThreshold: number } | undefined;

  onExpandChanged?: (hasAny: boolean) => void;
  onRefresh?: () => void;

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

    webviewView.webview.onDidReceiveMessage((message: { command: string; path?: string; hasAny?: boolean }) => {
      if (message.command === 'refresh') {
        this.onRefresh?.();
      } else if (message.command === 'openFile' && message.path) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.path));
      } else if (message.command === 'expandChanged') {
        this.onExpandChanged?.(message.hasAny ?? false);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.lastUpdate) {
        webviewView.webview.postMessage({ type: 'update', ...this.lastUpdate });
      }
    });

    if (this.lastUpdate) {
      setTimeout(() => {
        if (this.lastUpdate) {
          webviewView.webview.postMessage({ type: 'update', ...this.lastUpdate });
        }
      }, 100);
    }
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

  update(roots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode, truncateThreshold: number = 4): void {
    this.lastUpdate = { roots, autoRescanEnabled, sortMode, truncateThreshold };
    if (this.view) { this.view.description = this.getSortDescription(sortMode); }
    this.view?.webview.postMessage({ type: 'update', roots, autoRescanEnabled, sortMode, truncateThreshold });
  }

  updateTruncateThreshold(truncateThreshold: number): void {
    if (!this.lastUpdate) { return; }
    this.lastUpdate = { ...this.lastUpdate, truncateThreshold };
    this.view?.webview.postMessage({ type: 'update', ...this.lastUpdate });
  }

  updateSortMode(sortMode: SortMode): void {
    if (!this.lastUpdate) { return; }
    this.lastUpdate = { ...this.lastUpdate, sortMode };
    if (this.view) { this.view.description = this.getSortDescription(sortMode); }
    this.view?.webview.postMessage({ type: 'update', ...this.lastUpdate });
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
    const nonce = getNonce();

    const sharedScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'shared.js')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'style.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Directory Breakdown</title>
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'>
  <div id="root"></div>
  <script nonce="${nonce}" src="${sharedScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
