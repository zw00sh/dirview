#!/usr/bin/env node
// Generates a DirNode JSON fixture from a real directory tree.
// Usage: node bench/generate-fixture.mjs <dir> [--max-depth N] [--out path]

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const languages = require('linguist-languages');

// ── Language map (replicates src/language/languageMap.ts) ────────────────

const PREFERRED = new Map([
  ['.md', 'Markdown'], ['.yml', 'YAML'], ['.yaml', 'YAML'],
  ['.html', 'HTML'], ['.rs', 'Rust'], ['.sql', 'SQL'], ['.php', 'PHP'],
  ['.txt', 'Text'], ['.m', 'Objective-C'], ['.h', 'C'], ['.ts', 'TypeScript'],
  ['.tsx', 'TSX'], ['.json', 'JSON'], ['.cs', 'C#'], ['.pl', 'Perl'],
  ['.r', 'R'], ['.hh', 'C++'],
]);

const byExtension = new Map();
const byFilename = new Map();

for (const [langName, lang] of Object.entries(languages)) {
  const color = lang.color ?? '#8b8b8b';
  const info = { name: langName, color };
  if (lang.extensions) {
    for (const ext of lang.extensions) {
      const key = ext.toLowerCase();
      if (!byExtension.has(key) || PREFERRED.get(key) === langName) {
        byExtension.set(key, info);
      }
    }
  }
  if (lang.filenames) {
    for (const fn of lang.filenames) {
      byFilename.set(fn.toLowerCase(), info);
    }
  }
}

const OTHER = { name: 'Other', color: '#8b8b8b' };

function getLangInfo(filename) {
  const lower = filename.toLowerCase();
  const byName = byFilename.get(lower);
  if (byName) return byName;
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) {
    const byExt = byExtension.get(lower.slice(dotIdx));
    if (byExt) return byExt;
  }
  return OTHER;
}

// ── VCS directories to always skip ──────────────────────────────────────

const VCS_DIRS = new Set(['.git', '.hg', '.svn', '.bzr', 'node_modules']);

// ── Directory walker ────────────────────────────────────────────────────

function walkDir(dirAbsPath, relativePath, maxDepth, currentDepth) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbsPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const files = [];
  const children = [];
  let totalFiles = 0;
  let sizeBytes = 0;
  let totalLines = 0;
  const statMap = new Map(); // langName -> { name, color, count, sizeBytes, lineCount }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && VCS_DIRS.has(entry.name)) continue;

    const entryAbsPath = path.join(dirAbsPath, entry.name);
    const entryRelPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (currentDepth >= maxDepth) continue;
      const child = walkDir(entryAbsPath, entryRelPath, maxDepth, currentDepth + 1);
      if (child) {
        children.push(child);
        totalFiles += child.totalFiles;
        sizeBytes += child.sizeBytes;
        totalLines += child.totalLines;
        // Merge child stats
        for (const s of child.stats) {
          const existing = statMap.get(s.name);
          if (existing) { existing.count += s.count; existing.sizeBytes += s.sizeBytes; existing.lineCount += s.lineCount; }
          else { statMap.set(s.name, { ...s }); }
        }
      }
    } else if (entry.isFile()) {
      let fileSizeBytes = 0;
      let lineCount = 0;
      let isBinary = false;
      try {
        const stat = fs.statSync(entryAbsPath);
        fileSizeBytes = stat.size;
        if (fileSizeBytes > 0) {
          const fd = fs.openSync(entryAbsPath, 'r');
          try {
            const readLen = Math.min(fileSizeBytes, 1024 * 1024);
            const buf = Buffer.allocUnsafe(readLen);
            fs.readSync(fd, buf, 0, readLen, 0);
            const checkLen = Math.min(readLen, 8192);
            for (let i = 0; i < checkLen; i++) {
              if (buf[i] === 0) { isBinary = true; break; }
            }
            if (!isBinary) {
              for (let i = 0; i < readLen; i++) {
                if (buf[i] === 0x0A) lineCount++;
              }
            }
          } finally { fs.closeSync(fd); }
        }
      } catch { /* skip unreadable */ }
      const lang = getLangInfo(entry.name);
      const fileNode = {
        name: entry.name,
        path: entryAbsPath,
        langName: lang.name,
        langColor: lang.color,
        sizeBytes: fileSizeBytes,
        lineCount,
      };
      if (isBinary) fileNode.isBinary = true;
      files.push(fileNode);
      totalFiles++;
      sizeBytes += fileSizeBytes;
      totalLines += lineCount;
      const existing = statMap.get(lang.name);
      if (existing) { existing.count++; existing.sizeBytes += fileSizeBytes; existing.lineCount += lineCount; }
      else { statMap.set(lang.name, { name: lang.name, color: lang.color, count: 1, sizeBytes: fileSizeBytes, lineCount }); }
    }
  }

  // Sort stats by count descending
  const stats = [...statMap.values()].sort((a, b) => b.count - a.count);

  return {
    name: path.basename(dirAbsPath),
    path: relativePath,
    stats,
    totalFiles,
    sizeBytes,
    totalLines,
    files,
    children,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let targetDir = null;
let maxDepth = Infinity;
let outPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-depth' && args[i + 1]) { maxDepth = parseInt(args[++i], 10); }
  else if (args[i] === '--out' && args[i + 1]) { outPath = args[++i]; }
  else if (!args[i].startsWith('-')) { targetDir = args[i]; }
}

if (!targetDir) {
  console.error('Usage: node bench/generate-fixture.mjs <dir> [--max-depth N] [--out path]');
  process.exit(1);
}

const absDir = path.resolve(targetDir);
if (!fs.existsSync(absDir)) {
  console.error(`Directory not found: ${absDir}`);
  process.exit(1);
}

console.log(`Scanning ${absDir} (max depth: ${maxDepth === Infinity ? 'unlimited' : maxDepth})...`);
const root = walkDir(absDir, '', maxDepth, 0);

if (!root) {
  console.error('Failed to scan directory');
  process.exit(1);
}

if (!outPath) {
  const fixturesDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });
  outPath = path.join(fixturesDir, `${root.name}.json`);
}

const json = JSON.stringify(root, null, 2);
fs.writeFileSync(outPath, json);

const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
console.log(`Wrote ${outPath} (${sizeMB} MB, ${root.totalFiles} files)`);
