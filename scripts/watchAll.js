// @ts-check
// Runs tsc -watch and watches webview assets for changes in parallel.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { copyAssets } = require('./copyWebview');

const webviewDir = path.join(__dirname, '..', 'src', 'views', 'webview');

// Initial copy
copyAssets();

// Start tsc in watch mode
const tsc = spawn('npx', ['tsc', '-watch', '-p', './'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

// Watch webview assets and copy on change
let debounce = null;
fs.watch(webviewDir, { recursive: true }, (_event, filename) => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log(`\n[webview] ${filename} changed, copying assets...`);
    copyAssets();
  }, 200);
});

tsc.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => { tsc.kill(); process.exit(0); });
