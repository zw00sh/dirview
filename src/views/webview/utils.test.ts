// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  escHtml, formatBytes, sortDirs, sortFiles, computeMaxMetric, groupEmptyDirs,
  computeStats, buildAncestorPaths, emptyState,
} from './index';

import './test-helpers';

// --- escHtml ---
describe('escHtml', () => {
  it('escapes &', () => expect(escHtml('a&b')).toBe('a&amp;b'));
  it('escapes <', () => expect(escHtml('a<b')).toBe('a&lt;b'));
  it('escapes >', () => expect(escHtml('a>b')).toBe('a&gt;b'));
  it('escapes "', () => expect(escHtml('a"b')).toBe('a&quot;b'));
  it('leaves plain strings unchanged', () => expect(escHtml('hello')).toBe('hello'));
  it('escapes all entities in one string', () => {
    expect(escHtml('<script src="x.js">alert(1)&done</script>'))
      .toBe('&lt;script src=&quot;x.js&quot;&gt;alert(1)&amp;done&lt;/script&gt;');
  });
});

// --- formatBytes ---
describe('formatBytes', () => {
  it('returns "0 B" for 0', () => expect(formatBytes(0)).toBe('0 B'));
  it('returns bytes for < 1024', () => expect(formatBytes(512)).toBe('512 B'));
  it('returns KB for 1024', () => expect(formatBytes(1024)).toBe('1 KB'));
  it('returns KB for values in KB range', () => expect(formatBytes(1536)).toBe('2 KB'));
  it('returns MB for 1024*1024', () => expect(formatBytes(1024 * 1024)).toBe('1 MB'));
  it('returns MB for values in MB range', () => expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB'));
});

// --- sortDirs ---
describe('sortDirs', () => {
  const dirs = [
    { name: 'b', totalFiles: 5, sizeBytes: 200 },
    { name: 'a', totalFiles: 10, sizeBytes: 100 },
    { name: 'c', totalFiles: 1, sizeBytes: 300 },
  ];

  it('sorts by file count desc in "files" mode', () => {
    const result = sortDirs(dirs, 'files');
    expect(result.map(d => d.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts alphabetically in "name" mode', () => {
    const result = sortDirs(dirs, 'name');
    expect(result.map(d => d.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by size desc in "size" mode', () => {
    const result = sortDirs(dirs, 'size');
    expect(result.map(d => d.name)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate input', () => {
    const original = [...dirs];
    sortDirs(dirs, 'files');
    expect(dirs).toEqual(original);
  });
});

// --- sortFiles ---
describe('sortFiles', () => {
  const files = [
    { name: 'zebra.ts' },
    { name: 'alpha.ts' },
    { name: 'Middle.ts' },
  ];

  it('sorts alphabetically', () => {
    const result = sortFiles(files);
    expect(result.map(f => f.name)).toEqual(['alpha.ts', 'Middle.ts', 'zebra.ts']);
  });

  it('does not mutate input', () => {
    const original = [...files];
    sortFiles(files);
    expect(files).toEqual(original);
  });
});

// --- computeMaxMetric ---
describe('computeMaxMetric', () => {
  function makeNode(totalFiles: number, sizeBytes: number, children: any[] = []) {
    return { totalFiles, sizeBytes, children };
  }

  it('returns max totalFiles among non-root nodes', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(60, 600, []),
        makeNode(40, 400, []),
      ]),
    ];
    expect(computeMaxMetric(roots, 'files', false)).toBe(60);
  });

  it('returns max sizeBytes in size mode', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(60, 600, []),
        makeNode(40, 900, []),
      ]),
    ];
    expect(computeMaxMetric(roots, 'size', false)).toBe(900);
  });

  it('walks nested children', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(50, 500, [
          makeNode(30, 300, []),
          makeNode(20, 200, []),
        ]),
      ]),
    ];
    expect(computeMaxMetric(roots, 'files', false)).toBe(50);
  });

  it('returns 1 when all children have 0 files', () => {
    const roots = [makeNode(0, 0, [makeNode(0, 0, [])])];
    expect(computeMaxMetric(roots, 'files', false)).toBe(1);
  });

  it('skips root nodes (they are always 100%)', () => {
    const roots = [makeNode(999, 99999, [makeNode(10, 100, [])])];
    expect(computeMaxMetric(roots, 'files', false)).toBe(10);
  });

  it('returns cached value for same roots/sortMode reference', () => {
    const roots = [makeNode(50, 500, [makeNode(20, 200, [])])];
    const first = computeMaxMetric(roots, 'files', false);
    // Mutate a child — if caching works, result won't change
    roots[0].children[0].totalFiles = 999;
    const second = computeMaxMetric(roots, 'files', false);
    expect(second).toBe(first);
  });
});

// --- groupEmptyDirs ---
describe('groupEmptyDirs', () => {
  function dir(name: string, totalFiles: number) { return { name, totalFiles, children: [] }; }

  it('passes through non-empty dirs unchanged', () => {
    const input = [dir('a', 5), dir('b', 3)];
    const result = groupEmptyDirs(input);
    expect(result).toEqual([
      { type: 'dir', node: input[0] },
      { type: 'dir', node: input[1] },
    ]);
  });

  it('groups 2+ consecutive empty dirs', () => {
    const input = [dir('a', 0), dir('b', 0), dir('c', 5)];
    const result = groupEmptyDirs(input);
    expect(result[0].type).toBe('emptyGroup');
    expect(result[0].nodes).toHaveLength(2);
    expect(result[1]).toEqual({ type: 'dir', node: input[2] });
  });

  it('does not group a single empty dir', () => {
    const input = [dir('a', 0), dir('b', 5)];
    const result = groupEmptyDirs(input);
    expect(result[0]).toEqual({ type: 'dir', node: input[0] });
    expect(result[1]).toEqual({ type: 'dir', node: input[1] });
  });

  it('handles all empty dirs', () => {
    const input = [dir('a', 0), dir('b', 0), dir('c', 0)];
    const result = groupEmptyDirs(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('emptyGroup');
    expect(result[0].nodes).toHaveLength(3);
  });

  it('handles empty input', () => {
    expect(groupEmptyDirs([])).toEqual([]);
  });
});

// --- computeStats ---
describe('computeStats', () => {
  function makeRoot(stats: any[], totalFiles: number) { return { stats, totalFiles }; }

  it('aggregates counts across roots', () => {
    const roots = [
      makeRoot([{ name: 'TypeScript', color: '#3178c6', count: 10 }], 10),
      makeRoot([{ name: 'TypeScript', color: '#3178c6', count: 5 }, { name: 'CSS', color: '#563d7c', count: 3 }], 8),
    ];
    const result = computeStats(roots);
    const ts = result.find(r => r.name === 'TypeScript');
    expect(ts.count).toBe(15);
    const css = result.find(r => r.name === 'CSS');
    expect(css.count).toBe(3);
  });

  it('sorts by count descending', () => {
    const roots = [
      makeRoot([
        { name: 'A', color: '#aaa', count: 3 },
        { name: 'B', color: '#bbb', count: 10 },
      ], 13),
    ];
    const result = computeStats(roots);
    expect(result[0].name).toBe('B');
    expect(result[1].name).toBe('A');
  });

  it('computes percentage strings', () => {
    const roots = [makeRoot([{ name: 'JS', color: '#f1e05a', count: 1 }], 2)];
    const result = computeStats(roots);
    expect(result[0].pct).toBe('50.0');
  });

  it('handles empty roots', () => {
    expect(computeStats([])).toEqual([]);
  });
});

// --- buildAncestorPaths ---
describe('buildAncestorPaths', () => {
  it('produces workspace-relative ancestors from absolute Unix paths', () => {
    const result = buildAncestorPaths(['/ws/src/lib/foo.ts'], ['/ws']);
    expect(result).toEqual(new Set(['', 'src', 'src/lib']));
  });

  it('produces workspace-relative ancestors from absolute Windows paths', () => {
    const result = buildAncestorPaths(['C:\\ws\\src\\lib\\foo.ts'], ['C:\\ws']);
    expect(result).toEqual(new Set(['', 'src', 'src/lib']));
  });

  it('handles mixed separators in Windows paths', () => {
    const result = buildAncestorPaths(['C:\\ws/src\\lib/foo.ts'], ['C:\\ws']);
    expect(result).toEqual(new Set(['', 'src', 'src/lib']));
  });

  it('produces absolute ancestors when no rootPaths given', () => {
    const result = buildAncestorPaths(['/ws/src/foo.ts']);
    expect(result).toEqual(new Set(['', '/ws', '/ws/src']));
  });

  it('deduplicates ancestors across multiple files', () => {
    const result = buildAncestorPaths(['/ws/src/a.ts', '/ws/src/lib/b.ts'], ['/ws']);
    expect(result).toEqual(new Set(['', 'src', 'src/lib']));
  });

  it('includes root for file directly in workspace root', () => {
    const result = buildAncestorPaths(['/ws/api.ts'], ['/ws']);
    expect(result).toEqual(new Set(['']));
  });

  it('returns empty set when no files are provided', () => {
    const result = buildAncestorPaths([], ['/ws']);
    expect(result).toEqual(new Set());
  });
});
