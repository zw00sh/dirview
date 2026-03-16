import * as esbuild from 'esbuild';

const devMode = process.argv.includes('--dev');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode', '@vscode/ripgrep', 'ws'],
  format: 'cjs',
  platform: 'node',
  sourcemap: false,
  minify: true,
});

console.log(`esbuild: extension bundled → out/extension.js (${devMode ? 'dev' : 'production'})`);

// Bundle webview entry points — each produces a single self-contained JS file.
// format: 'iife' because webview has no module system (loaded via <script> tags).
const webviewEntries = ['main', 'tab', 'languages'];
for (const entry of webviewEntries) {
  await esbuild.build({
    entryPoints: [`src/views/webview/${entry}.ts`],
    bundle: true,
    outfile: `out/webview/${entry}.js`,
    format: 'iife',
    platform: 'browser',
    sourcemap: false,
    minify: !devMode,
  });
  console.log(`esbuild: webview ${entry} bundled → out/webview/${entry}.js`);
}
