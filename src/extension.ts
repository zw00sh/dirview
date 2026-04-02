import * as vscode from 'vscode';
import { SidebarProvider } from './views/sidebarProvider';
import { LanguagesProvider } from './views/languagesProvider';
import { TabProvider } from './views/tabProvider';
import { Config } from './config';
import { ScanCoordinator } from './scanCoordinator';
import { registerCommands } from './commands';
import { updateTheme } from './highlight/highlighter';
import { setBridgeBroadcast } from './views/providerUtils';
import type { Bridge } from './bench/wsbridge';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = new Config(context);
  await config.init();

  const sidebarProvider = new SidebarProvider(context.extensionUri);
  const languagesProvider = new LanguagesProvider(context.extensionUri);
  const tabProvider = new TabProvider(context.extensionUri, config);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dirview.sidebar', sidebarProvider)
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dirview.languages', languagesProvider)
  );
  // Wire filter: languages panel → sidebar tree
  languagesProvider.onFilterChange = (langs) => {
    sidebarProvider.setFilter(langs);
  };

  // Wire refresh callbacks so both views trigger a rescan without a VSCode command
  const coordinator = new ScanCoordinator(config, sidebarProvider, languagesProvider, tabProvider);
  sidebarProvider.onRefresh = () => coordinator.scan();
  tabProvider.onRefresh = () => coordinator.scan();

  // Wire open-in-tab: both sidebar and tab views can open a directory in a new tab
  sidebarProvider.onOpenDirInTab = (dirPath) => tabProvider.openForDir(dirPath);
  tabProvider.onOpenDirInTab = (dirPath) => tabProvider.openForDir(dirPath);

  // Wire sidebar stats → languages panel (drill-down + file filter sync)
  sidebarProvider.onStatsChange = (scopeRoots, filteredRoots) => languagesProvider.updateFromSidebar(scopeRoots, filteredRoots);

  registerCommands(context, config, { sidebar: sidebarProvider, tab: tabProvider, languages: languagesProvider },
    () => coordinator.scan(),
    () => coordinator.getTruncateThreshold(),
    () => coordinator.isLocal,
  );

  coordinator.startWatcher(context);
  context.subscriptions.push({ dispose: () => coordinator.dispose() });

  // Set initial Shiki theme to match VSCode's active color theme, and update on changes
  updateTheme(vscode.window.activeColorTheme.kind);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(e => {
      updateTheme(e.kind);
      tabProvider.notifyThemeChanged();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => coordinator.scan())
  );

  // Status bar button to open breakdown tab
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(graph)';
  statusBarItem.tooltip = 'Open Breakdown Tab';
  statusBarItem.command = 'dirview.openInTab';
  if (vscode.workspace.getConfiguration('dirview').get<boolean>('showStatusBarButton', true)) {
    statusBarItem.show();
  }
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('dirview.showStatusBarButton')) {
        if (vscode.workspace.getConfiguration('dirview').get<boolean>('showStatusBarButton', true)) {
          statusBarItem.show();
        } else {
          statusBarItem.hide();
        }
      }
      if (e.affectsConfiguration('dirview.truncateThreshold')) {
        const threshold = coordinator.getTruncateThreshold();
        sidebarProvider.updateTruncateThreshold(threshold);
        tabProvider.updateTruncation(threshold);
      }
    })
  );

  // ── Bench WebSocket bridge (dev-only, not in package.json contributes) ──
  let activeBridge: Bridge | null = null;
  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.startBenchBridge', async (port?: number) => {
      if (activeBridge) {
        vscode.window.showInformationMessage(`Bench bridge already running on port ${activeBridge.port}`);
        return;
      }
      const { startBridge } = await import('./bench/wsbridge');
      activeBridge = startBridge(port ?? 9225);
      setBridgeBroadcast(activeBridge.broadcast.bind(activeBridge));
      vscode.window.showInformationMessage(`Bench bridge started on ws://localhost:${activeBridge.port}`);
    }),
    vscode.commands.registerCommand('dirview.stopBenchBridge', () => {
      if (!activeBridge) { return; }
      activeBridge.stop();
      activeBridge = null;
      setBridgeBroadcast(null);
      vscode.window.showInformationMessage('Bench bridge stopped');
    }),
  );

  const openOnStartup = vscode.workspace.getConfiguration('dirview').get<boolean>('openTabOnStartup', false);
  if (openOnStartup && vscode.workspace.workspaceFolders?.length) {
    tabProvider.openOrFocus();
  }

  await coordinator.scan();
}

export function deactivate(): void {}
