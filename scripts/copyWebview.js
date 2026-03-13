// @ts-check
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'views', 'webview');
const dest = path.join(__dirname, '..', 'out', 'webview');

const devMode = process.argv.includes('--dev');

function copyAssets() {
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    if (file.endsWith('.test.js')) { continue; }
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (!devMode && file.endsWith('.js')) {
      // Strip code between /* @DEV_START */ and /* @DEV_END */ markers in production builds.
      let content = fs.readFileSync(srcPath, 'utf8');
      content = content.replace(/\/\* @DEV_START \*\/[\s\S]*?\/\* @DEV_END \*\//g, '');
      fs.writeFileSync(destPath, content);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
    console.log(`Copied ${file} → out/webview/${file}`);
  }
}

if (require.main === module) {
  copyAssets();
}

module.exports = { copyAssets };
