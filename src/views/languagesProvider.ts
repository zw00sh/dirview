import * as vscode from 'vscode';
import { DirNode } from '../scanner/types';
import { getNonce } from './getNonce';

export class LanguagesProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastRoots: DirNode[] | undefined;
  private activeFilters: string[] = [];

  onFilterChange: ((langs: string[]) => void) | undefined;

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

    webviewView.webview.onDidReceiveMessage((message: { command: string; langs?: string[] }) => {
      if (message.command === 'filter') {
        this.activeFilters = message.langs ?? [];
        this.onFilterChange?.(this.activeFilters);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.lastRoots) {
        this.postUpdate();
      }
    });

    if (this.lastRoots) {
      setTimeout(() => this.postUpdate(), 100);
    }
  }

  update(roots: DirNode[]): void {
    this.lastRoots = roots;
    this.postUpdate();
  }

  setFilter(langs: string[]): void {
    this.activeFilters = langs;
    this.view?.webview.postMessage({ type: 'filter', langs });
  }

  private postUpdate(): void {
    if (!this.lastRoots) { return; }
    const stats = computeStats(this.lastRoots);
    this.view?.webview.postMessage({ type: 'update', stats, activeFilters: this.activeFilters });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'shared.js')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'languages.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'languages.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Languages</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${sharedScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function computeStats(roots: DirNode[]): Array<{ name: string; color: string; count: number; pct: string }> {
  const counts = new Map<string, { color: string; count: number }>();
  let total = 0;
  for (const r of roots) {
    for (const s of r.stats) {
      const existing = counts.get(s.name);
      if (existing) {
        existing.count += s.count;
      } else {
        counts.set(s.name, { color: s.color, count: s.count });
      }
    }
    total += r.totalFiles;
  }
  return Array.from(counts.entries())
    .map(([name, { color, count }]) => ({
      name, color, count,
      pct: total > 0 ? ((count / total) * 100).toFixed(1) : '0',
    }))
    .sort((a, b) => b.count - a.count);
}
