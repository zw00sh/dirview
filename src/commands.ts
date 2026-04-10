import * as vscode from 'vscode';
import * as path from 'path';
import { Config } from './config';
import { SidebarProvider } from './views/sidebarProvider';
import { TabProvider } from './views/tabProvider';
import { LanguagesProvider } from './views/languagesProvider';
import { resolveDirPath } from './views/resolveDirPath';

interface Providers {
  sidebar: SidebarProvider;
  tab: TabProvider;
  languages: LanguagesProvider;
}

/** Context object passed by VSCode when a webview context menu command fires. */
type WebviewContext =
  | { webviewSection: 'file'; path: string }
  | { webviewSection: 'matchLine'; path: string; lineText?: string }
  | { webviewSection: 'dir'; path: string; rootName: string };

export function registerCommands(
  context: vscode.ExtensionContext,
  config: Config,
  providers: Providers,
  doScan: () => void,
  getTruncateThreshold: () => number,
  getIsLocal: () => boolean,
): void {
  const { sidebar, tab, languages } = providers;

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.refresh', () => {
      doScan();
    })
  );

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
    const newMode = await config.cycleSortMode(getIsLocal());
    sidebar.updateSortMode(newMode);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.cycleSortFiles', cycleSortHandler),
    vscode.commands.registerCommand('dirview.cycleSortName', cycleSortHandler),
    vscode.commands.registerCommand('dirview.cycleSortSize', cycleSortHandler),
    vscode.commands.registerCommand('dirview.cycleSortLines', cycleSortHandler),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.openInTab', () => {
      tab.openOrFocus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.openFolderInTab', (uri?: vscode.Uri) => {
      if (!uri) { tab.openOrFocus(); return; }
      // Convert absolute URI to workspace-relative path
      const folder = vscode.workspace.workspaceFolders?.find(f =>
        uri.fsPath.startsWith(f.uri.fsPath)
      );
      if (!folder) { tab.openOrFocus(); return; }
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      tab.openForDir(rel || '');
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
    vscode.commands.registerCommand('dirview.navigateUp', () => {
      sidebar.navigateUp();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dirview.toggleFileFilter', () => {
      sidebar.toggleFileFilter();
    }),
    vscode.commands.registerCommand('dirview.toggleFileFilterOff', () => {
      sidebar.toggleFileFilter();
    }),
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
    vscode.commands.registerCommand('dirview.contextCopyPath', (ctx: WebviewContext) => {
      const absPath = (ctx.webviewSection === 'file' || ctx.webviewSection === 'matchLine')
        ? ctx.path
        : resolveDirPath(ctx.path, ctx.rootName);
      if (absPath) { vscode.env.clipboard.writeText(absPath); }
    }),

    vscode.commands.registerCommand('dirview.contextRevealInExplorer', (ctx: WebviewContext) => {
      const absPath = (ctx.webviewSection === 'file' || ctx.webviewSection === 'matchLine')
        ? ctx.path
        : resolveDirPath(ctx.path, ctx.rootName);
      if (absPath) { vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(absPath)); }
    }),

    vscode.commands.registerCommand('dirview.contextOpenFile', (ctx: WebviewContext) => {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(ctx.path));
    }),

    vscode.commands.registerCommand('dirview.contextOpenInTerminal', (ctx: WebviewContext) => {
      if (ctx.webviewSection === 'dir') {
        const absPath = resolveDirPath(ctx.path, ctx.rootName);
        if (absPath) { vscode.commands.executeCommand('openInTerminal', vscode.Uri.file(absPath)); }
      }
    }),

    vscode.commands.registerCommand('dirview.contextCopyLineText', (ctx: WebviewContext) => {
      if (ctx.webviewSection === 'matchLine' && ctx.lineText) { vscode.env.clipboard.writeText(ctx.lineText); }
    })
  );
}
