// Debug eval bridge and sticky header tracking setup.
// Self-contained — only needs types.

import type { VsCodeApi, StickyTracking } from './types';

// Sets up the cross-frame debug eval bridge for a webview.
// Call once per webview entry point (main.ts, tab.ts, languages.ts) after
// acquireVsCodeApi(). Registers an independent message listener so the bridge works in
// all webviews regardless of whether they use createMessageHandler.
//
// Security: triple-gated in dev mode only —
//   (1) call sites guard with if (DEV_MODE) — esbuild strips in production
//   (2) requires data-debug body attribute (set by buildWebviewHtml only when debug=true)
//   (3) requires 'unsafe-eval' in CSP (set by buildWebviewHtml only when debug=true)
export function setupDebugEval(vscode: VsCodeApi): void {
  if (!document.body.hasAttribute('data-debug')) { return; }
  window.addEventListener('message', function (event: MessageEvent) {
    const message = event.data;
    if (message.type !== 'debugEval') { return; }
    const id = message.id;
    try {
      // eslint-disable-next-line no-eval
      const result = eval(message.script);
      const serialized = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
      vscode.postMessage({ command: 'debugEvalResult', id, result: serialized });
      // Also post to parent frame so CDP renderer tools can read results.
      window.parent.postMessage({ type: 'dirview-debug-result', id, result: serialized }, '*');
    } catch (err) {
      const errStr = String(err);
      vscode.postMessage({ command: 'debugEvalResult', id, error: errStr });
      window.parent.postMessage({ type: 'dirview-debug-result', id, error: errStr }, '*');
    }
  });
}

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
    const isDocRoot = scrollRoot === document.documentElement;
    const stickyEls = scrollRoot.querySelectorAll('.sticky-dir');
    // For document.documentElement, getBoundingClientRect().top moves with scroll
    // and is useless as a reference. Use 0 (viewport top) instead.
    const containerTop = isDocRoot ? 0 : scrollRoot.getBoundingClientRect().top;
    let lastStuck: Element | null = null;
    for (const el of stickyEls) {
      const rect = el.getBoundingClientRect();
      const depth = parseInt((el as HTMLElement).style.getPropertyValue('--depth')) || 0;
      const stickyTop = containerTop + depth * 22;
      // An element is truly stuck when:
      //   1. CSS sticky is holding it — parent <li> has scrolled above the row (liTop < rectTop)
      //   2. It's at its sticky offset — rectTop ~ stickyTop (not scrolled off-screen)
      // Both conditions are needed: (1) alone catches off-screen elements whose <li>
      // extends above them; (2) alone catches elements at their natural position.
      const parentLi = el.parentElement;
      const liTop = parentLi ? parentLi.getBoundingClientRect().top : rect.top;
      const heldBySticky = liTop < rect.top - 1;
      const atOffset = rect.top >= stickyTop - 2 && rect.top <= stickyTop + 2;
      const isStuck = heldBySticky && atOffset;
      el.classList.toggle('is-stuck', isStuck);
      el.classList.remove('is-stuck-bottom');
      if (isStuck) { lastStuck = el; }
    }
    if (lastStuck) { lastStuck.classList.add('is-stuck-bottom'); }
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
