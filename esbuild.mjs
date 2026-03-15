import * as esbuild from 'esbuild';

const devMode = process.argv.includes('--dev');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode', '@vscode/ripgrep'],
  format: 'cjs',
  platform: 'node',
  sourcemap: false,
  minify: true,
  // DEV_MODE is a compile-time constant. When false (production), esbuild's
  // dead-code elimination strips all `if (DEV_MODE) { ... }` blocks entirely.
  define: { DEV_MODE: String(devMode) },
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
    define: { DEV_MODE: String(devMode) },
  });
  console.log(`esbuild: webview ${entry} bundled → out/webview/${entry}.js`);
}
