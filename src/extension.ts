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

  if (DEV_MODE) {
    sidebarProvider.debug = true;
    languagesProvider.debug = true;
    tabProvider.debug = true;
  }

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
      tabProvider.notifyThemeChanged();
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

  if (DEV_MODE) {
    let debugEvalId = 0;
    // Pending eval promises keyed by id — resolved when a webview responds.
    const pending = new Map<number, (value: string) => void>();

    // Called by any provider when its webview sends back a debugEvalResult.
    // First responder wins — the pending entry is deleted after first resolution.
    const onDebugResult = (msg: { id?: number; result?: string; error?: string }) => {
      const id = msg.id;
      if (id === undefined) { return; }
      const value = msg.error ? `ERROR: ${msg.error}` : (msg.result ?? '');
      console.log(`[dirview:debugEval] #${id} →`, value);
      const resolve = pending.get(id);
      if (resolve) { pending.delete(id); resolve(value); }
    };
    sidebarProvider.onDebugResult = onDebugResult;
    tabProvider.onDebugResult = onDebugResult;
    languagesProvider.onDebugResult = onDebugResult;

    // Named providers for targeted eval. 'all' broadcasts to every provider.
    const providerMap: Record<string, Array<{ debugEval: (s: string, id: number) => void }>> = {
      sidebar: [sidebarProvider],
      tab: [tabProvider],
      languages: [languagesProvider],
      all: [sidebarProvider, tabProvider, languagesProvider],
    };

    // Evaluates a script in the specified target frame(s) and returns the first response.
    // Exposed as globalThis.__dirviewDebugEval(script, target?) on the Node inspector.
    // Call via: npm run debug-eval -- <target>  (reads /tmp/dirview-debug.js)
    const debugEval = (script: string, target?: string): Promise<string> => {
      const id = ++debugEvalId;
      const targets = providerMap[target || 'all'] ?? providerMap.all;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        for (const provider of targets) { provider.debugEval(script, id); }
        // Timeout: resolve with error if no webview responds within 3s.
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            resolve(`[timeout] no webview responded to debugEval #${id}`);
          }
        }, 3000);
      });
    };

    context.subscriptions.push(
      vscode.commands.registerCommand('dirview.debugEval', debugEval)
    );

    // Expose on globalThis so the Node inspector (port 9223) can call it directly.
    // Also expose the vscode commands API for arbitrary command execution.
    (globalThis as any).__dirviewDebugEval = debugEval;
    (globalThis as any).__dirviewExecCommand = vscode.commands.executeCommand.bind(vscode.commands);
  }

  await coordinator.scan();

  const openOnStartup = vscode.workspace.getConfiguration('dirview').get<boolean>('openTabOnStartup', false);
  if (openOnStartup && vscode.workspace.workspaceFolders?.length) {
    tabProvider.openOrFocus();
  }
}

export function deactivate(): void {}
