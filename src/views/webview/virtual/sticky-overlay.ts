// Sticky header overlay for virtual scrolling.
// Replaces CSS position:sticky with a JS-driven overlay that shows
// ancestor directory rows at the top of the scroll viewport.
//
// Matches VSCode's native explorer sticky scroll behavior:
// 1. Iterative ancestor walk with widget-height-aware recalculation
// 2. Smooth push-out (accordion) animation at section boundaries

import { h } from '../h';
import type { FlatRow, DirFlatRow } from './types';
import { ROW_HEIGHT_DIR } from './types';
import { findFirstVisible } from './scroller';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_WIDGET_VIEW_RATIO = 0.4;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StickyNode {
  row: DirFlatRow;
  /** Index of the last descendant of this dir in flatRows. */
  lastDescendantIndex: number;
}

export interface StickyPosition {
  row: DirFlatRow;
  /** Pixel offset within the overlay container. */
  top: number;
}

export interface StickyOverlayConfig {
  /** The scroll container (#root). */
  container: HTMLElement;
  /** Renders a FlatRow into a DOM element. */
  renderRow: (row: FlatRow) => HTMLElement;
}

export interface StickyOverlay {
  /** Update the overlay based on current flat rows and scroll position. */
  update(flatRows: FlatRow[], visibleStart: number): void;
  /** Whether any directory rows are currently stuck in the overlay. */
  hasStuckRows(): boolean;
  /** Enable or disable the overlay. */
  setEnabled(enabled: boolean): void;
  /** Remove the overlay from DOM and clean up. */
  destroy(): void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a map from dir path → flatRows index for O(1) lookup. */
function buildDirIndexMap(flatRows: FlatRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < flatRows.length; i++) {
    if (flatRows[i].type === 'dir') {
      map.set((flatRows[i] as DirFlatRow).node.path, i);
    }
  }
  return map;
}

/** Find the index of the last descendant of the dir at dirIndex. */
function findLastDescendant(flatRows: FlatRow[], dirIndex: number): number {
  const dirDepth = flatRows[dirIndex].depth;
  for (let i = dirIndex + 1; i < flatRows.length; i++) {
    if (flatRows[i].depth <= dirDepth) {
      return i - 1;
    }
  }
  return flatRows.length - 1;
}

// ── Pure computation ───────────────────────────────────────────────────────────

/**
 * Compute which directory rows should be stuck at the top of the viewport.
 *
 * Iterative ancestor walk with widget-height recalculation (VSCode algorithm):
 * 1. Find first visible content row under the growing sticky widget.
 * 2. From its ancestors, find the next candidate to stick (shallowest first,
 *    then child-of-previous on subsequent iterations).
 * 3. If the candidate's header is above the effective viewport top, stick it.
 * 4. Repeat, recalculating first-visible each time the widget grows.
 */
export function computeStuckRows(
  flatRows: FlatRow[],
  scrollTop: number,
  viewportHeight: number,
  dirIndexMap?: Map<string, number>,
): StickyNode[] {
  if (scrollTop <= 0 || flatRows.length === 0) return [];

  const maxStickyHeight = viewportHeight * MAX_WIDGET_VIEW_RATIO;
  const map = dirIndexMap ?? buildDirIndexMap(flatRows);
  const result: StickyNode[] = [];
  let stickyHeight = 0;

  while (stickyHeight < maxStickyHeight) {
    const effectiveTop = scrollTop + stickyHeight;

    const visIdx = findFirstVisible(flatRows, effectiveTop);
    const contentRow: FlatRow | undefined = flatRows[visIdx];
    if (!contentRow) break;

    // Build candidate paths: ancestors (shallowest→deepest) + self if expanded dir
    const ancestors = 'ancestors' in contentRow ? contentRow.ancestors : [];
    const candidatePaths: string[] = ancestors
      .filter(a => a != null)
      .map(a => a.path);

    if (contentRow.type === 'dir') {
      const contentIdx = map.get(contentRow.node.path);
      if (contentIdx !== undefined) {
        const nextIdx = contentIdx + 1;
        // Only self-stick expanded dirs (have children in the flat list)
        if (nextIdx < flatRows.length && flatRows[nextIdx].depth > contentRow.depth) {
          candidatePaths.push(contentRow.node.path);
        }
      }
    }

    if (candidatePaths.length === 0) break;

    // Find next candidate to stick
    const lastStuckPath = result.length > 0
      ? result[result.length - 1].row.node.path
      : null;

    let candidatePath: string | null = null;
    if (lastStuckPath === null) {
      candidatePath = candidatePaths[0];
    } else {
      const idx = candidatePaths.indexOf(lastStuckPath);
      if (idx !== -1 && idx + 1 < candidatePaths.length) {
        candidatePath = candidatePaths[idx + 1];
      }
    }

    if (candidatePath === null) break;

    // Look up the dir row
    const dirIdx = map.get(candidatePath);
    if (dirIdx === undefined) break;
    const dirRow = flatRows[dirIdx] as DirFlatRow;

    // First candidate: strictly above (a dir at scrollTop=0 is visible, not stuck).
    // Cascade candidates: allow flush with widget bottom to avoid 1px gaps at
    // sibling transitions (the tree row is covered by the widget's z-index).
    if (result.length === 0 ? dirRow.offsetY >= effectiveTop : dirRow.offsetY > effectiveTop) break;

    const lastDescIdx = findLastDescendant(flatRows, dirIdx);
    result.push({ row: dirRow, lastDescendantIndex: lastDescIdx });
    stickyHeight += ROW_HEIGHT_DIR;
  }

  return result;
}

/**
 * Compute pixel positions for stuck rows, including push-out displacement.
 *
 * Each row is positioned top-to-bottom. When the last descendant of a stuck
 * row scrolls into the sticky zone, that row is pushed upward (accordion).
 * The cascade propagates naturally: pushed rows shift subsequent stacking.
 */
export function computePositions(
  stuckNodes: StickyNode[],
  flatRows: FlatRow[],
  scrollTop: number,
): StickyPosition[] {
  if (stuckNodes.length === 0) return [];

  const positions: StickyPosition[] = [];
  let runningTop = 0;

  for (const node of stuckNodes) {
    const lastDescRow = flatRows[node.lastDescendantIndex];
    const lastDescBottom = lastDescRow.offsetY + lastDescRow.height - scrollTop;
    const normalTop = runningTop;

    let position: number;
    if (normalTop + ROW_HEIGHT_DIR > lastDescBottom && normalTop <= lastDescBottom) {
      position = lastDescBottom - ROW_HEIGHT_DIR;
    } else {
      position = normalTop;
    }

    positions.push({ row: node.row, top: position });
    runningTop = position + ROW_HEIGHT_DIR;
  }

  return positions;
}

// ── DOM overlay ────────────────────────────────────────────────────────────────

export function createStickyOverlay(config: StickyOverlayConfig): StickyOverlay {
  const { container, renderRow } = config;

  const overlayEl = h('div', { className: 'virtual-sticky-overlay' });
  container.insertBefore(overlayEl, container.firstChild);

  let enabled = true;
  let lastStuckKeys: string[] = [];
  let lastPositions: number[] = [];
  let cachedFlatRows: FlatRow[] | null = null;
  let dirIndexMap: Map<string, number> | null = null;

  function clearOverlay(): void {
    if (lastStuckKeys.length > 0 || lastPositions.length > 0) {
      overlayEl.innerHTML = '';
      overlayEl.style.height = '';
      lastStuckKeys = [];
      lastPositions = [];
    }
  }

  function update(flatRows: FlatRow[], _visibleStart: number): void {
    if (!enabled) { clearOverlay(); return; }

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    // Rebuild dir index map when flatRows reference changes
    if (flatRows !== cachedFlatRows) {
      dirIndexMap = buildDirIndexMap(flatRows);
      cachedFlatRows = flatRows;
    }

    const stuckNodes = computeStuckRows(flatRows, scrollTop, viewportHeight, dirIndexMap!);
    const stickyPositions = computePositions(stuckNodes, flatRows, scrollTop);

    const newKeys = stickyPositions.map(p => p.row.key);
    const newTops = stickyPositions.map(p => p.top);

    if (newKeys.length === 0) {
      clearOverlay();
      return;
    }

    const keysMatch = newKeys.length === lastStuckKeys.length &&
      newKeys.every((k, i) => k === lastStuckKeys[i]);

    if (keysMatch) {
      const topsMatch = newTops.every((t, i) => t === lastPositions[i]);
      if (topsMatch) return; // No change

      // Fast path: same keys, different positions — just update style.top + height
      const children = overlayEl.children;
      for (let i = 0; i < children.length; i++) {
        (children[i] as HTMLElement).style.top = newTops[i] + 'px';
      }
      lastPositions = newTops;

      const lastPos = stickyPositions[stickyPositions.length - 1];
      overlayEl.style.height = Math.max(0, lastPos.top + ROW_HEIGHT_DIR) + 'px';
      return;
    }

    // Full re-render
    lastStuckKeys = newKeys;
    lastPositions = newTops;
    overlayEl.innerHTML = '';

    for (let i = 0; i < stickyPositions.length; i++) {
      const sp = stickyPositions[i];
      const el = renderRow(sp.row);
      el.style.position = 'absolute';
      el.style.top = sp.top + 'px';
      el.style.left = '0';
      el.style.right = '0';
      el.style.height = ROW_HEIGHT_DIR + 'px';

      const dirRowDiv = el.querySelector('.dir-row') as HTMLElement | null;
      if (dirRowDiv) {
        dirRowDiv.classList.add('sticky-dir', 'is-stuck');
        if (i === stickyPositions.length - 1) {
          dirRowDiv.classList.add('is-stuck-bottom');
        }
      }

      overlayEl.appendChild(el);
    }

    const lastPos = stickyPositions[stickyPositions.length - 1];
    overlayEl.style.height = Math.max(0, lastPos.top + ROW_HEIGHT_DIR) + 'px';
  }

  function setEnabled(en: boolean): void {
    enabled = en;
    if (!enabled) clearOverlay();
  }

  return {
    update,
    hasStuckRows: () => lastStuckKeys.length > 0,
    setEnabled,
    destroy: () => overlayEl.remove(),
  };
}
