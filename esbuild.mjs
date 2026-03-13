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
