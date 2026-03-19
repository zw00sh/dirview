import * as vscode from 'vscode';
import type { SortMode } from './views/webview/types';

export type { SortMode };
const SORT_CYCLE: readonly SortMode[] = ['files', 'name', 'size'] as const;
const SORT_CYCLE_NO_SIZE: readonly SortMode[] = ['files', 'name'] as const;

export class Config {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  get showIgnored(): boolean {
    const override = this.context.workspaceState.get<boolean>('dirview.showIgnored');
    if (override !== undefined) return override;
    return vscode.workspace.getConfiguration('dirview').get<boolean>('showIgnored', true);
  }

  async setShowIgnored(value: boolean): Promise<void> {
    await this.context.workspaceState.update('dirview.showIgnored', value);
    await vscode.commands.executeCommand('setContext', 'dirview.showIgnored', value);
  }

  get truncationEnabled(): boolean {
    return this.context.workspaceState.get<boolean>('dirview.truncationEnabled', true);
  }

  async setTruncationEnabled(value: boolean): Promise<void> {
    await this.context.workspaceState.update('dirview.truncationEnabled', value);
    await vscode.commands.executeCommand('setContext', 'dirview.truncationEnabled', value);
  }

  get sortMode(): SortMode {
    return this.context.workspaceState.get<SortMode>('dirview.sortMode', 'files');
  }

  async cycleSortMode(isLocal = true): Promise<SortMode> {
    const cycle = isLocal ? SORT_CYCLE : SORT_CYCLE_NO_SIZE;
    const current = this.sortMode;
    const idx = cycle.indexOf(current);
    const next = cycle[(idx + 1) % cycle.length];
    await this.context.workspaceState.update('dirview.sortMode', next);
    await vscode.commands.executeCommand('setContext', 'dirview.sortMode', next);
    return next;
  }

  get sidebarStickyHeadersEnabled(): boolean {
    return this.context.workspaceState.get<boolean>('dirview.sidebarStickyHeadersEnabled', true);
  }

  async setSidebarStickyHeadersEnabled(value: boolean): Promise<void> {
    await this.context.workspaceState.update('dirview.sidebarStickyHeadersEnabled', value);
    await vscode.commands.executeCommand('setContext', 'dirview.stickyHeadersEnabled', value);
  }

  get tabStickyHeadersEnabled(): boolean {
    return this.context.workspaceState.get<boolean>('dirview.tabStickyHeadersEnabled', true);
  }

  async setTabStickyHeadersEnabled(value: boolean): Promise<void> {
    await this.context.workspaceState.update('dirview.tabStickyHeadersEnabled', value);
  }

  async init(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'dirview.showIgnored', this.showIgnored);
    await vscode.commands.executeCommand('setContext', 'dirview.truncationEnabled', this.truncationEnabled);
    await vscode.commands.executeCommand('setContext', 'dirview.sortMode', this.sortMode);
    await vscode.commands.executeCommand('setContext', 'dirview.stickyHeadersEnabled', this.sidebarStickyHeadersEnabled);
    await vscode.commands.executeCommand('setContext', 'dirview.allExpanded', false);
  }
}
