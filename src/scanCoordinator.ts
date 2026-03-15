import * as vscode from 'vscode';
import { scanWorkspace } from './scanner/fileScanner';
import { Config } from './config';
import { ScanUpdatePayload } from './scanner/types';
import { SidebarProvider } from './views/sidebarProvider';
import { LanguagesProvider } from './views/languagesProvider';
import { TabProvider } from './views/tabProvider';
import { FileWatcher } from './watcher/fileWatcher';

export class ScanCoordinator {
  private scanInProgress = false;
  private scanQueued = false;
  private abortController: AbortController | undefined;
  private watcher: FileWatcher | undefined;

  constructor(
    private config: Config,
    private sidebar: SidebarProvider,
    private languages: LanguagesProvider,
    private tab: TabProvider,
  ) {}

  getTruncateThreshold(): number {
    if (!this.config.truncationEnabled) { return 0; }
    return vscode.workspace.getConfiguration('dirview').get<number>('truncateThreshold', 4);
  }

  async scan(): Promise<void> {
    if (this.scanInProgress) {
      // Abort the in-flight scan and queue a fresh one — this ensures rapid file
      // changes don't pile up; the latest state is always rendered after the abort.
      this.abortController?.abort();
      this.scanQueued = true;
      return;
    }
    this.scanInProgress = true;
    this.abortController = new AbortController();
    try {
      this.sidebar.showScanning();
      this.tab.showScanning();
      this.languages.showScanning();
      const result = await scanWorkspace(this.config.showIgnored, this.abortController.signal);
      // If the scan was cancelled, don't push stale partial data to the views.
      if (this.abortController.signal.aborted) { return; }
      this.watcher?.updateAutoRescan(result.totalFiles);
      const autoRescanEnabled = this.watcher ? this.watcher.isAutoRescanEnabled : true;
      const truncateThreshold = this.getTruncateThreshold();
      const payload: ScanUpdatePayload = {
        roots: result.roots,
        autoRescanEnabled,
        sortMode: this.config.sortMode,
        truncateThreshold,
        showIgnored: this.config.showIgnored,
        sidebarStickyHeadersEnabled: this.config.sidebarStickyHeadersEnabled,
        tabStickyHeadersEnabled: this.config.tabStickyHeadersEnabled,
      };
      this.sidebar.update(payload);
      this.languages.update(payload);
      this.tab.update(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sidebar.showError(message);
      this.tab.showError(message);
      this.languages.showError(message);
    } finally {
      this.scanInProgress = false;
      if (this.scanQueued) {
        this.scanQueued = false;
        this.scan();
      }
    }
  }

  startWatcher(context: vscode.ExtensionContext): void {
    this.watcher = new FileWatcher(() => this.scan());
    this.watcher.start();
    context.subscriptions.push({ dispose: () => this.watcher?.dispose() });
  }
}
