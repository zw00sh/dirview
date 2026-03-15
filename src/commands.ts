import * as vscode from 'vscode';
import * as path from 'path';
import { Config } from './config';
import { SidebarProvider } from './views/sidebarProvider';
import { TabProvider } from './views/tabProvider';
import { LanguagesProvider } from './views/languagesProvider';

interface Providers {
  sidebar: SidebarProvider;
  tab: TabProvider;
  languages: LanguagesProvider;
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
  const { sidebar, tab, languages } = providers;

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

  // Three separate commands for each sort mode — each shows a different icon via the
  // dirview.sortMode context key. All handlers are identical: advance to the next mode.
  const cycleSortHandler = async () => {
    const newMode = await config.cycleSortMode();
    sidebar.updateSortMode(newMode);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.cycleSortFiles', cycleSortHandler),
    vscode.commands.registerCommand('dirview.cycleSortName', cycleSortHandler),
    vscode.commands.registerCommand('dirview.cycleSortSize', cycleSortHandler),
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
    vscode.commands.registerCommand('dirview.toggleStickyHeaders', async () => {
      await config.setSidebarStickyHeadersEnabled(true);
      sidebar.updateStickyHeaders(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleStickyHeadersOff', async () => {
      await config.setSidebarStickyHeadersEnabled(false);
      sidebar.updateStickyHeaders(false);
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

  // Both commands call the same toggle — the active one switches based on the
  // dirview.languagesShowPct context key, so only one button is visible at a time.
  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.languagesShowPct', () => languages.toggleDisplayMode()),
    vscode.commands.registerCommand('dirview.languagesShowCount', () => languages.toggleDisplayMode()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.contextCopyPath', (ctx) => {
      const absPath = (ctx.webviewSection === 'file' || ctx.webviewSection === 'matchLine')
        ? ctx.path
        : resolveDirPath(ctx.path, ctx.rootName);
      if (absPath) { vscode.env.clipboard.writeText(absPath); }
    }),

    vscode.commands.registerCommand('dirview.contextRevealInExplorer', (ctx) => {
      const absPath = (ctx.webviewSection === 'file' || ctx.webviewSection === 'matchLine')
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
    }),

    vscode.commands.registerCommand('dirview.contextCopyLineText', (ctx) => {
      if (ctx.lineText) { vscode.env.clipboard.writeText(ctx.lineText); }
    })
  );
}
