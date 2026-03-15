// DOM patching utilities for incremental tree updates.
// Self-contained — no imports from other shared modules needed.

// ── Incremental DOM patching ─────────────────────────────────────────────
//
// On file-change rescans the tree structure is typically stable (same directories,
// same files, possibly different counts/bar widths). patchTreeChildren/patchDirLi
// reuse existing <li> DOM nodes rather than replacing the whole tree, which:
//   * Preserves scroll position (no parent innerHTML wipe)
//   * Avoids visual flicker for unchanged nodes
//   * Updates only what changed (bar widths, file counts)
//
// Each <li> produced by renderDirNode carries data-node-path so matching is O(1).

/**
 * Patches oldEl's direct children to match newEl's, keyed by data-node-path.
 * Keyed nodes (dirs) are updated in-place via patchDirLi; unkeyed nodes (file
 * rows, truncated rows, empty-group rows, workspace headers) are replaced
 * wholesale.  The reconciled list is built in a DocumentFragment and swapped
 * in one shot so only a single reflow occurs.
 */
export function patchTreeChildren(oldEl: HTMLElement, newEl: HTMLElement): void {
  // Index existing keyed children for O(1) lookup.
  const oldByPath = new Map<string, Element>();
  for (const child of oldEl.children) {
    const p = (child as HTMLElement).dataset.nodePath;
    if (p !== undefined) { oldByPath.set(p, child); }
  }

  // Build the reconciled child list: reuse matched old dir nodes, take new
  // nodes for everything else (files, truncated rows, headers, new dirs).
  const fragment = document.createDocumentFragment();
  for (const newChild of [...newEl.children]) {
    const p = (newChild as HTMLElement).dataset.nodePath;
    const oldChild = (p !== undefined) ? oldByPath.get(p) : undefined;

    if (oldChild) {
      oldByPath.delete(p!);
      if (oldChild.querySelector(':scope > .dir-row')) {
        // Dir node: update bar/count in place and recurse into children UL.
        patchDirLi(oldChild as HTMLElement, newChild as HTMLElement);
        fragment.appendChild(oldChild);
      } else {
        // Non-dir keyed node (match line, file row): replace unconditionally.
        // Content can change when syntax highlight patches arrive after the plain-text batch.
        fragment.appendChild(newChild);
      }
    } else {
      fragment.appendChild(newChild);
    }
  }

  // Replace all children at once — drops stale/unkeyed old nodes, preserves
  // the parent element identity (and therefore scroll position).
  while (oldEl.firstChild) { oldEl.removeChild(oldEl.firstChild); }
  oldEl.appendChild(fragment);
}

/**
 * Updates a single dir <li> in place: bar width/segments, file count, and
 * recurses into the children <ul>. Non-structural changes only (hover actions,
 * chevron state, dir name are left as-is since they don't change on rescan).
 */
export function patchDirLi(oldLi: HTMLElement, newLi: HTMLElement): void {
  const oldRow = oldLi.querySelector(':scope > .dir-row') as HTMLElement | null;
  const newRow = newLi.querySelector(':scope > .dir-row') as HTMLElement | null;
  if (oldRow && newRow) {
    // Update bar-wrap width and segment colors/widths.
    const oldBarWrap = oldRow.querySelector('.bar-wrap') as HTMLElement | null;
    const newBarWrap = newRow.querySelector('.bar-wrap') as HTMLElement | null;
    if (oldBarWrap && newBarWrap) {
      oldBarWrap.style.width = newBarWrap.style.width;
      const oldBar = oldBarWrap.querySelector('.bar');
      const newBar = newBarWrap.querySelector('.bar');
      // Replace bar segments in one shot — they are small and cheap to recreate.
      if (oldBar && newBar) { oldBar.replaceWith(newBar); }
    } else if (!oldBarWrap && newBarWrap) {
      // Dir went from 0 files to >0 — insert bar before file-count.
      const countEl = oldRow.querySelector('.file-count');
      if (countEl) { countEl.before(newBarWrap); }
      else { oldRow.appendChild(newBarWrap); }
    } else if (oldBarWrap && !newBarWrap) {
      // Dir went to 0 files — remove bar.
      oldBarWrap.remove();
    }

    // Update file count text, title, and inline style (opacity for empty dirs).
    const oldCount = oldRow.querySelector('.file-count') as HTMLElement | null;
    const newCount = newRow.querySelector('.file-count') as HTMLElement | null;
    if (oldCount && newCount) {
      oldCount.textContent = newCount.textContent;
      oldCount.title = newCount.title;
      // Preserve width — it will be re-equalized after patching.
      oldCount.style.cssText = newCount.style.cssText;
      oldCount.style.width = '';
    }
  }

  // Reconcile children <ul> — the open/closed class may have changed, and the
  // children themselves may have been added, removed, or reordered.
  const oldChildren = oldLi.querySelector(':scope > ul.children') as HTMLElement | null;
  const newChildren = newLi.querySelector(':scope > ul.children') as HTMLElement | null;
  if (oldChildren && newChildren) {
    oldChildren.className = newChildren.className;
    patchTreeChildren(oldChildren, newChildren);
  } else if (!oldChildren && newChildren) {
    oldLi.appendChild(newChildren);
  } else if (oldChildren && !newChildren) {
    oldChildren.remove();
  }
}
