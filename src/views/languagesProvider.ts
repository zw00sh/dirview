import * as vscode from 'vscode';
import { DirNode } from '../scanner/types';
import { buildWebviewHtml } from './buildWebviewHtml';
import { setupVisibilityReplay } from './providerUtils';

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

    setupVisibilityReplay(webviewView, () =>
      this.lastRoots ? { type: 'update', roots: this.lastRoots, activeFilters: this.activeFilters } : undefined
    );
  }

  update(roots: DirNode[]): void {
    this.lastRoots = roots;
    this.view?.webview.postMessage({ type: 'update', roots, activeFilters: this.activeFilters });
  }

  setFilter(langs: string[]): void {
    this.activeFilters = langs;
    this.view?.webview.postMessage({ type: 'filter', langs });
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this.extensionUri, {
      scripts: ['shared.js', 'languages.js'],
      styles: ['languages.css'],
      title: 'Languages',
    });
  }
}

