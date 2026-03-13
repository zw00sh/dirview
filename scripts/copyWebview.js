// @ts-check
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'views', 'webview');
const dest = path.join(__dirname, '..', 'out', 'webview');

function copyAssets() {
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    if (file.endsWith('.test.js')) { continue; }
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
    console.log(`Copied ${file} → out/webview/${file}`);
  }
}

if (require.main === module) {
  copyAssets();
}

module.exports = { copyAssets };
