import * as vscode from 'vscode';
import { getNonce } from './getNonce';

/** Shared script files loaded before any view-specific script (main.js, tab.js, etc.). */
export const SHARED_SCRIPTS = [
  'shared-icons.js', 'shared-utils.js', 'shared-state.js',
  'shared-renderer.js', 'shared.js',
];

export interface BuildWebviewHtmlOptions {
  scripts: string[];   // filenames relative to out/webview/, e.g. ['shared.js', 'main.js']
  styles: string[];    // filenames relative to out/webview/, e.g. ['style.css']
  title: string;
  bodyClass?: string;
  bodyAttrs?: string;
  bodyHtml?: string;   // inserted before <div id="root">
  skipRoot?: boolean;  // when true, omits the auto-generated <div id="root"> (bodyHtml must include it)
  debug?: boolean;     // when true, adds 'unsafe-eval' to CSP for cross-frame debug bridge
}

export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options: BuildWebviewHtmlOptions
): string {
  const nonce = getNonce();

  const styleLinks = options.styles.map(file => {
    const uri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', file)
    );
    return `  <link href="${uri}" rel="stylesheet">`;
  }).join('\n');

  const scriptTags = options.scripts.map(file => {
    const uri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', file)
    );
    return `  <script nonce="${nonce}" src="${uri}"></script>`;
  }).join('\n');

  const bodyClassAttr = options.bodyClass ? ` class="${options.bodyClass}"` : '';
  const bodyExtraAttrs = options.bodyAttrs ? ` ${options.bodyAttrs}` : '';
  const debugAttr = options.debug ? ' data-debug' : '';
  const bodyHtml = options.bodyHtml ? `\n${options.bodyHtml}` : '';
  const scriptSrc = options.debug ? `'nonce-${nonce}' 'unsafe-eval'` : `'nonce-${nonce}'`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${scriptSrc};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${styleLinks}
  <title>${options.title}</title>
</head>
<body${bodyClassAttr}${bodyExtraAttrs}${debugAttr}>${bodyHtml}${options.skipRoot ? '' : '\n  <div id="root"></div>'}
${scriptTags}
</body>
</html>`;
}
