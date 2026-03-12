import * as vscode from 'vscode';

/** Handles messages that are common to both SidebarProvider and TabProvider.
 *  Returns true if the message was handled, false if the caller should continue processing. */
export function handleCommonMessage(
  message: { command: string; path?: string },
  callbacks: {
    onRefresh?: () => void;
    onOpenDirInTab?: (path: string) => void;
  }
): boolean {
  if (message.command === 'refresh') {
    callbacks.onRefresh?.();
    return true;
  }
  if (message.command === 'openFile' && message.path) {
    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.path));
    return true;
  }
  if (message.command === 'openDirInTab' && message.path) {
    callbacks.onOpenDirInTab?.(message.path);
    return true;
  }
  return false;
}

/** Wires visibility-change and initial-replay for a WebviewView.
 *  getCachedMessage() is called each time; if it returns undefined the replay is skipped. */
export function setupVisibilityReplay(
  webviewView: vscode.WebviewView,
  getCachedMessage: () => object | undefined
): void {
  webviewView.onDidChangeVisibility(() => {
    if (webviewView.visible) {
      const msg = getCachedMessage();
      if (msg) { webviewView.webview.postMessage(msg); }
    }
  });

  const initial = getCachedMessage();
  if (initial) {
    setTimeout(() => {
      const msg = getCachedMessage();
      if (msg) { webviewView.webview.postMessage(msg); }
    }, 100);
  }
}
