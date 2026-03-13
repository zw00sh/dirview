import * as vscode from 'vscode';
import * as path from 'path';
import { Config } from './config';
import { SidebarProvider } from './views/sidebarProvider';
import { TabProvider } from './views/tabProvider';

interface Providers {
  sidebar: SidebarProvider;
  tab: TabProvider;
}

function resolveDirPath(relativePath: string, rootName: string): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(f => f.name === rootName);
  if (!folder) { return undefined; }
  return path.join(folder.uri.fsPath, relativePath);
}

export function registerCommands(
  context: vscode.ExtensionContext,
  config: Config,
  providers: Providers,
  doScan: () => void,
  getTruncateThreshold: () => number,
): void {
  const { sidebar, tab } = providers;

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
      sidebar.updateSortMode(newMode);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.openInTab', () => {
      tab.openOrFocus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleTruncation', async () => {
      await config.setTruncationEnabled(true);
      const threshold = getTruncateThreshold();
      // Only update the sidebar — each tab manages its own truncation state independently
      sidebar.updateTruncateThreshold(threshold);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleTruncationOff', async () => {
      await config.setTruncationEnabled(false);
      // Only update the sidebar — each tab manages its own truncation state independently
      sidebar.updateTruncateThreshold(0);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.expandAll', () => {
      sidebar.expandAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.collapseAll', () => {
      sidebar.collapseAll();
    })
  );

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
}
