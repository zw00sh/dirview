import * as vscode from 'vscode';
import * as path from 'path';
import { DirNode, ScanUpdatePayload } from '../scanner/types';
import { SortMode } from '../config';
import { buildWebviewHtml } from './buildWebviewHtml';
import { skeletonTreeHtml } from './skeletonHtml';
import { handleCommonMessage, setupVisibilityReplay, post } from './providerUtils';
import type { WebviewToBackendMessage } from './webview/types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;
  private lastUpdate: ScanUpdatePayload | undefined;
  private lastFilterLangs: string[] = [];
  private disposables: vscode.Disposable[] = [];
  private dirPath = '';
  onRefresh?: () => void;
  onOpenDirInTab?: (dirPath: string) => void;
  onStatsChange?: (scopeRoots: Array<{ stats: import('../scanner/types').FileTypeStats[]; totalFiles: number }>, filteredRoots: Array<{ stats: import('../scanner/types').FileTypeStats[]; totalFiles: number }>) => void;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  // ── Drill-down helpers ──────────────────────────────────────────────────

  private findInChildren(children: DirNode[], targetPath: string): DirNode | undefined {
    for (const child of children) {
      if (child.path === targetPath) return child;
      const found = this.findInChildren(child.children, targetPath);
      if (found) return found;
    }
    return undefined;
  }

  private findNodeByPath(roots: DirNode[], targetPath: string): DirNode | undefined {
    for (const root of roots) {
      if (root.path === targetPath) return root;
      const found = this.findInChildren(root.children, targetPath);
      if (found) return found;
    }
    return undefined;
  }

  private getRootsForDir(dirPath: string): DirNode[] | undefined {
    const roots = this.lastUpdate?.roots;
    if (!roots) return undefined;
    if (dirPath === '') return roots;
    const node = this.findNodeByPath(roots, dirPath);
    return node ? [node] : [];
  }

  private getWorkspaceFolderName(dirPath: string): string {
    const roots = this.lastUpdate?.roots;
    if (!roots) return '';
    if (dirPath === '') return roots.length === 1 ? roots[0].name : '';
    for (const root of roots) {
      if (dirPath === root.path || this.findInChildren(root.children, dirPath)) {
        return root.name;
      }
    }
    return roots.length === 1 ? roots[0].name : '';
  }

  private updateDirPathContext(): void {
    vscode.commands.executeCommand('setContext', 'dirview.sidebarDrilledDown', this.dirPath !== '');
  }

  private getTitleForDir(dirPath: string, roots?: DirNode[]): string {
    if (dirPath) return path.basename(dirPath);
    if (roots && roots.length === 1) return roots[0].name;
    return 'Tree';
  }

  private sendUpdateForCurrentDir(): void {
    if (!this.view || !this.lastUpdate) return;
    let roots = this.getRootsForDir(this.dirPath);
    // If drilled-down directory was deleted, reset to root.
    if (this.dirPath !== '' && roots !== undefined && roots.length === 0) {
      this.dirPath = '';
      this.updateDirPathContext();
      roots = this.lastUpdate.roots;
    }
    const effectiveRoots = roots ?? [];
    this.view.title = this.getTitleForDir(this.dirPath, effectiveRoots);
    const { autoRescanEnabled, sortMode, truncateThreshold, sidebarStickyHeadersEnabled: stickyHeadersEnabled, isLocal } = this.lastUpdate;
    post(this.view.webview, {
      type: 'update', roots: effectiveRoots, autoRescanEnabled, sortMode, truncateThreshold,
      stickyHeadersEnabled, isLocal, dirPath: this.dirPath, workspaceFolderName: this.getWorkspaceFolderName(this.dirPath),
    });
  }

  navigateUp(): void {
    if (!this.dirPath) return;
    const lastSlash = this.dirPath.lastIndexOf('/');
    this.dirPath = lastSlash > 0 ? this.dirPath.substring(0, lastSlash) : '';
    this.updateDirPathContext();
    this.sendUpdateForCurrentDir();
  }

  toggleFileFilter(): void {
    if (this.view) { post(this.view.webview, { type: 'toggleFileFilter' }); }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeListeners();
    this.view = webviewView;
    // Default title; overridden below if scan data already arrived before this view was shown.
    this.view.title = 'Tree';
    if (this.lastUpdate) {
      const roots = this.getRootsForDir(this.dirPath) ?? this.lastUpdate.roots;
      this.view.title = this.getTitleForDir(this.dirPath, roots);
    }
    this.updateDirPathContext();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: WebviewToBackendMessage) => {
        if (handleCommonMessage(message, {
          onRefresh: this.onRefresh,
          onOpenDirInTab: this.onOpenDirInTab,
        })) { return; }
        if (message.command === 'navigateToDir') {
          if (message.path === this.dirPath) return;
          this.dirPath = message.path;
          this.updateDirPathContext();
          this.sendUpdateForCurrentDir();
          return;
        }
        if (message.command === 'fileFilterActive') {
          vscode.commands.executeCommand('setContext', 'dirview.fileFilterActive', message.active);
          return;
        }
        if (message.command === 'sidebarStats') {
          this.onStatsChange?.(message.scopeRoots, message.filteredRoots);
          return;
        }
      })
    );

    setupVisibilityReplay(webviewView, () => {
      if (!this.lastUpdate) { return undefined; }
      const { autoRescanEnabled, sortMode, truncateThreshold, sidebarStickyHeadersEnabled: stickyHeadersEnabled, isLocal } = this.lastUpdate;
      let roots = this.getRootsForDir(this.dirPath);
      if (this.dirPath !== '' && roots !== undefined && roots.length === 0) {
        this.dirPath = '';
        this.updateDirPathContext();
        roots = this.lastUpdate.roots;
      }
      return { type: 'update', roots: roots ?? [], autoRescanEnabled, sortMode, truncateThreshold, stickyHeadersEnabled, isLocal, dirPath: this.dirPath, workspaceFolderName: this.getWorkspaceFolderName(this.dirPath) };
    }, () => {
      // Replay language filter after the update so the tree renders filtered.
      if (this.lastFilterLangs.length > 0) {
        post(webviewView.webview, { type: 'filter', langs: this.lastFilterLangs });
      }
    });
  }

  showScanning(): void {
    if (this.view) { post(this.view.webview, { type: 'scanning' }); }
  }

  update(payload: ScanUpdatePayload): void {
    this.lastUpdate = payload;
    if (this.view) {
      this.sendUpdateForCurrentDir();
    }
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
    this.lastFilterLangs = langs;
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
      rootHtml: skeletonTreeHtml,
    });
  }
}
