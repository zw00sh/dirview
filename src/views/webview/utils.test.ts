// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  escHtml, formatBytes, formatLines, sortDirs, sortFiles, computeMaxMetric,
  computeStats, buildAncestorPaths, emptyState, skeletonState, skeletonLegendState,
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
    { name: 'b', totalFiles: 5, sizeBytes: 200, totalLines: 50 },
    { name: 'a', totalFiles: 10, sizeBytes: 100, totalLines: 200 },
    { name: 'c', totalFiles: 1, sizeBytes: 300, totalLines: 10 },
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

  it('sorts by totalLines desc in "lines" mode', () => {
    const result = sortDirs(dirs, 'lines');
    expect(result.map(d => d.name)).toEqual(['a', 'b', 'c']);
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

// --- formatLines ---
describe('formatLines', () => {
  it('returns "0" for 0', () => expect(formatLines(0)).toBe('0'));
  it('returns raw number for < 1000', () => expect(formatLines(999)).toBe('999'));
  it('returns K for thousands', () => expect(formatLines(1500)).toBe('2K'));
  it('returns K for exact thousand', () => expect(formatLines(1000)).toBe('1K'));
  it('returns M for millions', () => expect(formatLines(1500000)).toBe('1.5M'));
  it('returns M without .0 for round millions', () => expect(formatLines(2000000)).toBe('2M'));
  it('returns K for 999999', () => expect(formatLines(999999)).toBe('1000K'));
});

// --- computeMaxMetric ---
describe('computeMaxMetric', () => {
  function makeNode(totalFiles: number, sizeBytes: number, children: any[] = [], totalLines = 0) {
    return { totalFiles, sizeBytes, totalLines, children };
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

  it('returns max totalLines in lines mode', () => {
    const roots = [
      makeNode(100, 1000, [
        makeNode(60, 600, [], 3000),
        makeNode(40, 900, [], 5000),
      ], 8000),
    ];
    expect(computeMaxMetric(roots, 'lines', false)).toBe(5000);
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

  it('aggregates sizeBytes and lineCount from stats', () => {
    const roots = [
      makeRoot([
        { name: 'TypeScript', color: '#3178c6', count: 10, sizeBytes: 5000, lineCount: 200 },
        { name: 'CSS', color: '#563d7c', count: 3, sizeBytes: 1000, lineCount: 50 },
      ], 13),
      makeRoot([
        { name: 'TypeScript', color: '#3178c6', count: 5, sizeBytes: 2500, lineCount: 100 },
      ], 5),
    ];
    const result = computeStats(roots);
    const ts = result.find(r => r.name === 'TypeScript');
    expect(ts.sizeBytes).toBe(7500);
    expect(ts.lineCount).toBe(300);
    const css = result.find(r => r.name === 'CSS');
    expect(css.sizeBytes).toBe(1000);
    expect(css.lineCount).toBe(50);
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

  // --- multi-root SearchRoot[] input ---

  it('produces prefixed ancestors in multi-root mode', () => {
    const roots = [
      { fsPath: '/ws/frontend', name: 'frontend' },
      { fsPath: '/ws/backend', name: 'backend' },
    ];
    const result = buildAncestorPaths(
      ['/ws/frontend/src/lib/foo.ts', '/ws/backend/utils/bar.ts'],
      roots,
    );
    expect(result).toEqual(new Set([
      '', 'frontend', 'frontend/src', 'frontend/src/lib',
      'backend', 'backend/utils',
    ]));
  });

  it('single-root SearchRoot input is not prefixed', () => {
    const result = buildAncestorPaths(
      ['/ws/src/lib/foo.ts'],
      [{ fsPath: '/ws', name: 'ws' }],
    );
    expect(result).toEqual(new Set(['', 'src', 'src/lib']));
  });

  it('multi-root with file directly under workspace root', () => {
    const roots = [
      { fsPath: '/ws/frontend', name: 'frontend' },
      { fsPath: '/ws/backend', name: 'backend' },
    ];
    const result = buildAncestorPaths(['/ws/frontend/api.ts'], roots);
    expect(result).toEqual(new Set(['', 'frontend']));
  });

  it('multi-root deduplicates across sibling roots with overlapping subpaths', () => {
    const roots = [
      { fsPath: '/ws/frontend', name: 'frontend' },
      { fsPath: '/ws/backend', name: 'backend' },
    ];
    const result = buildAncestorPaths(
      ['/ws/frontend/src/a.ts', '/ws/backend/src/b.ts'],
      roots,
    );
    expect(result).toEqual(new Set([
      '', 'frontend', 'frontend/src', 'backend', 'backend/src',
    ]));
  });
});

// --- emptyState ---
describe('emptyState', () => {
  it('returns a div with class empty-state', () => {
    const el = emptyState('noWorkspace');
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('empty-state')).toBe(true);
  });

  it('contains icon and text children', () => {
    const el = emptyState('noWorkspace');
    const icon = el.querySelector('.empty-state-icon');
    const text = el.querySelector('.empty-state-text');
    expect(icon).not.toBeNull();
    expect(text).not.toBeNull();
    expect(icon!.querySelector('svg')).not.toBeNull();
    expect(text!.textContent).toBe('No workspace folder open.');
  });

  it('adds scanning class for initializing variant', () => {
    const el = emptyState('initializing');
    expect(el.classList.contains('scanning')).toBe(true);
    expect(el.querySelector('.empty-state-text')!.textContent).toBe('Initializing\u2026');
  });

  it('adds scanning class for scanning variant', () => {
    const el = emptyState('scanning');
    expect(el.classList.contains('scanning')).toBe(true);
    expect(el.querySelector('.empty-state-text')!.textContent).toBe('Scanning workspace\u2026');
  });

  it('adds error class for error variant', () => {
    const el = emptyState('error', 'Something broke');
    expect(el.classList.contains('error')).toBe(true);
    expect(el.querySelector('.empty-state-text')!.textContent).toBe('Error: Something broke');
  });

  it('uses textContent for error message (XSS safe)', () => {
    const el = emptyState('error', '<script>alert(1)</script>');
    const text = el.querySelector('.empty-state-text')!;
    expect(text.textContent).toContain('<script>');
    expect(text.innerHTML).not.toContain('<script>');
  });

  it('noData variant has no extra class', () => {
    const el = emptyState('noData');
    expect(el.className).toBe('empty-state');
    expect(el.querySelector('.empty-state-text')!.textContent).toBe('No data yet.');
  });
});

// --- skeletonState ---
describe('skeletonState', () => {
  it('returns a div with classes empty-state and skeleton', () => {
    const el = skeletonState();
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('empty-state')).toBe(true);
    expect(el.classList.contains('skeleton')).toBe(true);
  });

  it('contains multiple skeleton rows', () => {
    const el = skeletonState();
    const rows = el.querySelectorAll('.skeleton-row');
    expect(rows.length).toBeGreaterThan(5);
  });

  it('each row has a label and bar', () => {
    const el = skeletonState();
    const rows = el.querySelectorAll('.skeleton-row');
    for (const row of rows) {
      expect(row.querySelector('.skeleton-label')).not.toBeNull();
      expect(row.querySelector('.skeleton-bar')).not.toBeNull();
    }
  });

  it('rows have varying indent via paddingLeft', () => {
    const el = skeletonState();
    const rows = el.querySelectorAll('.skeleton-row') as NodeListOf<HTMLElement>;
    const paddings = new Set(Array.from(rows).map(r => r.style.paddingLeft));
    expect(paddings.size).toBeGreaterThan(1);
  });
});

// --- skeletonLegendState ---
describe('skeletonLegendState', () => {
  it('returns a div with classes empty-state, skeleton, and skeleton-legend', () => {
    const el = skeletonLegendState();
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('empty-state')).toBe(true);
    expect(el.classList.contains('skeleton')).toBe(true);
    expect(el.classList.contains('skeleton-legend')).toBe(true);
  });

  it('contains multiple skeleton pills', () => {
    const el = skeletonLegendState();
    const pills = el.querySelectorAll('.skeleton-pill');
    expect(pills.length).toBeGreaterThan(5);
  });

  it('each pill has a swatch and label', () => {
    const el = skeletonLegendState();
    const pills = el.querySelectorAll('.skeleton-pill');
    for (const pill of pills) {
      expect(pill.querySelector('.skeleton-swatch')).not.toBeNull();
      expect(pill.querySelector('.skeleton-pill-label')).not.toBeNull();
    }
  });
});
