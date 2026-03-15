// Sticky header tracking setup.

import type { StickyTracking } from './types';

/**
 * Sets up sticky directory header tracking for a scrollable container.
 * Returns an object with `updateStuck` (to recalculate sticky state) and
 * `setEnabled` (to toggle sticky headers on/off).
 *
 * When disabled, adds 'sticky-disabled' to document.body and clears all
 * is-stuck / is-stuck-bottom classes. When enabled, removes the class and
 * recalculates sticky state.
 */
export function setupStickyTracking(scrollRoot: HTMLElement): StickyTracking {
  function updateStuck(): void {
    if (document.body.classList.contains('sticky-disabled')) { return; }
    // Find all sticky-dir elements and update their is-stuck / is-stuck-bottom state
    // based on their current position relative to the scroll container.
    // Each element sticks at its depth-based offset (depth * 22px from container top),
    // so the stuck check must account for the element's --depth CSS variable.
    //
    // Three states for a sticky element:
    //   1. Natural: rect.top > stickyTop (hasn't reached its sticky offset yet)
    //   2. Stuck:   rect.top ~ stickyTop (held at its sticky offset by CSS)
    //   3. Leaving: rect.top < stickyTop (parent <li> scrolled past, dragging it up)
    // Only state 2 counts as "stuck" for is-stuck-bottom purposes.
    //
    // Read/write batching: all getBoundingClientRect() calls happen in the read phase,
    // then all classList mutations happen in the write phase. This prevents layout
    // thrashing (interleaved reads+writes that force the browser to reflow per element).
    const isDocRoot = scrollRoot === document.documentElement;
    const stickyEls = scrollRoot.querySelectorAll('.sticky-dir');
    const containerTop = isDocRoot ? 0 : scrollRoot.getBoundingClientRect().top;

    // ── Read phase: measure all positions ────────────────────────────────
    const measurements: Array<{ el: Element; isStuck: boolean }> = [];
    let lastStuckIdx = -1;
    for (let i = 0; i < stickyEls.length; i++) {
      const el = stickyEls[i];
      const rect = el.getBoundingClientRect();
      const depth = parseInt((el as HTMLElement).style.getPropertyValue('--depth')) || 0;
      const stickyTop = containerTop + depth * 22;
      const parentLi = el.parentElement;
      const liTop = parentLi ? parentLi.getBoundingClientRect().top : rect.top;
      const heldBySticky = liTop < rect.top - 1;
      const atOffset = rect.top >= stickyTop - 2 && rect.top <= stickyTop + 2;
      const isStuck = heldBySticky && atOffset;
      measurements.push({ el, isStuck });
      if (isStuck) { lastStuckIdx = i; }
    }

    // ── Write phase: apply all class changes ─────────────────────────────
    for (let i = 0; i < measurements.length; i++) {
      const { el, isStuck } = measurements[i];
      el.classList.toggle('is-stuck', isStuck);
      el.classList.toggle('is-stuck-bottom', i === lastStuckIdx);
    }
  }

  function setEnabled(enabled: boolean): void {
    document.body.classList.toggle('sticky-disabled', !enabled);
    if (!enabled) {
      // Clear all stuck classes when disabling
      const stickyEls = scrollRoot.querySelectorAll('.sticky-dir');
      for (const el of stickyEls) {
        el.classList.remove('is-stuck', 'is-stuck-bottom');
      }
    } else {
      updateStuck();
    }
  }

  // For document.documentElement, scroll events fire on the window, not the element.
  const scrollTarget: HTMLElement | Window = scrollRoot === document.documentElement ? window : scrollRoot;
  scrollTarget.addEventListener('scroll', updateStuck, { passive: true });

  return { updateStuck, setEnabled };
}
