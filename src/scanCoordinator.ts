import * as vscode from 'vscode';
import { scanWorkspace } from './scanner/fileScanner';
import { Config } from './config';
import { SidebarProvider } from './views/sidebarProvider';
import { LanguagesProvider } from './views/languagesProvider';
import { TabProvider } from './views/tabProvider';
import { FileWatcher } from './watcher/fileWatcher';

export class ScanCoordinator {
  private scanInProgress = false;
  private scanQueued = false;
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
      this.scanQueued = true;
      return;
    }
    this.scanInProgress = true;
    try {
      this.sidebar.showScanning();
      this.tab.showScanning();
      const result = await scanWorkspace(this.config.showIgnored);
      this.watcher?.updateAutoRescan(result.totalFiles);
      const autoRescanEnabled = this.watcher ? this.watcher.isAutoRescanEnabled : true;
      const truncateThreshold = this.getTruncateThreshold();
      this.sidebar.update(result.roots, autoRescanEnabled, this.config.sortMode, truncateThreshold);
      this.languages.update(result.roots);
      this.tab.update(result.roots, autoRescanEnabled, this.config.showIgnored);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sidebar.showError(message);
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
