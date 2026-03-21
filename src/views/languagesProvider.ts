import * as vscode from 'vscode';
import { ScanUpdatePayload } from '../scanner/types';
import { buildWebviewHtml } from './buildWebviewHtml';
import { skeletonLegendHtml } from './skeletonHtml';
import { post } from './providerUtils';
import type { WebviewToBackendMessage } from './webview/types';

export class LanguagesProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastPayload: ScanUpdatePayload | undefined;
  private activeFilters: string[] = [];
  private showPct: boolean = false;
  private disposables: vscode.Disposable[] = [];

  onFilterChange: ((langs: string[]) => void) | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeListeners();
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: WebviewToBackendMessage) => {
        if (message.command === 'filter') {
          this.activeFilters = message.langs;
          this.onFilterChange?.(this.activeFilters);
        }
      })
    );

    this.disposables.push(webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.lastPayload) {
        post(webviewView.webview, { type: 'languagesUpdate', roots: this.stripRoots(this.lastPayload.roots), activeFilters: this.activeFilters, showPct: this.showPct });
      }
    }));
    if (this.lastPayload) {
      setTimeout(() => {
        if (this.lastPayload) {
          post(webviewView.webview, { type: 'languagesUpdate', roots: this.stripRoots(this.lastPayload.roots), activeFilters: this.activeFilters, showPct: this.showPct });
        }
      }, 100);
    }
  }

  showScanning(): void {
    if (this.view) { post(this.view.webview, { type: 'scanning' }); }
  }

  update(payload: ScanUpdatePayload): void {
    this.lastPayload = payload;
    if (this.view) { post(this.view.webview, { type: 'languagesUpdate', roots: this.stripRoots(payload.roots), activeFilters: this.activeFilters, showPct: this.showPct }); }
  }

  toggleDisplayMode(): void {
    this.showPct = !this.showPct;
    vscode.commands.executeCommand('setContext', 'dirview.languagesShowPct', this.showPct);
    if (this.view) { post(this.view.webview, { type: 'setDisplayMode', showPct: this.showPct }); }
  }

  /** Send only stats and totalFiles — the languages panel never reads children/files/paths. */
  private stripRoots(roots: ScanUpdatePayload['roots']) {
    return roots.map(r => ({ stats: r.stats, totalFiles: r.totalFiles }));
  }

  setFilter(langs: string[]): void {
    this.activeFilters = langs;
    if (this.view) { post(this.view.webview, { type: 'filter', langs }); }
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
      scripts: ['languages.js'],
      styles: ['languages.css'],
      title: 'Languages',
      rootHtml: skeletonLegendHtml,
    });
  }
}
