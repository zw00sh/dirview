import * as vscode from 'vscode';
import { ScanUpdatePayload } from '../scanner/types';
import { buildWebviewHtml } from './buildWebviewHtml';
import { setupVisibilityReplay } from './providerUtils';

export class LanguagesProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastPayload: ScanUpdatePayload | undefined;
  private activeFilters: string[] = [];
  private showPct: boolean = false;
  debug = false;

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

    setupVisibilityReplay(webviewView, () =>
      this.lastPayload ? { type: 'update', roots: this.stripRoots(this.lastPayload.roots), activeFilters: this.activeFilters, showPct: this.showPct } : undefined
    );
  }

  update(payload: ScanUpdatePayload): void {
    this.lastPayload = payload;
    this.view?.webview.postMessage({ type: 'update', roots: this.stripRoots(payload.roots), activeFilters: this.activeFilters, showPct: this.showPct });
  }

  toggleDisplayMode(): void {
    this.showPct = !this.showPct;
    vscode.commands.executeCommand('setContext', 'dirview.languagesShowPct', this.showPct);
    this.view?.webview.postMessage({ type: 'setDisplayMode', showPct: this.showPct });
  }

  /** Send only stats and totalFiles — the languages panel never reads children/files/paths. */
  private stripRoots(roots: ScanUpdatePayload['roots']) {
    return roots.map(r => ({ stats: r.stats, totalFiles: r.totalFiles }));
  }

  setFilter(langs: string[]): void {
    this.activeFilters = langs;
    this.view?.webview.postMessage({ type: 'filter', langs });
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
      scripts: ['shared.js', 'languages.js'],
      styles: ['languages.css'],
      title: 'Languages',
      debug: this.debug,
    });
  }
}

