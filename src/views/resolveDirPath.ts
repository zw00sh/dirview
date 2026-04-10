import * as vscode from 'vscode';
import * as path from 'path';

/** Resolves a webview-relative directory path to an absolute filesystem path.
 *
 *  In multi-root workspaces, the webview path is prefixed with the root folder name
 *  (e.g. "frontend/src/scanner"). This function strips the rootName prefix before
 *  joining with the matching workspace folder's fsPath.
 *
 *  In single-root workspaces, the path is plain workspace-relative ("src/scanner")
 *  and is joined directly with the only folder.
 *
 *  Returns undefined when the rootName doesn't match any workspace folder. */
export function resolveDirPath(relativePath: string, rootName: string): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(f => f.name === rootName);
  if (!folder) { return undefined; }
  // Strip the root name prefix that was added in multi-root mode by prefixRootPaths().
  let rel = relativePath;
  if (relativePath === rootName) {
    rel = '';
  } else if (relativePath.startsWith(rootName + '/')) {
    rel = relativePath.slice(rootName.length + 1);
  }
  return path.join(folder.uri.fsPath, rel);
}
