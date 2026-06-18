// Bidirectional message bridge between webview modules and backend handlers.
//
// Webview -> Host: vscode.postMessage(cmd) routes to handleSearchMessage / handleCommonMessage.
// Host -> Webview: dispatchMessage() fires a MessageEvent on window so the
//   webview's createMessageHandler listener receives it.

import * as path from 'path';
import type { SearchService } from '../search/searchService';
import type { BackendToWebviewMessage, WebviewToBackendMessage, SearchRoot } from '../views/webview/types';

// handleSearchMessage and handleCommonMessage are injected by the caller
// to avoid importing providerUtils (which depends on 'vscode') at module level.
// The test file that creates the bridge must vi.mock('vscode') and then pass
// the real functions after the mock is set up.

export type HandleSearchMessageFn = (
  message: WebviewToBackendMessage,
  searchService: SearchService,
  postMessage: (msg: BackendToWebviewMessage) => void,
  rootPaths: string[],
  hasRipgrep?: boolean,
  workspaceRoots?: SearchRoot[],
) => boolean;

export type HandleCommonMessageFn = (
  message: WebviewToBackendMessage,
  callbacks: { onRefresh?: () => void; onOpenDirInTab?: (path: string) => void },
) => boolean;

export interface BridgeOptions {
  searchService: SearchService;
  hasRipgrep: boolean;
  rootPaths: string[];
  workspaceRoots?: SearchRoot[];
  handleSearchMessage: HandleSearchMessageFn;
  handleCommonMessage: HandleCommonMessageFn;
}

export interface Bridge {
  /** Route a webview->host message through the backend handlers. */
  handleWebviewMessage(message: WebviewToBackendMessage): void;
  /** Dispatch a host->webview message by firing a MessageEvent on window. */
  dispatchToWebview(message: BackendToWebviewMessage): void;
  /** Post a message from the backend to the webview (same as dispatchToWebview). */
  postToWebview(message: BackendToWebviewMessage): void;
  /** Returns a promise that resolves when searchResultsDone or non-streaming searchResults
   *  is received by the webview. */
  waitForSearchComplete(): Promise<void>;
  /** Process pending microtasks. */
  flush(): Promise<void>;
  /** Messages sent from host to webview, for debugging. */
  sentMessages: BackendToWebviewMessage[];
}

export function createBridge(options: BridgeOptions): Bridge {
  const { searchService, hasRipgrep, rootPaths, workspaceRoots } = options;
  const handleSearchMsg = options.handleSearchMessage;
  const handleCommonMsg = options.handleCommonMessage;
  const sentMessages: BackendToWebviewMessage[] = [];

  // Pending search complete waiters.
  let searchCompleteResolvers: Array<() => void> = [];

  /** Post a message from backend to the webview. */
  function postToWebview(msg: BackendToWebviewMessage): void {
    sentMessages.push(msg);

    // Check if this is a search-complete signal.
    if (msg.type === 'searchResultsDone' ||
        (msg.type === 'searchResults' && !('active' in msg))) {
      // Resolve all pending waiters after dispatching to the webview.
      const resolvers = searchCompleteResolvers;
      searchCompleteResolvers = [];
      // Dispatch first, then resolve so the webview processes the message before the test continues.
      dispatchToWebview(msg);
      for (const r of resolvers) { r(); }
      return;
    }

    dispatchToWebview(msg);
  }

  /** Dispatch a MessageEvent on window so webview listeners receive it. */
  function dispatchToWebview(msg: BackendToWebviewMessage): void {
    const event = new MessageEvent('message', { data: msg });
    window.dispatchEvent(event);
  }

  /** Handle a message from the webview, routing to backend handlers. */
  function handleWebviewMessage(message: WebviewToBackendMessage): void {
    // Try search messages first.
    const searchHandled = handleSearchMsg(
      message,
      searchService,
      postToWebview,
      rootPaths,
      hasRipgrep,
      workspaceRoots ?? rootPaths.map(p => ({ fsPath: p, name: path.basename(p) })),
    );
    if (searchHandled) return;

    // Try common messages (refresh, openFile, etc.) — no-op callbacks for test env.
    handleCommonMsg(message, {
      onRefresh: () => {},
      onOpenDirInTab: () => {},
    });
  }

  function waitForSearchComplete(): Promise<void> {
    return new Promise((resolve) => {
      searchCompleteResolvers.push(resolve);
    });
  }

  async function flush(): Promise<void> {
    // Flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    handleWebviewMessage,
    dispatchToWebview,
    postToWebview,
    waitForSearchComplete,
    flush,
    sentMessages,
  };
}
