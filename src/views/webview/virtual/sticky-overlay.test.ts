// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStickyOverlay } from './sticky-overlay';
import type { FlatRow, DirFlatRow } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  Object.defineProperty(container, 'scrollTop', {
    value: 0,
    writable: true,
    configurable: true,
  });
  return container;
}

function makeDirRow(opts: {
  path: string;
  key: string;
  depth: number;
  offsetY: number;
  ancestors?: Array<{ path: string }>;
}): DirFlatRow {
  return {
    type: 'dir',
    key: opts.key,
    depth: opts.depth,
    height: 22,
    offsetY: opts.offsetY,
    ancestors: (opts.ancestors ?? []) as any,
    node: {
      name: opts.path.split('/').pop() || opts.path,
      path: opts.path,
      stats: [],
      totalFiles: 1,
      sizeBytes: 0,
      files: [],
      children: [],
    },
  } as DirFlatRow;
}

function makeFileRow(opts: {
  key: string;
  depth: number;
  offsetY: number;
  ancestors?: Array<{ path: string }>;
}): FlatRow {
  return {
    type: 'file',
    key: opts.key,
    depth: opts.depth,
    height: 22,
    offsetY: opts.offsetY,
    ancestors: (opts.ancestors ?? []) as any,
    file: { name: 'f.ts', path: '/ws/f.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 100 },
  } as any;
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createStickyOverlay — hasStuckRows', () => {
  it('returns false initially (no update called)', () => {
    const container = makeContainer();
    const overlay = createStickyOverlay({
      container,
      renderRow: () => document.createElement('div'),
    });
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('returns false when no rows are stuck', () => {
    const container = makeContainer();
    const overlay = createStickyOverlay({
      container,
      renderRow: () => document.createElement('div'),
    });

    // All rows visible, scrollTop=0 — no ancestors are above the viewport
    const dirRow = makeDirRow({ path: 'src', key: 'dir:src', depth: 0, offsetY: 0 });
    const fileRow = makeFileRow({
      key: 'file:src/a.ts',
      depth: 1,
      offsetY: 22,
      ancestors: [{ path: 'src' }],
    });

    overlay.update([dirRow, fileRow], 0);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('returns true when ancestor rows are scrolled above viewport', () => {
    const container = makeContainer();
    // Simulate scroll: scrollTop is past the dir row
    Object.defineProperty(container, 'scrollTop', { value: 50, writable: true, configurable: true });

    const overlay = createStickyOverlay({
      container,
      renderRow: (row) => {
        const el = document.createElement('div');
        const inner = document.createElement('div');
        inner.className = 'dir-row';
        el.appendChild(inner);
        return el;
      },
    });

    const dirRow = makeDirRow({ path: 'src', key: 'dir:src', depth: 0, offsetY: 0 });
    const fileRow = makeFileRow({
      key: 'file:src/a.ts',
      depth: 1,
      offsetY: 50,
      ancestors: [{ path: 'src' }],
    });

    // visibleStart=1 means the dir row is above viewport
    overlay.update([dirRow, fileRow], 1);
    expect(overlay.hasStuckRows()).toBe(true);
    overlay.destroy();
  });

  it('returns false after scrolling back to top (stuck rows cleared)', () => {
    const container = makeContainer();

    const overlay = createStickyOverlay({
      container,
      renderRow: (row) => {
        const el = document.createElement('div');
        const inner = document.createElement('div');
        inner.className = 'dir-row';
        el.appendChild(inner);
        return el;
      },
    });

    const dirRow = makeDirRow({ path: 'src', key: 'dir:src', depth: 0, offsetY: 0 });
    const fileRow = makeFileRow({
      key: 'file:src/a.ts',
      depth: 1,
      offsetY: 22,
      ancestors: [{ path: 'src' }],
    });

    // First: scroll down so dir is stuck
    Object.defineProperty(container, 'scrollTop', { value: 50, writable: true, configurable: true });
    overlay.update([dirRow, fileRow], 1);
    expect(overlay.hasStuckRows()).toBe(true);

    // Then: scroll back to top
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
    overlay.update([dirRow, fileRow], 0);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('returns false when overlay is disabled', () => {
    const container = makeContainer();
    Object.defineProperty(container, 'scrollTop', { value: 50, writable: true, configurable: true });

    const overlay = createStickyOverlay({
      container,
      renderRow: (row) => {
        const el = document.createElement('div');
        const inner = document.createElement('div');
        inner.className = 'dir-row';
        el.appendChild(inner);
        return el;
      },
    });

    const dirRow = makeDirRow({ path: 'src', key: 'dir:src', depth: 0, offsetY: 0 });
    const fileRow = makeFileRow({
      key: 'file:src/a.ts',
      depth: 1,
      offsetY: 50,
      ancestors: [{ path: 'src' }],
    });

    overlay.update([dirRow, fileRow], 1);
    expect(overlay.hasStuckRows()).toBe(true);

    overlay.setEnabled(false);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });

  it('stays stuck when scrollTop exactly equals the dir row offsetY (no flicker)', () => {
    const container = makeContainer();
    // scrollTop exactly equals the dir row's offsetY — boundary case
    Object.defineProperty(container, 'scrollTop', { value: 22, writable: true, configurable: true });

    const overlay = createStickyOverlay({
      container,
      renderRow: (row) => {
        const el = document.createElement('div');
        const inner = document.createElement('div');
        inner.className = 'dir-row';
        el.appendChild(inner);
        return el;
      },
    });

    const dirRow = makeDirRow({ path: 'src', key: 'dir:src', depth: 0, offsetY: 22 });
    const fileRow = makeFileRow({
      key: 'file:src/a.ts',
      depth: 1,
      offsetY: 44,
      ancestors: [{ path: 'src' }],
    });

    // visibleStart=1: file row is first visible, dir is at exact scroll boundary
    overlay.update([dirRow, fileRow], 1);
    expect(overlay.hasStuckRows()).toBe(true);
    overlay.destroy();
  });

  it('returns false with empty flat rows', () => {
    const container = makeContainer();
    const overlay = createStickyOverlay({
      container,
      renderRow: () => document.createElement('div'),
    });
    overlay.update([], 0);
    expect(overlay.hasStuckRows()).toBe(false);
    overlay.destroy();
  });
});
