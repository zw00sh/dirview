import * as vscode from 'vscode';
import { SidebarProvider } from './views/sidebarProvider';
import { LanguagesProvider } from './views/languagesProvider';
import { TabProvider } from './views/tabProvider';
import { Config } from './config';
import { ScanCoordinator } from './scanCoordinator';
import { registerCommands } from './commands';
import { updateTheme } from './highlight/highlighter';

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

  registerCommands(context, config, { sidebar: sidebarProvider, tab: tabProvider, languages: languagesProvider },
    () => coordinator.scan(),
    () => coordinator.getTruncateThreshold(),
  );

  coordinator.startWatcher(context);

  // Set initial Shiki theme to match VSCode's active color theme, and update on changes
  updateTheme(vscode.window.activeColorTheme.kind);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(e => {
      updateTheme(e.kind);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => coordinator.scan())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('dirview.truncateThreshold')) {
        const threshold = coordinator.getTruncateThreshold();
        sidebarProvider.updateTruncateThreshold(threshold);
        tabProvider.updateTruncation(threshold);
      }
    })
  );

  await coordinator.scan();

  const openOnStartup = vscode.workspace.getConfiguration('dirview').get<boolean>('openTabOnStartup', false);
  if (openOnStartup && vscode.workspace.workspaceFolders?.length) {
    tabProvider.openOrFocus();
  }
}

export function deactivate(): void {}
