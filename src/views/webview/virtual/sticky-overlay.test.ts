// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { computeStuckRows, computePositions, createStickyOverlay } from './sticky-overlay';
import type { StickyNode } from './sticky-overlay';
import type { FlatRow, DirFlatRow } from './types';
import { ROW_HEIGHT_DIR } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function dir(path: string, depth: number, offsetY: number, ancestors: Array<{ path: string }> = []): DirFlatRow {
  return {
    type: 'dir',
    key: 'dir:' + path,
    depth,
    height: ROW_HEIGHT_DIR,
    offsetY,
    ancestors: ancestors as any,
    node: {
      name: path.split('/').pop() || path,
      path,
      stats: [],
      totalFiles: 1,
      sizeBytes: 0,
      files: [],
      children: [],
    },
  } as DirFlatRow;
}

function file(key: string, depth: number, offsetY: number, ancestors: Array<{ path: string }> = []): FlatRow {
  return {
    type: 'file',
    key,
    depth,
    height: ROW_HEIGHT_DIR,
    offsetY,
    ancestors: ancestors as any,
    file: { name: 'f.ts', path: '/ws/f.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
  } as any;
}

/** Generate N file rows starting at offsetY, all with given ancestors. */
function files(n: number, depth: number, startOffset: number, ancestors: Array<{ path: string }>): FlatRow[] {
  return Array.from({ length: n }, (_, i) =>
    file(`file:f${i}`, depth, startOffset + i * ROW_HEIGHT_DIR, ancestors)
  );
}

function stuckKeys(nodes: StickyNode[]): string[] {
  return nodes.map(n => n.row.key);
}

const VP = 600; // default viewport height for tests
const MAX_STICKY_HEIGHT = 7 * ROW_HEIGHT_DIR; // max widget height for anti-flicker safe zone

// ── computeStuckRows ────────────────────────────────────────────────────────

describe('computeStuckRows', () => {
  // ── Fixtures ──

  // A(d0,0) → B(d1,22) → C(d2,44) → 10 files(d3, 66..264)
  const chain = () => {
    const anc = [{ path: 'a' }, { path: 'a/b' }, { path: 'a/b/c' }];
    return [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      dir('a/b/c', 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
      ...files(10, 3, 66, anc),
    ] as FlatRow[];
  };

  // A(d0,0) → B(d1,22) → 3 files(44..88) → C(d1,110) → 3 files(132..176)
  const siblings = () => [
    dir('a', 0, 0),
    dir('a/b', 1, 22, [{ path: 'a' }]),
    ...files(3, 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
    dir('a/c', 1, 110, [{ path: 'a' }]),
    ...files(3, 2, 132, [{ path: 'a' }, { path: 'a/c' }]),
  ] as FlatRow[];

  // ── Basic cases ──

  it('returns empty for empty flatRows', () => {
    expect(computeStuckRows([], 10, VP)).toEqual([]);
  });

  it('returns empty at scrollTop=0', () => {
    expect(computeStuckRows(chain(), 0, VP)).toEqual([]);
  });

  it('returns empty for root-level files with no ancestors', () => {
    const rows = files(5, 0, 0, []);
    expect(computeStuckRows(rows, 10, VP)).toEqual([]);
  });

  // ── Widget-height cascading ──

  it('cascades through consecutive dirs at scrollTop=1', () => {
    // At scrollTop=1: A is partially scrolled. Widget grows as each dir is
    // hidden behind the overlay, cascading through A→B→C.
    expect(stuckKeys(computeStuckRows(chain(), 1, VP))).toEqual([
      'dir:a', 'dir:a/b', 'dir:a/b/c',
    ]);
  });

  it('cascades through all dirs at scrollTop=23', () => {
    // A fully scrolled, B partially scrolled → widget-height recalculation
    // catches B and then C behind the growing widget.
    expect(stuckKeys(computeStuckRows(chain(), 23, VP))).toEqual([
      'dir:a', 'dir:a/b', 'dir:a/b/c',
    ]);
  });

  it('sticks all ancestors when scrolled to files', () => {
    // scrollTop=100: deep in the files. All 3 dirs are ancestors.
    expect(stuckKeys(computeStuckRows(chain(), 100, VP))).toEqual([
      'dir:a', 'dir:a/b', 'dir:a/b/c',
    ]);
  });

  // ── Single ancestor ──

  it('sticks single ancestor for flat structure', () => {
    // A(d0,0) → 10 files(d1, 22+)
    const rows = [dir('a', 0, 0), ...files(10, 1, 22, [{ path: 'a' }])] as FlatRow[];
    const result = computeStuckRows(rows, 23, VP);
    expect(stuckKeys(result)).toEqual(['dir:a']);
  });

  // ── Sibling switching ──

  it('sticks correct branch when scrolled past first sibling into second', () => {
    // scrollTop=132: content is under C, not B. Stuck = [A, C].
    const result = computeStuckRows(siblings(), 132, VP);
    expect(stuckKeys(result)).toContain('dir:a');
    expect(stuckKeys(result)).toContain('dir:a/c');
    expect(stuckKeys(result)).not.toContain('dir:a/b');
  });

  it('no 1px gap at sibling transition boundary', () => {
    // A→B→3files(44..88)→C→3files(132..176). B's last file bottom=110.
    // At scrollTop=88: after sticking A (widget=22), effectiveTop=110.
    // C is at y=110 (flush with widget bottom). C should stick (no gap).
    const rows = siblings();
    const result = computeStuckRows(rows, 88, VP);
    expect(stuckKeys(result)).toEqual(['dir:a', 'dir:a/c']);
  });

  it('sticks first branch when scrolled in its region', () => {
    // scrollTop=50: content is a file under B. Stuck = [A, B].
    const result = computeStuckRows(siblings(), 50, VP);
    expect(stuckKeys(result)).toEqual(['dir:a', 'dir:a/b']);
  });

  // ── Top-level sibling dirs ──

  it('switches between top-level sibling dirs', () => {
    // A(d0,0) → file(d1,22) → B(d0,44) → files(d1,66+)
    const rows = [
      dir('a', 0, 0),
      file('file:a1', 1, 22, [{ path: 'a' }]),
      dir('b', 0, 44),
      ...files(5, 1, 66, [{ path: 'b' }]),
    ] as FlatRow[];

    // scrollTop=23: in A's section
    expect(stuckKeys(computeStuckRows(rows, 23, VP))).toEqual(['dir:a']);
    // scrollTop=67: in B's section
    expect(stuckKeys(computeStuckRows(rows, 67, VP))).toEqual(['dir:b']);
  });

  // ── Boundary conditions ──

  it('dir at exactly effectiveTop is NOT stuck (visible)', () => {
    // A(d0,0) → files. scrollTop=0. A.offsetY=0, effectiveTop=0. 0 < 0 is false.
    const rows = [dir('a', 0, 0), ...files(5, 1, 22, [{ path: 'a' }])] as FlatRow[];
    expect(computeStuckRows(rows, 0, VP)).toEqual([]);
  });

  it('dir 1px above effectiveTop IS stuck', () => {
    const rows = [dir('a', 0, 0), ...files(5, 1, 22, [{ path: 'a' }])] as FlatRow[];
    expect(stuckKeys(computeStuckRows(rows, 1, VP))).toEqual(['dir:a']);
  });

  // ── Collapsed dirs ──

  it('collapsed dir (no children in flat list) does not self-stick', () => {
    // A(d0,0) collapsed, B(d0,22) → files
    const rows = [
      dir('a', 0, 0),    // collapsed: next row is B at same depth
      dir('b', 0, 22),
      ...files(5, 1, 44, [{ path: 'b' }]),
    ] as FlatRow[];
    // scrollTop=1: A is partially scrolled but has no children. Skip A.
    // B is visible at y=22. B has children (files). B.offsetY=22, effectiveTop=1. 22 < 1? No.
    // Result should be empty (A has no children, B is visible).
    expect(computeStuckRows(rows, 1, VP)).toEqual([]);
  });

  // ── Caps ──

  it('sticks all nested dirs when viewport allows', () => {
    // 9 nested dirs — all should stick (no arbitrary count cap)
    const deepRows: FlatRow[] = [];
    const anc: Array<{ path: string }> = [];
    for (let d = 0; d < 9; d++) {
      const path = Array.from({ length: d + 1 }, (_, i) => String.fromCharCode(97 + i)).join('/');
      deepRows.push(dir(path, d, d * ROW_HEIGHT_DIR, [...anc]));
      anc.push({ path });
    }
    deepRows.push(...files(5, 9, 9 * ROW_HEIGHT_DIR, [...anc]));

    const result = computeStuckRows(deepRows, 1, VP);
    expect(result.length).toBe(9);
  });

  it('respects 40% viewport height cap', () => {
    // viewport=50px. 40% = 20px. Only 0 rows fit (22px > 20px).
    // Actually wait: stickyHeight starts at 0 < 20, so one row can be added (stickyHeight becomes 22).
    // The check is `stickyHeight < maxStickyHeight` at the TOP of the loop.
    // After adding 1 row: stickyHeight=22 >= 20 → stop. So max 1 row.
    // But 0 < 20 allows entry, sticks 1 row, then 22 >= 20 stops. Result: 1 row.
    // Hmm, but should we allow it? Let me check: viewport=100. 40%=40.
    // 0<40 → stick row 1 (22). 22<40 → stick row 2 (44). 44>=40 → stop.
    // So viewport=100 allows 2 rows. Not 1.
    // For viewport=50: 0<20 → stick 1 (22). 22>=20 → stop. 1 row max.
    const rows = chain();
    const result = computeStuckRows(rows, 1, 50);
    expect(result.length).toBe(1);
  });

  // ── Anti-flicker ──

  it('no flicker across scroll range (monotonic stuck count before content end)', () => {
    const rows = chain();
    let prev = 0;
    const drops: number[] = [];
    const lastRow = rows[rows.length - 1];
    const totalHeight = lastRow.offsetY + lastRow.height;
    // Stop before the content end zone where the widget can't fully cascade
    // because there aren't enough rows left under the growing widget.
    const safeEnd = totalHeight - MAX_STICKY_HEIGHT;
    for (let st = 0; st < safeEnd; st++) {
      const count = computeStuckRows(rows, st, VP).length;
      if (count < prev) drops.push(st);
      prev = count;
    }
    expect(drops).toEqual([]);
  });

  // ── lastDescendantIndex ──

  it('computes correct lastDescendantIndex for nested dirs', () => {
    const rows = siblings();
    // A at index 0: last descendant is last file under C (index 8)
    // B at index 1: last descendant is last B-file (index 4)
    // C at index 5: last descendant is last C-file (index 8)
    const result = computeStuckRows(rows, 50, VP);
    expect(result.length).toBe(2); // [A, B]
    expect(result[0].lastDescendantIndex).toBe(rows.length - 1); // A spans entire tree
    expect(result[1].lastDescendantIndex).toBe(4); // B ends before C
  });
});

// ── computePositions ────────────────────────────────────────────────────────

describe('computePositions', () => {
  function makeStickyNode(path: string, offsetY: number, depth: number, lastDescIdx: number): StickyNode {
    return {
      row: dir(path, depth, offsetY) as DirFlatRow,
      lastDescendantIndex: lastDescIdx,
    };
  }

  it('returns empty for no stuck nodes', () => {
    expect(computePositions([], [], 0)).toEqual([]);
  });

  it('stacks rows at natural positions when no push-out', () => {
    // 3 stuck rows, last descendant far below
    const flatRows = [
      dir('a', 0, 0), dir('a/b', 1, 22), dir('a/b/c', 2, 44),
      ...files(10, 3, 66, []),
    ] as FlatRow[];
    const nodes: StickyNode[] = [
      { row: flatRows[0] as DirFlatRow, lastDescendantIndex: 12 },
      { row: flatRows[1] as DirFlatRow, lastDescendantIndex: 12 },
      { row: flatRows[2] as DirFlatRow, lastDescendantIndex: 12 },
    ];
    const positions = computePositions(nodes, flatRows, 50);
    expect(positions.map(p => p.top)).toEqual([0, 22, 44]);
  });

  it('pushes bottom row when last descendant enters sticky zone', () => {
    // Single stuck row A. A's last descendant is a file at y=30 (height=22, bottom=52).
    // scrollTop=40. lastDescBottom = 30+22-40 = 12. normalTop=0. 0+22=22 > 12 and 0 <= 12.
    // Push: position = 12 - 22 = -10.
    const flatRows = [
      dir('a', 0, 0),
      file('file:last', 1, 30, [{ path: 'a' }]),
    ] as FlatRow[];
    const nodes: StickyNode[] = [
      { row: flatRows[0] as DirFlatRow, lastDescendantIndex: 1 },
    ];
    const positions = computePositions(nodes, flatRows, 40);
    expect(positions[0].top).toBe(-10);
  });

  it('cascades push-out to rows above via runningTop', () => {
    // 2 stuck rows. Bottom row B being pushed.
    // A's last desc at y=200 (far away, no push on A independently).
    // B's last desc at y=60 (height=22, bottom=82).
    // scrollTop=50. B's lastDescBottom = 82-50 = 32.
    // A: normalTop=0. A's lastDescBottom = 200+22-50 = 172. 0+22=22 > 172? No. position=0.
    // B: normalTop=0+22=22. 22+22=44 > 32 and 22 <= 32. Push: 32-22=10.
    // runningTop after B = 10+22=32.
    const flatRows = [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      ...files(2, 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
      dir('a/c', 1, 88, [{ path: 'a' }]),
      ...files(5, 2, 110, [{ path: 'a' }, { path: 'a/c' }]),
    ] as FlatRow[];
    const nodes: StickyNode[] = [
      { row: flatRows[0] as DirFlatRow, lastDescendantIndex: flatRows.length - 1 }, // A
      { row: flatRows[1] as DirFlatRow, lastDescendantIndex: 3 }, // B: last desc is file at index 3
    ];
    // scrollTop=70. B's lastDescBottom = (44+22*1)+22-70 = 66+22-70 = 18.
    // Wait let me recalculate. files(2, 2, 44, ...) gives files at y=44 and y=66.
    // B's lastDescIdx=3 → flatRows[3] = file at y=66, bottom=88.
    // scrollTop=70. lastDescBottom = 88-70 = 18.
    // A: normalTop=0. lastDescBottom = very far. position=0.
    // B: normalTop=22. 22+22=44 > 18 and 22 <= 18? No (22 > 18). So no push condition met.
    // Hmm, the condition is normalTop <= lastDescBottom. 22 <= 18 is false. So no push.
    // That means B is already past (its section ended). This shouldn't happen if
    // computeStuckRows is correct.

    // Let me use scrollTop=55 instead.
    // B's lastDescBottom = 88-55 = 33. B normalTop=22. 22+22=44 > 33 and 22 <= 33.
    // Push: 33-22=11. ✓
    const positions = computePositions(nodes, flatRows, 55);
    expect(positions[0].top).toBe(0);  // A not pushed
    expect(positions[1].top).toBe(11); // B pushed from 22 to 11
  });

  it('no push when last descendant is far below', () => {
    const flatRows = [
      dir('a', 0, 0),
      ...files(50, 1, 22, [{ path: 'a' }]),
    ] as FlatRow[];
    const nodes: StickyNode[] = [
      { row: flatRows[0] as DirFlatRow, lastDescendantIndex: 50 },
    ];
    // scrollTop=100. lastDescBottom = 22+49*22+22-100 = 1100-100 = huge. No push.
    const positions = computePositions(nodes, flatRows, 100);
    expect(positions[0].top).toBe(0);
  });
});

// ── createStickyOverlay (DOM integration) ───────────────────────────────────

afterEach(() => { document.body.innerHTML = ''; });

function makeContainer(scrollTop = 0, clientHeight = 600): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, writable: true, configurable: true });
  return el;
}

function makeDirRenderer() {
  const rendered: string[] = [];
  const renderRow = (row: FlatRow) => {
    rendered.push(row.key);
    const el = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = 'dir-row';
    el.appendChild(inner);
    return el;
  };
  return { rendered, renderRow };
}

function domFixture() {
  return [
    dir('a', 0, 0),
    ...files(10, 1, 22, [{ path: 'a' }]),
  ] as FlatRow[];
}

describe('createStickyOverlay — DOM', () => {
  it('hasStuckRows returns false initially', () => {
    const overlay = createStickyOverlay({ container: makeContainer(), renderRow: () => document.createElement('div') });
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('returns false when no rows are stuck (scrollTop=0)', () => {
    const container = makeContainer(0);
    const { renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });
    overlay.update(domFixture(), 0);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('renders stuck rows and applies is-stuck-bottom to last', () => {
    const container = makeContainer(50);
    const { rendered, renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });
    overlay.update(domFixture(), 1);

    expect(overlay.hasStuckRows()).toBe(true);
    expect(rendered).toEqual(['dir:a']);

    const stuckBottomRows = container.querySelectorAll('.is-stuck-bottom');
    expect(stuckBottomRows.length).toBe(1);
    overlay.destroy();
  });

  it('clears when disabled', () => {
    const container = makeContainer(50);
    const { renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });
    overlay.update(domFixture(), 1);
    expect(overlay.hasStuckRows()).toBe(true);

    overlay.setEnabled(false);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('clears when scrolled back to top', () => {
    const container = makeContainer(50);
    const { renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });
    const rows = domFixture();

    overlay.update(rows, 1);
    expect(overlay.hasStuckRows()).toBe(true);

    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
    overlay.update(rows, 0);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('skips re-render when stuck set is unchanged', () => {
    const container = makeContainer(50);
    const { rendered, renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });
    const rows = domFixture();

    overlay.update(rows, 1);
    expect(rendered.length).toBe(1);

    overlay.update(rows, 1);
    expect(rendered.length).toBe(1); // no additional render
    overlay.destroy();
  });

  it('sticks multiple ancestors for deeply nested content', () => {
    const container = makeContainer(100);
    const { rendered, renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    const rows = [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      dir('a/b/c', 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
      ...files(10, 3, 66, [{ path: 'a' }, { path: 'a/b' }, { path: 'a/b/c' }]),
    ] as FlatRow[];

    overlay.update(rows, 4);
    expect(overlay.hasStuckRows()).toBe(true);
    expect(rendered).toEqual(['dir:a', 'dir:a/b', 'dir:a/b/c']);
    overlay.destroy();
  });

  it('sticks correct ancestor when scrolled past first sibling into second', () => {
    const container = makeContainer(132);
    const { rendered, renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    const rows = [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      ...files(3, 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
      dir('a/c', 1, 110, [{ path: 'a' }]),
      ...files(3, 2, 132, [{ path: 'a' }, { path: 'a/c' }]),
    ] as FlatRow[];

    overlay.update(rows, 7);
    expect(rendered).toContain('dir:a');
    expect(rendered).toContain('dir:a/c');
    expect(rendered).not.toContain('dir:a/b');
    overlay.destroy();
  });

  it('adds sticky-dir and is-stuck classes to dir-row elements', () => {
    const container = makeContainer(50);
    const { renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });
    overlay.update(domFixture(), 1);

    const stuckDirs = container.querySelectorAll('.sticky-dir.is-stuck');
    expect(stuckDirs.length).toBe(1);
    overlay.destroy();
  });

  it('destroy removes overlay from DOM', () => {
    const container = makeContainer();
    const overlay = createStickyOverlay({ container, renderRow: () => document.createElement('div') });
    expect(container.querySelector('.virtual-sticky-overlay')).not.toBeNull();
    overlay.destroy();
    expect(container.querySelector('.virtual-sticky-overlay')).toBeNull();
  });

  // ── New: absolute positioning ──

  it('positions stuck rows absolutely with style.top', () => {
    const container = makeContainer(100);
    const { renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    const rows = [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      ...files(10, 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
    ] as FlatRow[];

    overlay.update(rows, 2);

    const overlayEl = container.querySelector('.virtual-sticky-overlay')!;
    const children = overlayEl.children;
    expect(children.length).toBe(2);
    expect((children[0] as HTMLElement).style.position).toBe('absolute');
    expect((children[0] as HTMLElement).style.top).toBe('0px');
    expect((children[1] as HTMLElement).style.top).toBe('22px');
    overlay.destroy();
  });

  it('sets container height to match sticky widget', () => {
    const container = makeContainer(100);
    const { renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    const rows = [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      ...files(10, 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
    ] as FlatRow[];

    overlay.update(rows, 2);

    const overlayEl = container.querySelector('.virtual-sticky-overlay') as HTMLElement;
    expect(overlayEl.style.height).toBe('44px'); // 2 rows × 22px
    overlay.destroy();
  });

  it('fast path: same keys different position updates style.top without re-render', () => {
    const container = makeContainer(50);
    const { rendered, renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    // A → B → files(44..88) → C → files
    const rows = [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      ...files(2, 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
      dir('a/c', 1, 88, [{ path: 'a' }]),
      ...files(5, 2, 110, [{ path: 'a' }, { path: 'a/c' }]),
    ] as FlatRow[];

    overlay.update(rows, 2);
    const renderCount1 = rendered.length;
    expect(renderCount1).toBeGreaterThan(0);

    // Scroll a bit — same stuck keys but push-out position changes
    Object.defineProperty(container, 'scrollTop', { value: 55, writable: true, configurable: true });
    overlay.update(rows, 2);

    // Should NOT have re-rendered (same keys)
    expect(rendered.length).toBe(renderCount1);
    overlay.destroy();
  });
});
