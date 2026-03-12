// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

let S; // DirviewShared

beforeAll(() => {
  const code = readFileSync(join(__dirname, 'shared.js'), 'utf-8');
  // Execute the IIFE which sets window.DirviewShared
  // eslint-disable-next-line no-new-func
  Function(code)();
  S = window.DirviewShared;
});

// --- escHtml ---
describe('escHtml', () => {
  it('escapes &', () => expect(S.escHtml('a&b')).toBe('a&amp;b'));
  it('escapes <', () => expect(S.escHtml('a<b')).toBe('a&lt;b'));
  it('escapes >', () => expect(S.escHtml('a>b')).toBe('a&gt;b'));
  it('escapes "', () => expect(S.escHtml('a"b')).toBe('a&quot;b'));
  it('leaves plain strings unchanged', () => expect(S.escHtml('hello')).toBe('hello'));
  it('escapes all entities in one string', () => {
    expect(S.escHtml('<script src="x.js">alert(1)&done</script>'))
      .toBe('&lt;script src=&quot;x.js&quot;&gt;alert(1)&amp;done&lt;/script&gt;');
  });
});

// --- formatBytes ---
describe('formatBytes', () => {
  it('returns "0 B" for 0', () => expect(S.formatBytes(0)).toBe('0 B'));
  it('returns bytes for < 1024', () => expect(S.formatBytes(512)).toBe('512 B'));
  it('returns KB for 1024', () => expect(S.formatBytes(1024)).toBe('1 KB'));
  it('returns KB for values in KB range', () => expect(S.formatBytes(1536)).toBe('2 KB'));
  it('returns MB for 1024*1024', () => expect(S.formatBytes(1024 * 1024)).toBe('1 MB'));
  it('returns MB for values in MB range', () => expect(S.formatBytes(2 * 1024 * 1024)).toBe('2 MB'));
});

// --- sortDirs ---
describe('sortDirs', () => {
  const dirs = [
    { name: 'b', totalFiles: 5, sizeBytes: 200 },
    { name: 'a', totalFiles: 10, sizeBytes: 100 },
    { name: 'c', totalFiles: 1, sizeBytes: 300 },
  ];

  it('sorts by file count desc in "files" mode', () => {
    const result = S.sortDirs(dirs, 'files');
    expect(result.map(d => d.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts alphabetically in "name" mode', () => {
    const result = S.sortDirs(dirs, 'name');
    expect(result.map(d => d.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by size desc in "size" mode', () => {
    const result = S.sortDirs(dirs, 'size');
    expect(result.map(d => d.name)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate input', () => {
    const original = [...dirs];
    S.sortDirs(dirs, 'files');
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
    const result = S.sortFiles(files, 'files');
    expect(result.map(f => f.name)).toEqual(['alpha.ts', 'Middle.ts', 'zebra.ts']);
  });

  it('does not mutate input', () => {
    const original = [...files];
    S.sortFiles(files, 'files');
    expect(files).toEqual(original);
  });
});

// --- computeMaxMetric ---
describe('computeMaxMetric', () => {
  function makeNode(totalFiles, sizeBytes, children = []) {
    return { totalFiles, sizeBytes, children };
  }

  it('returns max totalFiles among non-root nodes', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(60, 600, []),
        makeNode(40, 400, []),
      ]),
    ];
    expect(S.computeMaxMetric(roots, 'files')).toBe(60);
  });

  it('returns max sizeBytes in size mode', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(60, 600, []),
        makeNode(40, 900, []),
      ]),
    ];
    expect(S.computeMaxMetric(roots, 'size')).toBe(900);
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
    expect(S.computeMaxMetric(roots, 'files')).toBe(50);
  });

  it('returns 1 when all children have 0 files', () => {
    const roots = [makeNode(0, 0, [makeNode(0, 0, [])])];
    expect(S.computeMaxMetric(roots, 'files')).toBe(1);
  });

  it('skips root nodes (they are always 100%)', () => {
    const roots = [makeNode(999, 99999, [makeNode(10, 100, [])])];
    expect(S.computeMaxMetric(roots, 'files')).toBe(10);
  });

  it('returns cached value for same roots/sortMode reference', () => {
    const roots = [makeNode(50, 500, [makeNode(20, 200, [])])];
    const first = S.computeMaxMetric(roots, 'files');
    // Mutate a child — if caching works, result won't change
    roots[0].children[0].totalFiles = 999;
    const second = S.computeMaxMetric(roots, 'files');
    expect(second).toBe(first);
  });
});

// --- groupEmptyDirs ---
describe('groupEmptyDirs', () => {
  function dir(name, totalFiles) { return { name, totalFiles, children: [] }; }

  it('passes through non-empty dirs unchanged', () => {
    const input = [dir('a', 5), dir('b', 3)];
    const result = S.groupEmptyDirs(input);
    expect(result).toEqual([
      { type: 'dir', node: input[0] },
      { type: 'dir', node: input[1] },
    ]);
  });

  it('groups 2+ consecutive empty dirs', () => {
    const input = [dir('a', 0), dir('b', 0), dir('c', 5)];
    const result = S.groupEmptyDirs(input);
    expect(result[0].type).toBe('emptyGroup');
    expect(result[0].nodes).toHaveLength(2);
    expect(result[1]).toEqual({ type: 'dir', node: input[2] });
  });

  it('does not group a single empty dir', () => {
    const input = [dir('a', 0), dir('b', 5)];
    const result = S.groupEmptyDirs(input);
    expect(result[0]).toEqual({ type: 'dir', node: input[0] });
    expect(result[1]).toEqual({ type: 'dir', node: input[1] });
  });

  it('handles all empty dirs', () => {
    const input = [dir('a', 0), dir('b', 0), dir('c', 0)];
    const result = S.groupEmptyDirs(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('emptyGroup');
    expect(result[0].nodes).toHaveLength(3);
  });

  it('handles empty input', () => {
    expect(S.groupEmptyDirs([])).toEqual([]);
  });
});

// --- computeStats ---
describe('computeStats', () => {
  function makeRoot(stats, totalFiles) { return { stats, totalFiles }; }

  it('aggregates counts across roots', () => {
    const roots = [
      makeRoot([{ name: 'TypeScript', color: '#3178c6', count: 10 }], 10),
      makeRoot([{ name: 'TypeScript', color: '#3178c6', count: 5 }, { name: 'CSS', color: '#563d7c', count: 3 }], 8),
    ];
    const result = S.computeStats(roots);
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
    const result = S.computeStats(roots);
    expect(result[0].name).toBe('B');
    expect(result[1].name).toBe('A');
  });

  it('computes percentage strings', () => {
    const roots = [makeRoot([{ name: 'JS', color: '#f1e05a', count: 1 }], 2)];
    const result = S.computeStats(roots);
    expect(result[0].pct).toBe('50.0');
  });

  it('handles empty roots', () => {
    expect(S.computeStats([])).toEqual([]);
  });
});
