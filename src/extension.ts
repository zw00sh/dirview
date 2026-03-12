import * as vscode from 'vscode';
import * as path from 'path';
import { SidebarProvider } from './views/sidebarProvider';
import { LanguagesProvider } from './views/languagesProvider';
import { TabProvider } from './views/tabProvider';
import { scanWorkspace } from './scanner/fileScanner';
import { FileWatcher } from './watcher/fileWatcher';
import { Config } from './config';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = new Config(context);
  await config.init();

  const sidebarProvider = new SidebarProvider(context.extensionUri);
  const languagesProvider = new LanguagesProvider(context.extensionUri);
  const tabProvider = new TabProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dirview.sidebar', sidebarProvider)
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dirview.languages', languagesProvider)
  );

  // Wire filter: languages panel → sidebar tree only (tab has its own independent filter)
  languagesProvider.onFilterChange = (langs) => {
    sidebarProvider.setFilter(langs);
  };

  // Update expand/collapse context key when user manually expands/collapses dirs in sidebar
  sidebarProvider.onExpandChanged = (hasAny: boolean) => {
    vscode.commands.executeCommand('setContext', 'dirview.allExpanded', hasAny);
  };

  // Tab legend manages its own filter state independently; no cross-view propagation
  tabProvider.onFilterChange = (_langs) => {};
  tabProvider.getConfiguredThreshold = () =>
    vscode.workspace.getConfiguration('dirview').get<number>('truncateThreshold', 4);

  // Wire refresh callbacks so both views trigger a rescan without a VSCode command
  sidebarProvider.onRefresh = () => doScan();
  tabProvider.onRefresh = () => doScan();

  function getTruncateThreshold(): number {
    if (!config.truncationEnabled) { return 0; }
    return vscode.workspace.getConfiguration('dirview').get<number>('truncateThreshold', 4);
  }

  let watcher: FileWatcher | undefined;
  let scanInProgress = false;
  let scanQueued = false;

  async function doScan(): Promise<void> {
    if (scanInProgress) {
      scanQueued = true;
      return;
    }
    scanInProgress = true;
    try {
      sidebarProvider.showScanning();
      tabProvider.showScanning();
      const result = await scanWorkspace(config.showIgnored);
      watcher?.updateAutoRescan(result.totalFiles);
      const autoRescanEnabled = watcher ? watcher.isAutoRescanEnabled : true;
      const truncateThreshold = getTruncateThreshold();
      sidebarProvider.update(result.roots, autoRescanEnabled, config.sortMode, truncateThreshold);
      languagesProvider.update(result.roots);
      tabProvider.update(result.roots, autoRescanEnabled, config.showIgnored);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sidebarProvider.showError(message);
    } finally {
      scanInProgress = false;
      if (scanQueued) {
        scanQueued = false;
        doScan();
      }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleIgnored', async () => {
      await config.setShowIgnored(true);
      doScan();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleIgnoredOff', async () => {
      await config.setShowIgnored(false);
      doScan();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.cycleSort', async () => {
      const newMode = await config.cycleSortMode();
      sidebarProvider.updateSortMode(newMode);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.openInTab', () => {
      tabProvider.openOrFocus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleTruncation', async () => {
      await config.setTruncationEnabled(true);
      const threshold = getTruncateThreshold();
      sidebarProvider.updateTruncateThreshold(threshold);
      tabProvider.updateTruncation(threshold, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleTruncationOff', async () => {
      await config.setTruncationEnabled(false);
      sidebarProvider.updateTruncateThreshold(0);
      tabProvider.updateTruncation(0, false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.expandAll', () => {
      sidebarProvider.expandAll();
      vscode.commands.executeCommand('setContext', 'dirview.allExpanded', true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.collapseAll', () => {
      sidebarProvider.collapseAll();
      vscode.commands.executeCommand('setContext', 'dirview.allExpanded', false);
    })
  );

  watcher = new FileWatcher(() => doScan());
  watcher.start();
  context.subscriptions.push({
    dispose: () => watcher?.dispose(),
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => doScan())
  );

  function resolveDirPath(relativePath: string, rootName: string): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.find(f => f.name === rootName);
    if (!folder) { return undefined; }
    return path.join(folder.uri.fsPath, relativePath);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.contextCopyPath', (ctx) => {
      const absPath = ctx.webviewSection === 'file'
        ? ctx.path
        : resolveDirPath(ctx.path, ctx.rootName);
      if (absPath) { vscode.env.clipboard.writeText(absPath); }
    }),

    vscode.commands.registerCommand('dirview.contextRevealInExplorer', (ctx) => {
      const absPath = ctx.webviewSection === 'file'
        ? ctx.path
        : resolveDirPath(ctx.path, ctx.rootName);
      if (absPath) { vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(absPath)); }
    }),

    vscode.commands.registerCommand('dirview.contextOpenFile', (ctx) => {
      if (ctx.path) { vscode.commands.executeCommand('vscode.open', vscode.Uri.file(ctx.path)); }
    }),

    vscode.commands.registerCommand('dirview.contextOpenInTerminal', (ctx) => {
      const absPath = resolveDirPath(ctx.path, ctx.rootName);
      if (absPath) { vscode.commands.executeCommand('openInTerminal', vscode.Uri.file(absPath)); }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('dirview.truncateThreshold')) {
        const threshold = getTruncateThreshold();
        sidebarProvider.updateTruncateThreshold(threshold);
        tabProvider.updateTruncation(threshold);
      }
    })
  );

  await doScan();

  const openOnStartup = vscode.workspace.getConfiguration('dirview').get<boolean>('openTabOnStartup', false);
  if (openOnStartup && vscode.workspace.workspaceFolders?.length) {
    tabProvider.openOrFocus();
  }
}

export function deactivate(): void {}
