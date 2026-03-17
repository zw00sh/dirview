// Virtual scroller — renders only the visible window of FlatRow items.
// Uses binary search on pre-computed offsetY to find the visible range,
// absolutely positions rows inside a height-sentinel <ul>, and applies
// an overscan buffer to avoid flicker during fast scrolling.

import type { FlatRow } from './types';

// ── Public API ───────────────────────────────────────────────────────────────

export interface VirtualScrollerConfig {
  /** The scroll container element (e.g. #root). */
  container: HTMLElement;
  /** Callback to render a FlatRow into a DOM element. */
  renderRow: (row: FlatRow) => HTMLElement;
  /** Number of extra rows to render above/below viewport. Default: 10 */
  overscan?: number;
  /** CSS class(es) for the tree <ul> element. */
  treeClass?: string;
  /** Called after each scroll-render pass with the visible range. */
  onRender?: (visibleStart: number, visibleEnd: number) => void;
}

export interface VirtualScroller {
  /** Update with new flat rows (e.g. after expand/collapse/filter). Re-renders visible window. */
  update(flatRows: FlatRow[], totalHeight: number): void;
  /** Clean up event listeners. */
  destroy(): void;
  /** Get the tree <ul> element (for event delegation). */
  getTreeEl(): HTMLElement;
  /** Scroll to make a specific row index visible. */
  scrollToIndex(index: number): void;
  /** Update the CSS class on the tree element (e.g. for sort mode). */
  setTreeClass(cls: string): void;
}

// ── Binary search ────────────────────────────────────────────────────────────

/**
 * Find the index of the first row whose bottom edge is below scrollTop,
 * i.e. the first row that is at least partially visible.
 */
export function findFirstVisible(flatRows: FlatRow[], scrollTop: number): number {
  let lo = 0;
  let hi = flatRows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (flatRows[mid].offsetY + flatRows[mid].height <= scrollTop) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Binary search for the first row whose offsetY >= target, starting from startFrom.
 *  Used to find the end of the visible range. */
export function findFirstPast(flatRows: FlatRow[], target: number, startFrom: number): number {
  let lo = startFrom;
  let hi = flatRows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (flatRows[mid].offsetY < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createVirtualScroller(config: VirtualScrollerConfig): VirtualScroller {
  const { container, renderRow, onRender } = config;
  const overscan = config.overscan ?? 10;

  let flatRows: FlatRow[] = [];
  let treeEl: HTMLElement | null = null;
  let renderedRows = new Map<string, HTMLElement>();
  let lastRenderStart = -1;
  let lastRenderEnd = -1;
  let rafPending = false;

  // ── DOM setup ────────────────────────────────────────────────────────────

  function ensureTreeEl(totalHeight: number): HTMLElement {
    if (!treeEl) {
      treeEl = document.createElement('ul');
      const classes = ['tree'];
      if (config.treeClass) {
        classes.push(...config.treeClass.split(/\s+/).filter(Boolean));
      }
      treeEl.className = classes.join(' ');
      treeEl.style.position = 'relative';
      container.appendChild(treeEl);
    }
    treeEl.style.height = totalHeight + 'px';
    return treeEl;
  }

  // ── Scroll render pass ───────────────────────────────────────────────────

  function renderPass(): void {
    if (flatRows.length === 0 || !treeEl) return;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    // Find visible range via binary search.
    const visibleStart = findFirstVisible(flatRows, scrollTop);
    const bottomEdge = scrollTop + viewportHeight;
    const visibleEnd = findFirstPast(flatRows, bottomEdge, visibleStart);

    // Apply overscan.
    const renderStart = Math.max(0, visibleStart - overscan);
    const renderEnd = Math.min(flatRows.length, visibleEnd + overscan);

    // Skip if range unchanged.
    if (renderStart === lastRenderStart && renderEnd === lastRenderEnd) {
      if (onRender) onRender(visibleStart, visibleEnd);
      return;
    }
    lastRenderStart = renderStart;
    lastRenderEnd = renderEnd;

    // Build set of keys for the new range.
    const newKeys = new Set<string>();
    for (let i = renderStart; i < renderEnd; i++) {
      newKeys.add(flatRows[i].key);
    }

    // Remove rows no longer in range.
    for (const [key, el] of renderedRows) {
      if (!newKeys.has(key)) {
        el.remove();
        renderedRows.delete(key);
      }
    }

    // Add rows that are newly in range.
    for (let i = renderStart; i < renderEnd; i++) {
      const row = flatRows[i];
      if (!renderedRows.has(row.key)) {
        const el = renderRow(row);
        el.style.position = 'absolute';
        el.style.top = row.offsetY + 'px';
        el.style.left = '0';
        el.style.right = '0';
        el.style.height = row.height + 'px';
        treeEl!.appendChild(el);
        renderedRows.set(row.key, el);
      }
    }

    if (onRender) onRender(visibleStart, visibleEnd);
  }

  // ── Scroll handler (rAF-batched) ─────────────────────────────────────────

  function onScroll(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderPass();
    });
  }

  container.addEventListener('scroll', onScroll, { passive: true });

  // Re-render when the container resizes (e.g. panel drag, sidebar toggle).
  const resizeObserver = new ResizeObserver(() => {
    if (flatRows.length > 0) {
      lastRenderStart = -1;
      lastRenderEnd = -1;
      renderPass();
    }
  });
  resizeObserver.observe(container);

  // ── Public methods ───────────────────────────────────────────────────────

  function update(newFlatRows: FlatRow[], totalHeight: number): void {
    flatRows = newFlatRows;

    // Reset render tracking so next pass does full work.
    lastRenderStart = -1;
    lastRenderEnd = -1;

    // Clear existing rendered rows.
    for (const el of renderedRows.values()) {
      el.remove();
    }
    renderedRows = new Map();

    if (flatRows.length === 0) {
      // Remove tree element when empty so empty state can show.
      if (treeEl) {
        treeEl.remove();
        treeEl = null;
      }
      return;
    }

    ensureTreeEl(totalHeight);
    renderPass();
  }

  function destroy(): void {
    resizeObserver.disconnect();
    container.removeEventListener('scroll', onScroll);
    if (treeEl) {
      treeEl.remove();
      treeEl = null;
    }
    renderedRows.clear();
  }

  function getTreeEl(): HTMLElement {
    // Return existing or create a placeholder that will be replaced on update.
    if (!treeEl) {
      treeEl = ensureTreeEl(0);
    }
    return treeEl;
  }

  function scrollToIndex(index: number): void {
    if (index < 0 || index >= flatRows.length) return;
    const row = flatRows[index];
    const viewportHeight = container.clientHeight;
    // Scroll so the target row is centered in the viewport if possible.
    const targetScrollTop = row.offsetY - (viewportHeight - row.height) / 2;
    container.scrollTop = Math.max(0, targetScrollTop);
  }

  function setTreeClass(cls: string): void {
    if (treeEl) {
      treeEl.className = 'tree' + (cls ? ' ' + cls : '');
    }
    // Update for future ensureTreeEl calls
    config.treeClass = cls;
  }

  return { update, destroy, getTreeEl, scrollToIndex, setTreeClass };
}
