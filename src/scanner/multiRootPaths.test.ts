import { describe, it, expect } from 'vitest';
import { prefixRootPaths, splitRootPath } from './multiRootPaths';
import type { DirNode, FileNode } from './types';

function makeFile(name: string, absPath: string): FileNode {
  return { name, path: absPath, langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100, lineCount: 10 };
}

function makeDir(name: string, relPath: string, children: DirNode[] = [], files: FileNode[] = []): DirNode {
  return {
    name,
    path: relPath,
    stats: [],
    totalFiles: 0,
    sizeBytes: 0,
    totalLines: 0,
    files,
    children,
  };
}

describe('prefixRootPaths', () => {
  it('returns empty array unchanged', () => {
    expect(prefixRootPaths([])).toEqual([]);
  });

  it('returns single-root unchanged (no prefixing)', () => {
    const roots: DirNode[] = [
      makeDir('frontend', '', [
        makeDir('src', 'src', [makeDir('utils', 'src/utils')]),
      ]),
    ];
    const result = prefixRootPaths(roots);
    expect(result).toBe(roots); // identity for single-root
    expect(result[0].path).toBe('');
    expect(result[0].children[0].path).toBe('src');
    expect(result[0].children[0].children[0].path).toBe('src/utils');
  });

  it('prefixes each root path with its name in multi-root', () => {
    const roots: DirNode[] = [
      makeDir('frontend', '', [makeDir('src', 'src')]),
      makeDir('backend', '', [makeDir('lib', 'lib')]),
    ];
    const result = prefixRootPaths(roots);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('frontend');
    expect(result[1].path).toBe('backend');
  });

  it('recursively prefixes child paths', () => {
    const roots: DirNode[] = [
      makeDir('frontend', '', [
        makeDir('src', 'src', [
          makeDir('utils', 'src/utils', [
            makeDir('helpers', 'src/utils/helpers'),
          ]),
        ]),
      ]),
      makeDir('backend', '', []),
    ];
    const result = prefixRootPaths(roots);
    expect(result[0].path).toBe('frontend');
    expect(result[0].children[0].path).toBe('frontend/src');
    expect(result[0].children[0].children[0].path).toBe('frontend/src/utils');
    expect(result[0].children[0].children[0].children[0].path).toBe('frontend/src/utils/helpers');
  });

  it('does not modify input nodes (returns new objects)', () => {
    const child = makeDir('src', 'src');
    const root = makeDir('frontend', '', [child]);
    const roots = [root, makeDir('backend', '')];
    const result = prefixRootPaths(roots);
    expect(root.path).toBe(''); // original unchanged
    expect(child.path).toBe('src'); // original unchanged
    expect(result[0]).not.toBe(root);
    expect(result[0].children[0]).not.toBe(child);
  });

  it('preserves FileNode objects (file paths are absolute, not modified)', () => {
    const file = makeFile('index.ts', '/abs/frontend/index.ts');
    const roots: DirNode[] = [
      makeDir('frontend', '', [], [file]),
      makeDir('backend', ''),
    ];
    const result = prefixRootPaths(roots);
    expect(result[0].files[0]).toBe(file); // file references preserved
    expect(result[0].files[0].path).toBe('/abs/frontend/index.ts');
  });

  it('preserves stats and totals', () => {
    const root = makeDir('frontend', '');
    root.stats = [{ name: 'TypeScript', color: '#3178c6', count: 5, sizeBytes: 500, lineCount: 50 }];
    root.totalFiles = 5;
    root.sizeBytes = 500;
    root.totalLines = 50;
    const result = prefixRootPaths([root, makeDir('backend', '')]);
    expect(result[0].stats).toEqual(root.stats);
    expect(result[0].totalFiles).toBe(5);
    expect(result[0].sizeBytes).toBe(500);
    expect(result[0].totalLines).toBe(50);
    expect(result[0].name).toBe('frontend');
  });

  it('handles two roots that contain identically-named subdirectories without collision', () => {
    const roots: DirNode[] = [
      makeDir('frontend', '', [makeDir('src', 'src')]),
      makeDir('backend', '', [makeDir('src', 'src')]),
    ];
    const result = prefixRootPaths(roots);
    expect(result[0].children[0].path).toBe('frontend/src');
    expect(result[1].children[0].path).toBe('backend/src');
    // The two paths are now distinct.
    expect(result[0].children[0].path).not.toBe(result[1].children[0].path);
  });
});

describe('splitRootPath', () => {
  it('splits a multi-segment path into rootName and relPath', () => {
    expect(splitRootPath('frontend/src/scanner')).toEqual({ rootName: 'frontend', relPath: 'src/scanner' });
  });

  it('handles a root-only path (no slashes)', () => {
    expect(splitRootPath('frontend')).toEqual({ rootName: 'frontend', relPath: '' });
  });

  it('handles a two-segment path', () => {
    expect(splitRootPath('frontend/src')).toEqual({ rootName: 'frontend', relPath: 'src' });
  });

  it('handles an empty string', () => {
    expect(splitRootPath('')).toEqual({ rootName: '', relPath: '' });
  });
});
