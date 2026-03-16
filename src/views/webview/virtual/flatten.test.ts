// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { flattenTree } from './flatten';
import { createState } from '../state';
import type { DirNode, FileNode, FileTypeStats, WebviewState, SearchMatch } from '../types';
import type { FlatRow, FlattenResult } from './types';
import {
  ROW_HEIGHT_DIR, ROW_HEIGHT_FILE, ROW_HEIGHT_TRUNCATED, ROW_HEIGHT_EMPTY_GROUP,
  ROW_HEIGHT_MATCH_LINE, ROW_HEIGHT_MATCH_SPACER,
  ROW_HEIGHT_MORE_MATCHES, ROW_HEIGHT_WORKSPACE_HEADER,
} from './types';

import '../test-helpers';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeDir(name: string, opts: {
  path?: string;
  children?: DirNode[];
  files?: FileNode[];
  stats?: FileTypeStats[];
  totalFiles?: number;
  sizeBytes?: number;
} = {}): DirNode {
  const files = opts.files || [];
  const children = opts.children || [];
  const totalFiles = opts.totalFiles ?? files.length;
  return {
    name,
    path: opts.path ?? name,
    children,
    files,
    stats: opts.stats || [],
    totalFiles,
    sizeBytes: opts.sizeBytes ?? 0,
  };
}

function makeFile(name: string, opts: {
  langName?: string;
  langColor?: string;
  path?: string;
  sizeBytes?: number;
} = {}): FileNode {
  return {
    name,
    path: opts.path ?? '/workspace/' + name,
    langName: opts.langName ?? 'Unknown',
    langColor: opts.langColor ?? '#ccc',
    sizeBytes: opts.sizeBytes ?? 100,
  };
}

function makeState(overrides: Partial<WebviewState> = {}): WebviewState {
  const state = createState();
  Object.assign(state, overrides);
  return state;
}

/** Extract row types from a flatten result for easy assertion. */
function rowTypes(result: FlattenResult): string[] {
  return result.flatRows.map(r => r.type);
}

/** Extract row keys from a flatten result. */
function rowKeys(result: FlattenResult): string[] {
  return result.flatRows.map(r => r.key);
}

/** Extract row depths from a flatten result. */
function rowDepths(result: FlattenResult): number[] {
  return result.flatRows.map(r => r.depth);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('flattenTree — basic structure', () => {
  it('single root with 3 files → 1 DirFlatRow + 3 FileFlatRows', () => {
    const root = makeDir('src', {
      files: [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')],
      totalFiles: 3,
    });
    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'file', 'file', 'file']);
    expect(result.totalVisibleFiles).toBe(3);
  });

  it('nested dirs all expanded → correct depth sequence', () => {
    const inner = makeDir('c', {
      path: 'a/b/c',
      files: [makeFile('f.ts', { path: '/ws/a/b/c/f.ts' })],
      totalFiles: 1,
    });
    const mid = makeDir('b', {
      path: 'a/b',
      children: [inner],
      totalFiles: 1,
    });
    const root = makeDir('a', {
      path: 'a',
      children: [mid],
      totalFiles: 1,
    });

    const state = makeState();
    // Expand all
    state.expanded.set('a', true);
    // a→b→c will be compacted into a single DirFlatRow (single child, no files chain)
    state.expanded.set('a/b/c', true);

    const result = flattenTree(state, [root], { showRootNode: true });

    // a compacts to a/b/c (single child chain)
    expect(rowTypes(result)).toEqual(['dir', 'file']);
    expect(rowDepths(result)).toEqual([0, 1]);
  });

  it('all rows have sequential offsetY matching cumulative heights', () => {
    const root = makeDir('src', {
      files: [makeFile('a.ts'), makeFile('b.ts')],
      totalFiles: 2,
    });
    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(result.flatRows[0].offsetY).toBe(0);
    expect(result.flatRows[1].offsetY).toBe(ROW_HEIGHT_DIR);
    expect(result.flatRows[2].offsetY).toBe(ROW_HEIGHT_DIR + ROW_HEIGHT_FILE);
  });

  it('totalHeight equals sum of all row heights', () => {
    const root = makeDir('src', {
      files: [makeFile('a.ts'), makeFile('b.ts')],
      totalFiles: 2,
    });
    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: true });

    const expectedHeight = ROW_HEIGHT_DIR + 2 * ROW_HEIGHT_FILE;
    expect(result.totalHeight).toBe(expectedHeight);
  });

  it('empty tree → empty FlatRow array', () => {
    const state = makeState();
    const result = flattenTree(state, [], { showRootNode: true });

    expect(result.flatRows).toEqual([]);
    expect(result.totalHeight).toBe(0);
    expect(result.totalVisibleFiles).toBe(0);
  });
});

describe('flattenTree — folder compaction', () => {
  it('single-child chains are compacted into one DirFlatRow', () => {
    const inner = makeDir('c', {
      path: 'a/b/c',
      files: [makeFile('f.ts', { path: '/ws/a/b/c/f.ts' })],
      totalFiles: 1,
    });
    const mid = makeDir('b', {
      path: 'a/b',
      children: [inner],
      totalFiles: 1,
    });
    const root = makeDir('a', {
      path: 'a',
      children: [mid],
      totalFiles: 1,
    });

    const state = makeState();
    state.expanded.set('a/b/c', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    // Compacted: a → b → c becomes one dir row keyed by deepest node
    const dirRow = result.flatRows[0];
    expect(dirRow.type).toBe('dir');
    expect(dirRow.key).toBe('dir:a/b/c');
    if (dirRow.type === 'dir') {
      expect(dirRow.node.path).toBe('a/b/c');
      expect(dirRow.originalNode.path).toBe('a');
    }
  });

  it('compaction broken by files at intermediate level', () => {
    const inner = makeDir('c', {
      path: 'a/b/c',
      files: [makeFile('g.ts', { path: '/ws/a/b/c/g.ts' })],
      totalFiles: 1,
    });
    const mid = makeDir('b', {
      path: 'a/b',
      children: [inner],
      files: [makeFile('f.ts', { path: '/ws/a/b/f.ts' })],
      totalFiles: 2,
    });
    const root = makeDir('a', {
      path: 'a',
      children: [mid],
      totalFiles: 2,
    });

    const state = makeState();
    state.expanded.set('a/b', true);
    state.expanded.set('a/b/c', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    // a compacts to a/b (b has files, breaking the chain)
    const dirRows = result.flatRows.filter(r => r.type === 'dir');
    expect(dirRows.length).toBe(2);
    expect(dirRows[0].key).toBe('dir:a/b');
    expect(dirRows[1].key).toBe('dir:a/b/c');
  });
});

describe('flattenTree — expand/collapse', () => {
  it('collapsed dir → only DirFlatRow emitted, no children', () => {
    const root = makeDir('src', {
      files: [makeFile('a.ts')],
      totalFiles: 1,
      children: [makeDir('sub', { files: [makeFile('b.ts')], totalFiles: 1 })],
    });
    const state = makeState();
    state.expanded.set('src', false);
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir']);
    expect(result.totalVisibleFiles).toBe(0);
  });

  it('expanded dir → children appear after it', () => {
    const root = makeDir('src', {
      files: [makeFile('a.ts')],
      totalFiles: 1,
    });
    const state = makeState();
    state.expanded.set('src', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'file']);
  });

  it('collapse removes children, subsequent siblings shift up', () => {
    const child1 = makeDir('a', { path: 'root/a', files: [makeFile('x.ts', { path: '/ws/a/x.ts' })], totalFiles: 1 });
    const child2 = makeDir('b', { path: 'root/b', files: [makeFile('y.ts', { path: '/ws/b/y.ts' })], totalFiles: 1 });
    const root = makeDir('root', { children: [child1, child2], totalFiles: 2 });

    // Expand root and a, collapse b
    const state = makeState();
    state.expanded.set('root', true);
    state.expanded.set('root/a', true);
    state.expanded.set('root/b', false);
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'dir', 'file', 'dir']);
    // b's dir row should be at offset = dir(root) + dir(a) + file(x)
    const bRow = result.flatRows[3];
    expect(bRow.offsetY).toBe(ROW_HEIGHT_DIR * 2 + ROW_HEIGHT_FILE);
  });

  it('root dirs auto-expand at depth 0', () => {
    const root = makeDir('src', {
      files: [makeFile('a.ts')],
      totalFiles: 1,
    });
    const state = makeState();
    // Don't set expanded explicitly — should auto-expand at depth 0
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'file']);
    expect(result.flatRows[0].type === 'dir' && result.flatRows[0].isExpanded).toBe(true);
  });
});

describe('flattenTree — truncation', () => {
  it('dir with 10 files, threshold 3 → 3 FileFlatRows + 1 TruncatedFlatRow', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.ts`, { path: `/ws/f${i}.ts` }));
    // Need at least one child dir so it's not a single-dir root
    const child = makeDir('sub', { path: 'src/sub', totalFiles: 0 });
    const root = makeDir('src', { files, totalFiles: 10, children: [child] });

    const state = makeState({ truncateThreshold: 3 });
    state.expanded.set('src', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    const truncRows = result.flatRows.filter(r => r.type === 'truncated');
    expect(fileRows.length).toBe(3);
    expect(truncRows.length).toBe(1);
    if (truncRows[0].type === 'truncated') {
      expect(truncRows[0].hiddenFiles.length).toBe(7);
    }
  });

  it('truncationExpanded set → all files shown, no TruncatedFlatRow', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.ts`, { path: `/ws/f${i}.ts` }));
    const child = makeDir('sub', { path: 'src/sub', totalFiles: 0 });
    const root = makeDir('src', { files, totalFiles: 10, children: [child] });

    const state = makeState({ truncateThreshold: 3 });
    state.expanded.set('src', true);
    state.truncationExpanded.add('src');
    const result = flattenTree(state, [root], { showRootNode: true });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    const truncRows = result.flatRows.filter(r => r.type === 'truncated');
    expect(fileRows.length).toBe(10);
    expect(truncRows.length).toBe(0);
  });

  it('truncation disabled when filter active', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.ts`, { path: `/ws/f${i}.ts`, langName: 'TypeScript' }));
    const child = makeDir('sub', { path: 'src/sub', totalFiles: 0 });
    const root = makeDir('src', { files, totalFiles: 10, children: [child] });

    const state = makeState({ truncateThreshold: 3 });
    state.activeFilters.add('TypeScript');
    state.expanded.set('src', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const truncRows = result.flatRows.filter(r => r.type === 'truncated');
    expect(truncRows.length).toBe(0);
  });

  it('truncation disabled for single-dir roots (no subdirectories)', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.ts`, { path: `/ws/f${i}.ts` }));
    // No children → single-dir root
    const root = makeDir('src', { files, totalFiles: 10 });

    const state = makeState({ truncateThreshold: 3 });
    state.expanded.set('src', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const truncRows = result.flatRows.filter(r => r.type === 'truncated');
    expect(truncRows.length).toBe(0);
    const fileRows = result.flatRows.filter(r => r.type === 'file');
    expect(fileRows.length).toBe(10);
  });
});

describe('flattenTree — empty dir grouping', () => {
  it('3 consecutive empty dirs → 1 EmptyGroupFlatRow', () => {
    const empties = [
      makeDir('e1', { path: 'root/e1', totalFiles: 0 }),
      makeDir('e2', { path: 'root/e2', totalFiles: 0 }),
      makeDir('e3', { path: 'root/e3', totalFiles: 0 }),
    ];
    const root = makeDir('root', { children: empties, totalFiles: 0 });

    const state = makeState();
    state.expanded.set('root', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const emptyGroupRows = result.flatRows.filter(r => r.type === 'emptyGroup');
    expect(emptyGroupRows.length).toBe(1);
    if (emptyGroupRows[0].type === 'emptyGroup') {
      expect(emptyGroupRows[0].nodes.length).toBe(3);
    }
  });

  it('single empty dir among non-empty → no grouping (normal DirFlatRow)', () => {
    const children = [
      makeDir('e1', { path: 'root/e1', totalFiles: 0 }),
      makeDir('full', { path: 'root/full', files: [makeFile('a.ts')], totalFiles: 1 }),
    ];
    const root = makeDir('root', { children, totalFiles: 1 });

    const state = makeState();
    state.expanded.set('root', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const emptyGroupRows = result.flatRows.filter(r => r.type === 'emptyGroup');
    expect(emptyGroupRows.length).toBe(0);
    // Both should be normal dir rows
    const dirRows = result.flatRows.filter(r => r.type === 'dir');
    expect(dirRows.length).toBe(3); // root + e1 + full
  });

  it('emptyGroupExpanded set → individual DirFlatRows', () => {
    const empties = [
      makeDir('e1', { path: 'root/e1', totalFiles: 0 }),
      makeDir('e2', { path: 'root/e2', totalFiles: 0 }),
      makeDir('e3', { path: 'root/e3', totalFiles: 0 }),
    ];
    const root = makeDir('root', { children: empties, totalFiles: 0 });

    const state = makeState();
    state.expanded.set('root', true);
    state.emptyGroupExpanded.add('root/e1');
    const result = flattenTree(state, [root], { showRootNode: true });

    const emptyGroupRows = result.flatRows.filter(r => r.type === 'emptyGroup');
    expect(emptyGroupRows.length).toBe(0);
    // root + 3 individual empty dirs
    const dirRows = result.flatRows.filter(r => r.type === 'dir');
    expect(dirRows.length).toBe(4);
  });

  it('empty group suppressed when filter active', () => {
    const empties = [
      makeDir('e1', { path: 'root/e1', totalFiles: 0 }),
      makeDir('e2', { path: 'root/e2', totalFiles: 0 }),
    ];
    const nonEmpty = makeDir('full', {
      path: 'root/full',
      files: [makeFile('a.ts', { langName: 'TypeScript' })],
      totalFiles: 1,
    });
    const root = makeDir('root', {
      children: [...empties, nonEmpty],
      totalFiles: 1,
    });

    const state = makeState();
    state.activeFilters.add('TypeScript');
    const result = flattenTree(state, [root], { showRootNode: true });

    const emptyGroupRows = result.flatRows.filter(r => r.type === 'emptyGroup');
    expect(emptyGroupRows.length).toBe(0);
  });
});

describe('flattenTree — sort modes', () => {
  it('files sort → dirs ordered by total file count descending', () => {
    const children = [
      makeDir('few', { path: 'root/few', totalFiles: 2 }),
      makeDir('many', { path: 'root/many', totalFiles: 10 }),
      makeDir('some', { path: 'root/some', totalFiles: 5 }),
    ];
    const root = makeDir('root', { children, totalFiles: 17 });

    const state = makeState({ currentSortMode: 'files' });
    state.expanded.set('root', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const dirRows = result.flatRows.filter(r => r.type === 'dir' && r.depth === 1);
    expect(dirRows.map(r => r.key)).toEqual(['dir:root/many', 'dir:root/some', 'dir:root/few']);
  });

  it('name sort → dirs ordered alphabetically', () => {
    const children = [
      makeDir('cherry', { path: 'root/cherry', totalFiles: 1 }),
      makeDir('apple', { path: 'root/apple', totalFiles: 1 }),
      makeDir('banana', { path: 'root/banana', totalFiles: 1 }),
    ];
    const root = makeDir('root', { children, totalFiles: 3 });

    const state = makeState({ currentSortMode: 'name' });
    state.expanded.set('root', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const dirRows = result.flatRows.filter(r => r.type === 'dir' && r.depth === 1);
    expect(dirRows.map(r => r.key)).toEqual(['dir:root/apple', 'dir:root/banana', 'dir:root/cherry']);
  });

  it('size sort → dirs ordered by byte size descending', () => {
    const children = [
      makeDir('small', { path: 'root/small', totalFiles: 1, sizeBytes: 100 }),
      makeDir('large', { path: 'root/large', totalFiles: 1, sizeBytes: 10000 }),
      makeDir('medium', { path: 'root/medium', totalFiles: 1, sizeBytes: 1000 }),
    ];
    const root = makeDir('root', { children, totalFiles: 3 });

    const state = makeState({ currentSortMode: 'size' });
    state.expanded.set('root', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const dirRows = result.flatRows.filter(r => r.type === 'dir' && r.depth === 1);
    expect(dirRows.map(r => r.key)).toEqual(['dir:root/large', 'dir:root/medium', 'dir:root/small']);
  });

  it('files within a dir always sorted alphabetically regardless of mode', () => {
    const files = [
      makeFile('c.ts', { path: '/ws/c.ts', sizeBytes: 100 }),
      makeFile('a.ts', { path: '/ws/a.ts', sizeBytes: 300 }),
      makeFile('b.ts', { path: '/ws/b.ts', sizeBytes: 200 }),
    ];
    const root = makeDir('src', { files, totalFiles: 3 });

    const state = makeState({ currentSortMode: 'size' });
    state.expanded.set('src', true);
    const result = flattenTree(state, [root], { showRootNode: true });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    expect(fileRows.map(r => r.type === 'file' ? r.file.name : '')).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('flattenTree — filters', () => {
  it('language filter active → only matching files/dirs in output', () => {
    const tsFile = makeFile('app.ts', { path: '/ws/app.ts', langName: 'TypeScript' });
    const jsFile = makeFile('util.js', { path: '/ws/util.js', langName: 'JavaScript' });
    const root = makeDir('src', {
      files: [tsFile, jsFile],
      totalFiles: 2,
    });

    const state = makeState();
    state.activeFilters.add('TypeScript');
    const result = flattenTree(state, [root], { showRootNode: true });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    expect(fileRows.length).toBe(1);
    expect(fileRows[0].type === 'file' && fileRows[0].file.name).toBe('app.ts');
  });

  it('search results active → only matching files in output', () => {
    const matchFile = makeFile('found.ts', { path: '/ws/found.ts' });
    const noMatchFile = makeFile('other.ts', { path: '/ws/other.ts' });
    const root = makeDir('src', {
      files: [matchFile, noMatchFile],
      totalFiles: 2,
    });

    const state = makeState();
    state.searchResults = new Map([['/ws/found.ts', [{ line: 1, column: 0, matchLength: 5, lineText: 'hello' }]]]);
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    expect(fileRows.length).toBe(1);
    expect(fileRows[0].type === 'file' && fileRows[0].file.name).toBe('found.ts');
  });

  it('filter active → all dirs auto-expanded (no expand state check needed)', () => {
    const inner = makeDir('deep', {
      path: 'src/sub/deep',
      files: [makeFile('f.ts', { path: '/ws/f.ts', langName: 'TypeScript' })],
      totalFiles: 1,
    });
    const mid = makeDir('sub', { path: 'src/sub', children: [inner], totalFiles: 1 });
    const root = makeDir('src', { children: [mid], totalFiles: 1 });

    const state = makeState();
    state.activeFilters.add('TypeScript');
    // Don't set any expanded state — filter should auto-expand
    const result = flattenTree(state, [root], { showRootNode: true });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    expect(fileRows.length).toBe(1);
  });

  it('filter active → no truncation', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      makeFile(`f${i}.ts`, { path: `/ws/f${i}.ts`, langName: 'TypeScript' }));
    const child = makeDir('sub', { path: 'src/sub', totalFiles: 0 });
    const root = makeDir('src', { files, totalFiles: 10, children: [child] });

    const state = makeState({ truncateThreshold: 3 });
    state.activeFilters.add('TypeScript');
    const result = flattenTree(state, [root], { showRootNode: true });

    const truncRows = result.flatRows.filter(r => r.type === 'truncated');
    expect(truncRows.length).toBe(0);
  });

  it('search results filter active → only matching files', () => {
    const tsFile = makeFile('app.ts', { path: '/ws/app.ts' });
    const mdFile = makeFile('readme.md', { path: '/ws/readme.md' });
    const root = makeDir('src', { files: [tsFile, mdFile], totalFiles: 2 });

    const state = makeState();
    state.searchResults = new Map([['/ws/app.ts', []]]) as any;
    state.searchAncestorPaths = new Set(['src', '']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    expect(fileRows.length).toBe(1);
    expect(fileRows[0].type === 'file' && fileRows[0].file.name).toBe('app.ts');
  });
});

describe('flattenTree — multi-root workspace', () => {
  it('2 workspace roots → WorkspaceHeaderFlatRow before each root (sidebar mode)', () => {
    const root1 = makeDir('project-a', {
      files: [makeFile('a.ts', { path: '/ws/a/a.ts' })],
      totalFiles: 1,
    });
    const root2 = makeDir('project-b', {
      files: [makeFile('b.ts', { path: '/ws/b/b.ts' })],
      totalFiles: 1,
    });

    const state = makeState();
    const result = flattenTree(state, [root1, root2], { showRootNode: false });

    const headerRows = result.flatRows.filter(r => r.type === 'workspaceHeader');
    expect(headerRows.length).toBe(2);
    expect(headerRows[0].type === 'workspaceHeader' && headerRows[0].name).toBe('project-a');
    expect(headerRows[1].type === 'workspaceHeader' && headerRows[1].name).toBe('project-b');
  });

  it('single root → no WorkspaceHeaderFlatRow (sidebar mode)', () => {
    const root = makeDir('project', {
      files: [makeFile('a.ts', { path: '/ws/a.ts' })],
      totalFiles: 1,
    });

    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: false });

    const headerRows = result.flatRows.filter(r => r.type === 'workspaceHeader');
    expect(headerRows.length).toBe(0);
  });

  it('showRootNode: true (tab) → each root is a DirFlatRow at depth 0', () => {
    const root1 = makeDir('project-a', { totalFiles: 0 });
    const root2 = makeDir('project-b', { totalFiles: 0 });

    const state = makeState();
    const result = flattenTree(state, [root1, root2], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'dir']);
    expect(rowDepths(result)).toEqual([0, 0]);
  });
});

describe('flattenTree — showRootNode modes', () => {
  it('showRootNode false (sidebar) → roots children at depth 0', () => {
    const child1 = makeDir('sub1', { path: 'root/sub1', totalFiles: 1, files: [makeFile('a.ts', { path: '/ws/sub1/a.ts' })] });
    const child2 = makeDir('sub2', { path: 'root/sub2', totalFiles: 1, files: [makeFile('b.ts', { path: '/ws/sub2/b.ts' })] });
    const root = makeDir('root', { children: [child1, child2], totalFiles: 2 });

    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: false });

    // No root dir row, children are at depth 0
    const dirRows = result.flatRows.filter(r => r.type === 'dir');
    expect(dirRows.length).toBe(2);
    expect(dirRows[0].depth).toBe(0);
    expect(dirRows[1].depth).toBe(0);
  });

  it('showRootNode true (tab) → root is a DirFlatRow, children at depth 1', () => {
    const child = makeDir('sub', { path: 'root/sub', totalFiles: 0 });
    const root = makeDir('root', { children: [child], totalFiles: 0 });

    const state = makeState();
    state.expanded.set('root', true);
    // sub is compacted into root since it's a single child with no files
    // Actually root→sub: root has 1 child (sub) and 0 files → compacts to sub
    const result = flattenTree(state, [root], { showRootNode: true });

    // root compacts to root/sub
    expect(result.flatRows[0].type).toBe('dir');
    expect(result.flatRows[0].depth).toBe(0);
  });
});

describe('flattenTree — offsetY correctness', () => {
  it('first row has offsetY 0', () => {
    const root = makeDir('src', { totalFiles: 0 });
    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(result.flatRows[0].offsetY).toBe(0);
  });

  it('each row offsetY = previous offsetY + previous height', () => {
    const root = makeDir('src', {
      files: [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')],
      totalFiles: 3,
    });
    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: true });

    for (let i = 1; i < result.flatRows.length; i++) {
      const prev = result.flatRows[i - 1];
      expect(result.flatRows[i].offsetY).toBe(prev.offsetY + prev.height);
    }
  });

  it('mixed row types (dir, file, matchGroup) → correct cumulative offsets', () => {
    const file = makeFile('found.ts', { path: '/ws/found.ts' });
    const root = makeDir('src', { files: [file], totalFiles: 1 });

    const state = makeState();
    state.expanded.set('src', true);
    state.searchResults = new Map([['/ws/found.ts', [
      { line: 1, column: 0, matchLength: 3, lineText: 'foo bar' },
      { line: 10, column: 0, matchLength: 3, lineText: 'baz qux' },
    ]]]);
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    // dir(22) + file(22) + matchGroup1(18) + matchGroup2(18+6 spacer)
    let expectedOffset = 0;
    for (const row of result.flatRows) {
      expect(row.offsetY).toBe(expectedOffset);
      expectedOffset += row.height;
    }
    expect(result.totalHeight).toBe(expectedOffset);
  });

  it('totalHeight matches last row offsetY + last row height', () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`f${i}.ts`, { path: `/ws/f${i}.ts` }));
    const root = makeDir('src', { files, totalFiles: 5 });
    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: true });

    const last = result.flatRows[result.flatRows.length - 1];
    expect(result.totalHeight).toBe(last.offsetY + last.height);
  });
});

describe('flattenTree — search matches', () => {
  it('file with search results → MatchGroupFlatRow after FileFlatRow', () => {
    const file = makeFile('app.ts', { path: '/ws/app.ts' });
    const root = makeDir('src', { files: [file], totalFiles: 1 });

    const state = makeState();
    state.expanded.set('src', true);
    state.searchResults = new Map([['/ws/app.ts', [
      { line: 5, column: 0, matchLength: 3, lineText: 'const foo = 1;' },
    ]]]);
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'file', 'matchGroup']);
  });

  it('matchesCollapsed set → no match rows', () => {
    const file = makeFile('app.ts', { path: '/ws/app.ts' });
    const root = makeDir('src', { files: [file], totalFiles: 1 });

    const state = makeState();
    state.expanded.set('src', true);
    state.searchResults = new Map([['/ws/app.ts', [
      { line: 5, column: 0, matchLength: 3, lineText: 'const foo = 1;' },
    ]]]);
    state.matchesCollapsed.add('/ws/app.ts');
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    const matchRows = result.flatRows.filter(r => r.type === 'matchGroup');
    expect(matchRows.length).toBe(0);
  });

  it('match with context lines → single MatchGroupFlatRow with correct height', () => {
    const file = makeFile('app.ts', { path: '/ws/app.ts' });
    const root = makeDir('src', { files: [file], totalFiles: 1 });

    const state = makeState();
    state.expanded.set('src', true);
    state.searchResults = new Map([['/ws/app.ts', [
      { line: 4, column: 0, matchLength: 0, lineText: 'let x = 1;', isContext: true },
      { line: 5, column: 0, matchLength: 3, lineText: 'const foo = 1;' },
      { line: 6, column: 0, matchLength: 0, lineText: 'let y = 2;', isContext: true },
    ]]]);
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'file', 'matchGroup']);
    const mg = result.flatRows[2];
    expect(mg.type).toBe('matchGroup');
    // 1 context before + 1 match + 1 context after = 3 lines * 18px = 54px
    expect(mg.height).toBe(3 * ROW_HEIGHT_MATCH_LINE);
  });

  it('gap between non-contiguous match groups → two MatchGroupFlatRows, second has hasGap', () => {
    const file = makeFile('app.ts', { path: '/ws/app.ts' });
    const root = makeDir('src', { files: [file], totalFiles: 1 });

    const state = makeState();
    state.expanded.set('src', true);
    state.searchResults = new Map([['/ws/app.ts', [
      { line: 1, column: 0, matchLength: 3, lineText: 'line one' },
      { line: 50, column: 0, matchLength: 3, lineText: 'line fifty' },
    ]]]);
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    expect(rowTypes(result)).toEqual(['dir', 'file', 'matchGroup', 'matchGroup']);
    const mg1 = result.flatRows[2];
    const mg2 = result.flatRows[3];
    if (mg1.type === 'matchGroup' && mg2.type === 'matchGroup') {
      expect(mg1.hasGap).toBe(false);
      expect(mg2.hasGap).toBe(true);
      // Second group height includes spacer: 1 match line (18) + spacer (6) = 24
      expect(mg2.height).toBe(ROW_HEIGHT_MATCH_LINE + ROW_HEIGHT_MATCH_SPACER);
    }
  });

  it('match truncation (> threshold groups) → MoreMatchesFlatRow', () => {
    const file = makeFile('app.ts', { path: '/ws/app.ts' });
    const root = makeDir('src', { files: [file], totalFiles: 1 });

    const matches: SearchMatch[] = [];
    for (let i = 0; i < 10; i++) {
      matches.push({ line: i * 100 + 1, column: 0, matchLength: 3, lineText: `match ${i}` });
    }

    const state = makeState({ truncateThreshold: 3 });
    state.expanded.set('src', true);
    state.searchResults = new Map([['/ws/app.ts', matches]]);
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    const moreRows = result.flatRows.filter(r => r.type === 'moreMatches');
    expect(moreRows.length).toBe(1);
    if (moreRows[0].type === 'moreMatches') {
      expect(moreRows[0].count).toBe(7);
    }
  });

  it('match dedent computed correctly', () => {
    const file = makeFile('app.ts', { path: '/ws/app.ts' });
    const root = makeDir('src', { files: [file], totalFiles: 1 });

    const state = makeState();
    state.expanded.set('src', true);
    state.searchResults = new Map([['/ws/app.ts', [
      { line: 5, column: 4, matchLength: 3, lineText: '    const foo = 1;' },
      { line: 6, column: 6, matchLength: 3, lineText: '      bar();', isContext: true },
    ]]]);
    state.searchAncestorPaths = new Set(['src']);
    state.searchResultsVersion = 1;
    const result = flattenTree(state, [root], { showRootNode: true });

    const matchRow = result.flatRows.find(r => r.type === 'matchGroup');
    expect(matchRow).toBeDefined();
    if (matchRow && matchRow.type === 'matchGroup') {
      expect(matchRow.dedent).toBe(4);
    }
  });
});

describe('flattenTree — workspace header heights', () => {
  it('workspace headers have correct height (30px)', () => {
    const root1 = makeDir('a', { files: [makeFile('x.ts', { path: '/ws/a/x.ts' })], totalFiles: 1 });
    const root2 = makeDir('b', { files: [makeFile('y.ts', { path: '/ws/b/y.ts' })], totalFiles: 1 });

    const state = makeState();
    const result = flattenTree(state, [root1, root2], { showRootNode: false });

    const headers = result.flatRows.filter(r => r.type === 'workspaceHeader');
    expect(headers.length).toBe(2);
    expect(headers[0].height).toBe(ROW_HEIGHT_WORKSPACE_HEADER);
    expect(headers[0].height).toBe(30);
  });
});

describe('flattenTree — sidebar mode root-level files', () => {
  it('sidebar mode renders root-level files at depth 0', () => {
    const root = makeDir('project', {
      files: [makeFile('readme.md', { path: '/ws/readme.md' })],
      totalFiles: 1,
    });

    const state = makeState();
    const result = flattenTree(state, [root], { showRootNode: false });

    const fileRows = result.flatRows.filter(r => r.type === 'file');
    expect(fileRows.length).toBe(1);
    expect(fileRows[0].depth).toBe(0);
  });
});
