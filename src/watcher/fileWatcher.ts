import * as vscode from 'vscode';

export class FileWatcher {
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private debounceStartTime: number = 0;
  private readonly maxWaitMs: number = 5000;
  private onChangeCallback: () => void;
  private autoRescanEnabled = true;

  constructor(onChangeCallback: () => void) {
    this.onChangeCallback = onChangeCallback;
  }

  start(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcher.onDidCreate(() => this.trigger());
    this.watcher.onDidDelete(() => this.trigger());
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

    const now = Date.now();
    if (this.debounceTimer) {
      // If we've been debouncing longer than maxWaitMs (e.g. during a long npm install),
      // fire immediately rather than starving the UI of updates indefinitely.
      if (now - this.debounceStartTime >= this.maxWaitMs) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        this.debounceStartTime = 0;
        this.onChangeCallback();
        return;
      }
      clearTimeout(this.debounceTimer);
    } else {
      this.debounceStartTime = now;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.debounceStartTime = 0;
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
