import * as vscode from 'vscode';

export type SortMode = 'files' | 'name' | 'size';
const SORT_CYCLE: SortMode[] = ['files', 'name', 'size'];

export class Config {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  get showIgnored(): boolean {
    return this.context.workspaceState.get<boolean>('dirview.showIgnored', false);
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

  async cycleSortMode(): Promise<SortMode> {
    const current = this.sortMode;
    const idx = SORT_CYCLE.indexOf(current);
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length];
    await this.context.workspaceState.update('dirview.sortMode', next);
    return next;
  }

  async init(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'dirview.showIgnored', this.showIgnored);
    await vscode.commands.executeCommand('setContext', 'dirview.truncationEnabled', this.truncationEnabled);
    await vscode.commands.executeCommand('setContext', 'dirview.allExpanded', false);
  }
}
