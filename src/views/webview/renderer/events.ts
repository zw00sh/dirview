// Delegated event handlers for the tree renderer.
// Extracted from createRenderer to keep the main file focused on rendering logic.

import { compactedNode, compactedPath, hasExpandedDescendant, escHtml, formatBytes, formatLines } from '../utils';
import { walkExpand, walkCollapse } from '../state';
import type { DirNode, RendererContext } from '../types';

// Sets up all delegated event listeners on the root container element.
// Instead of attaching 3-6 listeners to each rendered row, we use delegated
// handlers on the root container (plus capture-phase guide highlighters).
// This eliminates thousands of closure allocations and GC cycles per render on large trees.
export function setupDelegatedEvents(ctx: RendererContext): void {
  const { root, tooltip, state, vscode, deps, nodeMap } = ctx;

  // Delegated mouseenter/mouseleave for indent guide hover highlighting.
  // Using capture phase so mouseenter/mouseleave fire for all descendants.
  root.addEventListener('mouseenter', (e: MouseEvent) => {
    const guide = (e.target as HTMLElement).closest('.indent-guide[data-guide-path]') as HTMLElement | null;
    if (!guide) { return; }
    const path = guide.dataset.guidePath;
    document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(path!)}"]`)
      .forEach(el => el.classList.add('hovered'));
  }, true);
  root.addEventListener('mouseleave', (e: MouseEvent) => {
    const guide = (e.target as HTMLElement).closest('.indent-guide[data-guide-path]') as HTMLElement | null;
    if (!guide) { return; }
    const path = guide.dataset.guidePath;
    document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(path!)}"]`)
      .forEach(el => el.classList.remove('hovered'));
  }, true);

  // Delegated click: handles guide collapse, dir-action buttons, dir row toggle, file open.
  root.addEventListener('click', (e: MouseEvent) => {
    // Action elements (buttons, guide spans) take priority — check them first so they
    // don't also trigger the parent dir-row toggle.
    const actionEl = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (actionEl) {
      const action = actionEl.dataset.action;
      const path = actionEl.dataset.path;

      if (action === 'collapseGuide') {
        if (state.activeFilters.size > 0) { return; }
        const guidePath = actionEl.dataset.guidePath;
        if (!guidePath) { return; }
        // If this guide belongs to a file with inline matches (not a directory),
        // toggle the match collapse state instead of the expand/collapse tree state.
        if (actionEl.dataset.guideIsFileMatch) {
          if (state.matchesCollapsed.has(guidePath)) {
            state.matchesCollapsed.delete(guidePath);
          } else {
            state.matchesCollapsed.add(guidePath);
            state.truncationExpanded.delete(guidePath);
          }
        } else {
          state.expanded.set(guidePath, false);
        }
        state.rerender();
        return;
      }

      if (action === 'openFile') {
        vscode.postMessage({ command: 'openFile', path: path! });
        return;
      }

      if (action === 'openFileAtLine') {
        vscode.postMessage({ command: 'openFile', path: path!, line: parseInt(actionEl.dataset.line!, 10) });
        return;
      }

      tooltip.style.display = 'none';

      if (action === 'expandDir') {
        const entry = nodeMap.get(path!);
        if (!entry) { return; }
        const node = entry.node as DirNode;
        const isFiltered = state._isFiltered;
        const isExp = state.expanded.get(node.path) ?? isFiltered;
        if (!isExp) {
          state.expanded.set(node.path, true);
        } else {
          const allDirectChildrenExpanded = node.children.every((child: DirNode) => {
            const cn = compactedNode(child);
            return cn.children.length === 0 || (state.expanded.get(cn.path) ?? isFiltered);
          });
          if (allDirectChildrenExpanded) {
            walkExpand(state, node.children);
          } else {
            for (const child of node.children) {
              state.expanded.set(compactedPath(child), true);
            }
          }
        }
        state.rerender();
        return;
      }

      if (action === 'collapseDir') {
        const entry = nodeMap.get(path!);
        if (!entry) { return; }
        const node = entry.node as DirNode;
        const isFiltered = state._isFiltered;
        if (!(state.expanded.get(node.path) ?? isFiltered)) { return; }
        const anyChildExpanded = node.children.some((child: DirNode) => state.expanded.get(compactedPath(child)) ?? isFiltered);
        if (anyChildExpanded) {
          const anyDeeperExpanded = node.children.some((child: DirNode) => {
            const cn = compactedNode(child);
            return hasExpandedDescendant(state, cn, isFiltered);
          });
          if (anyDeeperExpanded) {
            for (const child of node.children) {
              const cn = compactedNode(child);
              walkCollapse(state, cn.children || []);
            }
          } else {
            for (const child of node.children) {
              state.expanded.set(compactedPath(child), false);
            }
          }
        } else {
          state.expanded.set(node.path, false);
        }
        state.rerender();
        return;
      }

      if (action === 'openInTab') {
        vscode.postMessage({ command: 'openDirInTab', path: path! });
        return;
      }

      if (action === 'expandTruncated') {
        const dp = actionEl.dataset.dirPath;
        if (dp != null) {
          state.truncationExpanded.add(dp);
          state.rerender();
        }
        return;
      }

      return;
    }

    // File-row toggle for files with inline matches — clicking outside the filename
    // collapses/expands the match group for that file.
    const hasMatchesRow = (e.target as HTMLElement).closest('.file-row.has-matches') as HTMLElement | null;
    if (hasMatchesRow && !(e.target as HTMLElement).closest('[data-action]')) {
      const filePath = hasMatchesRow.dataset.path;
      if (filePath) {
        if (state.matchesCollapsed.has(filePath)) {
          state.matchesCollapsed.delete(filePath);
        } else {
          state.matchesCollapsed.add(filePath);
          // Reset match truncation when collapsing so it re-truncates on next expand.
          state.truncationExpanded.delete(filePath);
        }
        state.rerender();
      }
      return;
    }

    // Dir-name click → navigate (tab mode only; onNavigate is not set in sidebar).
    if (deps.onNavigate) {
      const dirNameEl = (e.target as HTMLElement).closest('.dir-name') as HTMLElement | null;
      if (dirNameEl) {
        const parentDirRow = dirNameEl.closest('.dir-row[data-path]') as HTMLElement | null;
        if (parentDirRow) { deps.onNavigate(parentDirRow.dataset.path!); return; }
      }
    }

    // Dir row toggle (expand/collapse) — only when click is not on an action element.
    const dirRow = (e.target as HTMLElement).closest('.dir-row[data-path]') as HTMLElement | null;
    if (dirRow) {
      // Ignore the second click of a double-click. After an action button (e.g. expand)
      // triggers a rerender, the rebuilt dir-row loses hover state so its action buttons
      // become display:none. The second click then lands on the dir-row itself and would
      // toggle the directory back — undoing the action. e.detail >= 2 catches this.
      if (e.detail >= 2) { return; }
      const path = dirRow.dataset.path!;
      const entry = nodeMap.get(path);
      if (!entry) { return; }

      // Account for filtered/search mode where dirs without an explicit expanded
      // entry are implicitly expanded (matching the renderer's isExpanded logic).
      const isFiltered = state._isFiltered;
      const currentlyExpanded = state.expanded.get(path) ?? isFiltered;
      const nowExpanded = !currentlyExpanded;
      state.expanded.set(path, nowExpanded);

      // Reset truncation when collapsing so it re-truncates on next expand.
      if (!nowExpanded && state.truncationExpanded.has(path)) {
        state.truncationExpanded.delete(path);
        state.rerender();
        return;
      }

      const chevron = dirRow.querySelector('.chevron');
      // In nested DOM mode, the dir-row's parent <li> has a sibling <ul class="children">.
      // In virtual scroll mode (flat rows), there's no children <ul> — always rerender.
      const parentLi = dirRow.parentElement;
      const childrenEl = parentLi?.querySelector(':scope > ul.children') as HTMLElement | null;

      // No children element (virtual scroll) or lazy-rendered empty children — full rerender.
      if (!childrenEl || (nowExpanded && !childrenEl.firstChild)) {
        state.rerender();
        if (deps.onExpandChanged) {
          deps.onExpandChanged([...state.expanded.values()].some(v => v));
        }
        return;
      }

      if (chevron) { chevron.className = 'chevron' + (nowExpanded ? ' open' : ''); }
      childrenEl.className = 'children' + (nowExpanded ? ' open' : '');

      if (deps.onExpandChanged) {
        deps.onExpandChanged([...state.expanded.values()].some(v => v));
      }
    }
  });

  // Delegated tooltip: show on mouseover the bar area, hide on mouseout.
  // Using mouseover/mouseout (bubbling) instead of per-row mouseenter/mouseleave.
  root.addEventListener('mouseover', (e: MouseEvent) => {
    // Only trigger on the bar-wrap (bar + its padding) or bar-spacer, not the whole row.
    const barArea = (e.target as HTMLElement).closest('.bar-wrap, .bar-spacer') as HTMLElement | null;
    if (!barArea) { return; }
    const row = barArea.closest('.dir-row[data-path]') as HTMLElement | null;
    if (!row) { return; }
    // Avoid re-triggering when moving between child elements within the bar area.
    if (e.relatedTarget && barArea.contains(e.relatedTarget as Node)) { return; }

    const path = row.dataset.path!;
    const entry = nodeMap.get(path);
    if (!entry || !entry.node.totalFiles) { tooltip.style.display = 'none'; return; }

    const node = entry.node;
    // Populate tooltip content — metric-aware based on sort mode.
    tooltip.innerHTML = '';
    const sm = state.currentSortMode;
    for (const s of node.stats) {
      let pctStr: string;
      let countStr: string;
      if (sm === 'lines' && node.totalLines > 0) {
        pctStr = ((s.lineCount / node.totalLines) * 100).toFixed(1).replace(/\.0$/, '') + '%';
        countStr = formatLines(s.lineCount) + ' line' + (s.lineCount !== 1 ? 's' : '');
      } else if (sm === 'size' && node.sizeBytes > 0) {
        pctStr = ((s.sizeBytes / node.sizeBytes) * 100).toFixed(1).replace(/\.0$/, '') + '%';
        countStr = formatBytes(s.sizeBytes);
      } else {
        const total = node.totalFiles;
        pctStr = total > 0 ? ((s.count / total) * 100).toFixed(1).replace(/\.0$/, '') + '%' : '0%';
        countStr = s.count + ' file' + (s.count !== 1 ? 's' : '');
      }
      const tRow = document.createElement('div');
      tRow.className = 'bar-tooltip-row';
      tRow.innerHTML =
        `<span class="bar-tooltip-swatch" style="background:${s.color}"></span>` +
        `<span class="bar-tooltip-name">${escHtml(s.name)}</span>` +
        `<span class="bar-tooltip-pct">${pctStr}</span>` +
        `<span class="bar-tooltip-count">${countStr}</span>`;
      tooltip.appendChild(tRow);
    }

    // --- Read phase (batch before writes) ---
    const bar = row.querySelector('.bar');
    if (!bar) { return; }
    const rect = bar.getBoundingClientRect();
    const vpWidth = document.documentElement.clientWidth;
    const wh = window.innerHeight;

    // --- Write phase: initial position + show ---
    const initLeft = rect.left;
    const initTop = rect.bottom + 4;
    tooltip.style.left = initLeft + 'px';
    tooltip.style.top = initTop + 'px';
    tooltip.style.display = 'block';

    // --- Deferred adjustment: read tooltip rect in next frame to avoid layout thrash ---
    requestAnimationFrame(() => {
      if (tooltip.style.display === 'none') { return; }
      const tRect = tooltip.getBoundingClientRect();
      let newLeft = initLeft, newTop = initTop, changed = false;
      if (tRect.bottom > wh) { newTop = rect.top - tRect.height - 4; changed = true; }
      if (tRect.right > vpWidth - 4) { newLeft = Math.max(4, vpWidth - tRect.width - 4); changed = true; }
      if (changed) { tooltip.style.left = newLeft + 'px'; tooltip.style.top = newTop + 'px'; }
    });
  });

  root.addEventListener('mouseout', (e: MouseEvent) => {
    const barArea = (e.target as HTMLElement).closest('.bar-wrap, .bar-spacer') as HTMLElement | null;
    if (barArea && !barArea.contains(e.relatedTarget as Node)) {
      // Also keep tooltip if moving to the adjacent bar-spacer/bar-wrap within the same row.
      const row = barArea.closest('.dir-row[data-path]');
      const relTarget = e.relatedTarget as HTMLElement | null;
      if (row && relTarget && row.contains(relTarget) && relTarget.closest('.bar-wrap, .bar-spacer')) {
        return;
      }
      tooltip.style.display = 'none';
    }
  });

  // Hide tooltip when the tree scrolls (rows move away from the cursor without firing mouseout).
  root.addEventListener('scroll', () => { tooltip.style.display = 'none'; }, { passive: true });
}
