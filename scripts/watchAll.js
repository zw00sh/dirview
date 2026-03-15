// @ts-check
// Runs tsc -watch, esbuild for webview, and watches webview assets for changes in parallel.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { copyAssets } = require('./copyWebview');

const devMode = process.argv.includes('--dev');
const webviewDir = path.join(__dirname, '..', 'src', 'views', 'webview');
const rootDir = path.join(__dirname, '..');

// Initial copy (CSS only)
copyAssets();

// Initial webview esbuild
rebuildWebview();

// Start esbuild + tsc in watch mode
if (devMode) {
  // In dev mode, also bundle with esbuild --dev for DEV_MODE=true
  const esbuild = spawn('node', ['esbuild.mjs', '--dev'], {
    stdio: 'inherit',
    cwd: rootDir,
  });
  esbuild.on('exit', (code) => { if (code) console.error(`esbuild exited with code ${code}`); });
}

const tsc = spawn('npx', ['tsc', '-watch', '-p', './'], {
  stdio: 'inherit',
  cwd: rootDir,
});

// Watch webview assets and rebuild on change
let debounce = null;
fs.watch(webviewDir, { recursive: true }, (_event, filename) => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (filename && filename.endsWith('.css')) {
      console.log(`\n[webview] ${filename} changed, copying CSS...`);
      copyAssets();
    } else if (filename && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
      // Skip test files
      if (filename.includes('.test.')) { return; }
      console.log(`\n[webview] ${filename} changed, rebuilding bundles...`);
      rebuildWebview();
    }
  }, 200);
});

function rebuildWebview() {
  try {
    const devFlag = devMode ? ' --dev' : '';
    // Re-run the full esbuild which now includes webview entry points
    execSync(`node esbuild.mjs${devFlag}`, { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    console.error('[webview] esbuild failed:', e.message);
  }
}

tsc.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => { tsc.kill(); process.exit(0); });
