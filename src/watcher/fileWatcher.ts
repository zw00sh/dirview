import * as vscode from 'vscode';

export class FileWatcher {
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private onChangeCallback: () => void;
  private autoRescanEnabled = true;

  constructor(onChangeCallback: () => void) {
    this.onChangeCallback = onChangeCallback;
  }

  start(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcher.onDidCreate(() => this.trigger());
    this.watcher.onDidDelete(() => this.trigger());
    this.watcher.onDidChange(() => this.trigger());
  }

  updateAutoRescan(totalFiles: number): void {
    const threshold = vscode.workspace
      .getConfiguration('dirview')
      .get<number>('autoRescanThreshold', 10000);

    this.autoRescanEnabled = totalFiles <= threshold;
  }

  get isAutoRescanEnabled(): boolean {
    return this.autoRescanEnabled;
  }

  private trigger(): void {
    if (!this.autoRescanEnabled) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.onChangeCallback();
    }, 500);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.watcher?.dispose();
  }
}
