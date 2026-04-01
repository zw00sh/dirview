// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createStickyOverlay } from './sticky-overlay';
import type { FlatRow, DirFlatRow } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function dir(path: string, depth: number, offsetY: number, ancestors: Array<{ path: string }> = []): DirFlatRow {
  return {
    type: 'dir',
    key: 'dir:' + path,
    depth,
    height: 22,
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
    height: 22,
    offsetY,
    ancestors: ancestors as any,
    file: { name: 'f.ts', path: '/ws/f.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
  } as any;
}

/** Generate N file rows starting at offsetY, all with given ancestors. */
function files(n: number, depth: number, startOffset: number, ancestors: Array<{ path: string }>): FlatRow[] {
  return Array.from({ length: n }, (_, i) =>
    file(`file:f${i}`, depth, startOffset + i * 22, ancestors)
  );
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

afterEach(() => { document.body.innerHTML = ''; });

function makeContainer(scrollTop = 0): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
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

// Fixture with enough depth: A → 10 files
function domFixture() {
  const A = dir('a', 0, 0);
  const ff = files(10, 1, 22, [{ path: 'a' }]);
  return [A, ...ff] as FlatRow[];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createStickyOverlay', () => {
  it('hasStuckRows returns false initially', () => {
    const overlay = createStickyOverlay({ container: makeContainer(), renderRow: () => document.createElement('div') });
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('returns false when no rows are stuck (scrollTop=0)', () => {
    const container = makeContainer(0);
    const { renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    // All rows visible, scrollTop=0 — no ancestors are above the viewport
    overlay.update(domFixture(), 0);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('renders stuck rows and applies is-stuck-bottom to last', () => {
    const container = makeContainer(50);
    const { rendered, renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    // visibleStart=1 means the dir row is above viewport
    overlay.update(domFixture(), 1);

    expect(overlay.hasStuckRows()).toBe(true);
    expect(rendered).toEqual(['dir:a']);

    const rows = container.querySelectorAll('.is-stuck-bottom');
    expect(rows.length).toBe(1);
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

    // scrollTop=100, visibleStart=4 (first file after all 3 dirs)
    overlay.update(rows, 4);
    expect(overlay.hasStuckRows()).toBe(true);
    expect(rendered).toEqual(['dir:a', 'dir:a/b', 'dir:a/b/c']);
    overlay.destroy();
  });

  it('sticks correct ancestor when scrolled past first sibling into second', () => {
    const container = makeContainer(132);
    const { rendered, renderRow } = makeDirRenderer();
    const overlay = createStickyOverlay({ container, renderRow });

    // A → B → 3 files → C → 3 files
    const rows = [
      dir('a', 0, 0),
      dir('a/b', 1, 22, [{ path: 'a' }]),
      ...files(3, 2, 44, [{ path: 'a' }, { path: 'a/b' }]),
      dir('a/c', 1, 110, [{ path: 'a' }]),
      ...files(3, 2, 132, [{ path: 'a' }, { path: 'a/c' }]),
    ] as FlatRow[];

    // scrollTop=132, visibleStart=7: content is a file under C. Ancestors=[A, C].
    overlay.update(rows, 7);
    expect(overlay.hasStuckRows()).toBe(true);
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
});
