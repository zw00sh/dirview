// @ts-check
// Copies webview CSS assets from src/views/webview/ to out/webview/.
// JS files are no longer copied — they are bundled by esbuild from TypeScript sources.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'views', 'webview');
const dest = path.join(__dirname, '..', 'out', 'webview');

function copyAssets() {
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    // Only copy CSS files — JS is produced by esbuild, TS is source only.
    if (!file.endsWith('.css')) { continue; }
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${file} → out/webview/${file}`);
  }
}

if (require.main === module) {
  copyAssets();
}

module.exports = { copyAssets };
