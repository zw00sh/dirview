// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVirtualScroller, findFirstVisible } from './scroller';
import type { FlatRow } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFlatRows(count: number, height: number = 22): FlatRow[] {
  const rows: FlatRow[] = [];
  let offsetY = 0;
  for (let i = 0; i < count; i++) {
    rows.push({
      type: 'file',
      key: `file:${i}`,
      depth: 0,
      height,
      offsetY,
      ancestors: [],
      file: { name: `f${i}.ts`, path: `/ws/f${i}.ts`, langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
    } as any);
    offsetY += height;
  }
  return rows;
}

/** Create flat rows with mixed heights to test binary search accuracy. */
function makeMixedRows(): FlatRow[] {
  // heights: 22, 18, 6, 22, 18, 6, ... (repeating pattern)
  const heights = [22, 18, 6];
  const rows: FlatRow[] = [];
  let offsetY = 0;
  for (let i = 0; i < 30; i++) {
    const h = heights[i % 3];
    rows.push({
      type: i % 3 === 0 ? 'dir' : i % 3 === 1 ? 'file' : 'matchSpacer',
      key: `row:${i}`,
      depth: 0,
      height: h,
      offsetY,
      ancestors: [],
    } as any);
    offsetY += h;
  }
  return rows;
}

function makeContainer(scrollTop: number = 0, clientHeight: number = 220): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // jsdom doesn't support scroll layout, so mock the properties.
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: () => {},
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    get: () => clientHeight,
    configurable: true,
  });
  return container;
}

// ── findFirstVisible (binary search) ─────────────────────────────────────────

describe('findFirstVisible', () => {
  it('returns 0 for scrollTop=0', () => {
    const rows = makeFlatRows(100);
    expect(findFirstVisible(rows, 0)).toBe(0);
  });

  it('returns correct index for uniform 22px rows', () => {
    const rows = makeFlatRows(100);
    // scrollTop=110 → first 5 rows (0–4) are fully above (5*22=110), so visibleStart=5
    expect(findFirstVisible(rows, 110)).toBe(5);
  });

  it('handles scrollTop exactly on a row boundary', () => {
    const rows = makeFlatRows(100);
    // scrollTop=44 → rows 0,1 are fully above (2*22=44), so visibleStart=2
    expect(findFirstVisible(rows, 44)).toBe(2);
  });

  it('handles scrollTop mid-row', () => {
    const rows = makeFlatRows(100);
    // scrollTop=33 → row 0 fully above? 0+22=22 <= 33 yes. row 1? 22+22=44 <= 33 no.
    // So visibleStart=1 (row 1 is partially visible)
    expect(findFirstVisible(rows, 33)).toBe(1);
  });

  it('returns correct index with mixed heights (22, 18, 6)', () => {
    const rows = makeMixedRows();
    // offsets: 0, 22, 40, 46, 68, 86, 92, 114, 132, 138, ...
    // scrollTop=46 → rows 0(0+22=22<=46 yes), 1(22+18=40<=46 yes), 2(40+6=46<=46 yes)
    // row 3: 46+22=68 <= 46? no. So visibleStart=3.
    expect(findFirstVisible(rows, 46)).toBe(3);
  });

  it('returns 0 for empty rows', () => {
    expect(findFirstVisible([], 0)).toBe(0);
    expect(findFirstVisible([], 100)).toBe(0);
  });

  it('returns length when scrollTop is past all rows', () => {
    const rows = makeFlatRows(5, 22); // total height = 110
    expect(findFirstVisible(rows, 200)).toBe(5);
  });
});

// ── Visible range calculation ────────────────────────────────────────────────

describe('visible range calculation', () => {
  it('scrollTop=0, viewportHeight=220, 22px rows → visibleStart=0, visibleEnd=10', () => {
    const rows = makeFlatRows(100);
    const container = makeContainer(0, 220);
    let captured: [number, number] = [0, 0];
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      onRender: (start, end) => { captured = [start, end]; },
      overscan: 0,
    });
    scroller.update(rows, 100 * 22);
    expect(captured).toEqual([0, 10]);
    scroller.destroy();
  });

  it('scrollTop=110, viewportHeight=220 → visibleStart=5, visibleEnd=15', () => {
    const rows = makeFlatRows(100);
    const container = makeContainer(110, 220);
    let captured: [number, number] = [0, 0];
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      onRender: (start, end) => { captured = [start, end]; },
      overscan: 0,
    });
    scroller.update(rows, 100 * 22);
    expect(captured).toEqual([5, 15]);
    scroller.destroy();
  });

  it('scroll to bottom → visibleEnd capped at flatRows.length', () => {
    const rows = makeFlatRows(20); // total height = 440
    const container = makeContainer(440 - 220, 220); // scrollTop=220
    let captured: [number, number] = [0, 0];
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      onRender: (start, end) => { captured = [start, end]; },
      overscan: 0,
    });
    scroller.update(rows, 20 * 22);
    expect(captured[1]).toBe(20);
    scroller.destroy();
  });

  it('empty flatRows → visibleStart=0, visibleEnd=0', () => {
    const container = makeContainer(0, 220);
    let captured: [number, number] | null = null;
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      onRender: (start, end) => { captured = [start, end]; },
      overscan: 0,
    });
    scroller.update([], 0);
    // onRender should not be called for empty rows
    expect(captured).toBeNull();
    scroller.destroy();
  });

  it('single row → visibleStart=0, visibleEnd=1', () => {
    const rows = makeFlatRows(1);
    const container = makeContainer(0, 220);
    let captured: [number, number] = [0, 0];
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      onRender: (start, end) => { captured = [start, end]; },
      overscan: 0,
    });
    scroller.update(rows, 22);
    expect(captured).toEqual([0, 1]);
    scroller.destroy();
  });
});

// ── Overscan ─────────────────────────────────────────────────────────────────

describe('overscan', () => {
  it('overscan=10, visibleStart=15 → renderStart=5', () => {
    const rows = makeFlatRows(100);
    // scrollTop = 15*22 = 330, viewport 220 → visible 15-25
    const container = makeContainer(330, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 10,
    });
    scroller.update(rows, 100 * 22);
    // Should have rendered rows 5–34 (15-10=5, 25+10=35, capped at 35)
    const tree = container.querySelector('ul.tree')!;
    const children = tree.children;
    expect(children.length).toBe(30); // 35-5=30
    scroller.destroy();
  });

  it('overscan near start → clamped to 0', () => {
    const rows = makeFlatRows(100);
    // scrollTop=44, viewport=220 → visible 2-12, overscan=10 → renderStart=max(0,-8)=0
    const container = makeContainer(44, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 10,
    });
    scroller.update(rows, 100 * 22);
    const tree = container.querySelector('ul.tree')!;
    // renderStart=0, renderEnd=min(100,22)=22
    expect(tree.children.length).toBe(22);
    scroller.destroy();
  });

  it('overscan near end → clamped to length', () => {
    const rows = makeFlatRows(20); // total 440
    // scrollTop=220, viewport=220 → visible 10-20, overscan=10 → renderEnd=min(20,30)=20
    const container = makeContainer(220, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 10,
    });
    scroller.update(rows, 20 * 22);
    const tree = container.querySelector('ul.tree')!;
    // renderStart=max(0,0)=0, renderEnd=20
    expect(tree.children.length).toBe(20);
    scroller.destroy();
  });
});

// ── DOM management ───────────────────────────────────────────────────────────

describe('DOM management', () => {
  it('initial update: correct number of <li> children', () => {
    const rows = makeFlatRows(50);
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    scroller.update(rows, 50 * 22);
    const tree = container.querySelector('ul.tree')!;
    // viewport=220, rowHeight=22 → 10 visible rows
    expect(tree.children.length).toBe(10);
    scroller.destroy();
  });

  it('verify row positioning (absolute, top=offsetY)', () => {
    const rows = makeFlatRows(5);
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    scroller.update(rows, 5 * 22);
    const tree = container.querySelector('ul.tree')!;
    const children = Array.from(tree.children) as HTMLElement[];
    expect(children.length).toBe(5);
    for (const child of children) {
      expect(child.style.position).toBe('absolute');
      expect(child.style.left).toBe('0px');
      expect(child.style.right).toBe('0px');
    }
    // Check that at least one row has the expected top offset
    const tops = children.map(c => c.style.top);
    expect(tops).toContain('0px');
    expect(tops).toContain('22px');
    expect(tops).toContain('44px');
    scroller.destroy();
  });

  it('update() with new flatRows clears and re-renders', () => {
    const rows1 = makeFlatRows(5);
    const rows2 = makeFlatRows(3, 22);
    const container = makeContainer(0, 220);
    const renderRow = vi.fn(() => document.createElement('li'));
    const scroller = createVirtualScroller({
      container,
      renderRow,
      overscan: 0,
    });
    scroller.update(rows1, 5 * 22);
    expect(renderRow).toHaveBeenCalledTimes(5);

    // Second update should clear and re-render
    renderRow.mockClear();
    scroller.update(rows2, 3 * 22);
    expect(renderRow).toHaveBeenCalledTimes(3);
    const tree = container.querySelector('ul.tree')!;
    expect(tree.children.length).toBe(3);
    scroller.destroy();
  });

  it('renderRow receives the correct FlatRow', () => {
    const rows = makeFlatRows(3);
    const container = makeContainer(0, 220);
    const receivedRows: FlatRow[] = [];
    const scroller = createVirtualScroller({
      container,
      renderRow: (row) => {
        receivedRows.push(row);
        return document.createElement('li');
      },
      overscan: 0,
    });
    scroller.update(rows, 3 * 22);
    expect(receivedRows.length).toBe(3);
    expect(receivedRows[0].key).toBe('file:0');
    expect(receivedRows[1].key).toBe('file:1');
    expect(receivedRows[2].key).toBe('file:2');
    scroller.destroy();
  });

  it('update with empty flatRows removes tree element', () => {
    const rows = makeFlatRows(5);
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    scroller.update(rows, 5 * 22);
    expect(container.querySelector('ul.tree')).not.toBeNull();

    scroller.update([], 0);
    expect(container.querySelector('ul.tree')).toBeNull();
    scroller.destroy();
  });
});

// ── Container sizing ─────────────────────────────────────────────────────────

describe('container sizing', () => {
  it('tree <ul> height matches totalHeight', () => {
    const rows = makeFlatRows(50);
    const totalHeight = 50 * 22;
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    scroller.update(rows, totalHeight);
    const tree = container.querySelector('ul.tree') as HTMLElement;
    expect(tree.style.height).toBe(totalHeight + 'px');
    scroller.destroy();
  });

  it('tree <ul> has position: relative', () => {
    const rows = makeFlatRows(5);
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    scroller.update(rows, 5 * 22);
    const tree = container.querySelector('ul.tree') as HTMLElement;
    expect(tree.style.position).toBe('relative');
    scroller.destroy();
  });

  it('tree <ul> gets custom treeClass', () => {
    const rows = makeFlatRows(3);
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      treeClass: 'virtual-tree',
      overscan: 0,
    });
    scroller.update(rows, 3 * 22);
    const tree = container.querySelector('ul.tree.virtual-tree');
    expect(tree).not.toBeNull();
    scroller.destroy();
  });
});

// ── destroy ──────────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('removes tree element and clears rendered rows', () => {
    const rows = makeFlatRows(5);
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    scroller.update(rows, 5 * 22);
    expect(container.querySelector('ul.tree')).not.toBeNull();

    scroller.destroy();
    expect(container.querySelector('ul.tree')).toBeNull();
  });
});

// ── getTreeEl ────────────────────────────────────────────────────────────────

describe('getTreeEl', () => {
  it('returns the tree <ul> element', () => {
    const rows = makeFlatRows(5);
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    scroller.update(rows, 5 * 22);
    const treeEl = scroller.getTreeEl();
    expect(treeEl.tagName).toBe('UL');
    expect(treeEl.classList.contains('tree')).toBe(true);
    scroller.destroy();
  });

  it('creates tree element if called before update', () => {
    const container = makeContainer(0, 220);
    const scroller = createVirtualScroller({
      container,
      renderRow: () => document.createElement('li'),
      overscan: 0,
    });
    const treeEl = scroller.getTreeEl();
    expect(treeEl.tagName).toBe('UL');
    scroller.destroy();
  });
});
