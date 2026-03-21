// Sticky header overlay for virtual scrolling in the tab view.
// Replaces CSS position:sticky with a JS-driven overlay that shows
// ancestor directory rows at the top of the scroll viewport.

import { h } from '../h';
import type { FlatRow, DirFlatRow } from './types';

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

export function createStickyOverlay(config: StickyOverlayConfig): StickyOverlay {
  const { container, renderRow } = config;

  // Create the overlay div
  const overlayEl = h('div', { className: 'virtual-sticky-overlay' });
  // Insert at the top of the container, before any tree
  container.insertBefore(overlayEl, container.firstChild);

  let enabled = true;
  let lastStuckKeys: string[] = [];

  /**
   * Determine which ancestor dirs should be stuck at the top of the viewport.
   *
   * Algorithm:
   * 1. Find the first visible content row (the row at visibleStart).
   * 2. Walk its ancestors array — each ancestor path represents a directory
   *    that contains the current view.
   * 3. For each ancestor, find the corresponding DirFlatRow in the flat list
   *    whose node.path matches. If that row's offsetY is above the current
   *    scroll position, it's a stuck ancestor.
   * 4. Render those stuck ancestors into the overlay.
   */
  function update(flatRows: FlatRow[], visibleStart: number): void {
    if (!enabled || flatRows.length === 0) {
      if (lastStuckKeys.length > 0) {
        overlayEl.innerHTML = '';
        lastStuckKeys = [];
      }
      return;
    }

    // Find the first content row at or after visibleStart
    let contentRow: FlatRow | null = null;
    for (let i = visibleStart; i < flatRows.length; i++) {
      const row = flatRows[i];
      if (row.type !== 'workspaceHeader') {
        contentRow = row;
        break;
      }
    }
    if (!contentRow) {
      if (lastStuckKeys.length > 0) {
        overlayEl.innerHTML = '';
        lastStuckKeys = [];
      }
      return;
    }

    // Get the ancestors of this row
    const ancestors = 'ancestors' in contentRow ? contentRow.ancestors : [];
    if (ancestors.length === 0) {
      if (lastStuckKeys.length > 0) {
        overlayEl.innerHTML = '';
        lastStuckKeys = [];
      }
      return;
    }

    const scrollTop = container.scrollTop;

    // Build set of ancestor paths for quick lookup
    const ancestorPaths = new Set(ancestors.filter(a => a != null).map(a => a.path));

    // Find the DirFlatRows for these ancestors that are above the scroll position.
    // We only need to scan rows before visibleStart (they're above the viewport).
    const stuckRows: DirFlatRow[] = [];
    for (let i = 0; i < flatRows.length; i++) {
      const row = flatRows[i];
      if (row.type === 'dir' && ancestorPaths.has(row.node.path)) {
        // This dir is an ancestor — check if it's scrolled above the viewport
        if (row.offsetY <= scrollTop) {
          stuckRows.push(row);
        }
        ancestorPaths.delete(row.node.path);
        if (ancestorPaths.size === 0) break;
      }
      // Stop scanning once we're past the visible start
      if (row.offsetY >= scrollTop && ancestorPaths.size === 0) break;
    }

    // Check if stuck set changed
    const stuckKeys = stuckRows.map(r => r.key);
    if (stuckKeys.length === lastStuckKeys.length &&
        stuckKeys.every((k, i) => k === lastStuckKeys[i])) {
      return; // No change
    }

    lastStuckKeys = stuckKeys;

    // Re-render the overlay
    overlayEl.innerHTML = '';
    for (let i = 0; i < stuckRows.length; i++) {
      const row = stuckRows[i];
      const el = renderRow(row);
      // Remove absolute positioning from scroller
      el.style.position = '';
      el.style.top = '';
      el.style.left = '';
      el.style.right = '';
      // Add stuck classes
      const dirRowDiv = el.querySelector('.dir-row') as HTMLElement | null;
      if (dirRowDiv) {
        dirRowDiv.classList.add('sticky-dir', 'is-stuck');
        if (i === stuckRows.length - 1) {
          dirRowDiv.classList.add('is-stuck-bottom');
        }
      }
      overlayEl.appendChild(el);
    }

    // Cancel the overlay's flow contribution with a negative margin so the
    // tree below stays at a fixed position regardless of overlay content.
    // This prevents scroll-anchoring adjustments that cause oscillation.
    // Use offsetHeight (rendered box height) not scrollHeight (which includes
    // overflow from the ::after shadow pseudo-element).
    const contentHeight = overlayEl.offsetHeight;
    overlayEl.style.marginBottom = contentHeight > 0 ? -contentHeight + 'px' : '';
  }

  function setEnabled(en: boolean): void {
    enabled = en;
    if (!enabled) {
      overlayEl.innerHTML = '';
      lastStuckKeys = [];
    }
  }

  function destroy(): void {
    overlayEl.remove();
  }

  function hasStuckRows(): boolean {
    return lastStuckKeys.length > 0;
  }

  return { update, hasStuckRows, setEnabled, destroy };
}
