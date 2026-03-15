// @ts-check
// Core tree renderer for dirview webviews.
// Exposes window._DirviewRenderer — loaded after shared-icons.js, shared-utils.js, shared-state.js.
(function () {
  'use strict';

  const MAX_MATCH_LINES = 5;
  const MAX_MATCH_LINE_DISPLAY = 120;

  /** Trims leading whitespace from a raw line and adjusts the match column accordingly.
   *  Must stay in sync with trimLeadingWhitespace in highlighter.ts. */
  function trimLeadingWhitespace(rawText, col) {
    const trimmedStart = rawText.length - rawText.trimStart().length;
    return { lineText: rawText.trimStart(), adjustedCol: Math.max(0, col - trimmedStart) };
  }

  /** Returns { start, end } visible window when lineLength > maxDisplay, or null if it fits.
   *  Must stay in sync with computeVisibleWindow in highlighter.ts. */
  function computeVisibleWindow(lineLength, col, matchLen, maxDisplay) {
    if (lineLength <= maxDisplay) { return null; }
    const half = Math.floor((maxDisplay - matchLen) / 2);
    return { start: Math.max(0, col - half), end: Math.min(lineLength, col + matchLen + half) };
  }

  const { SVG_CHEVRON, SVG_PLUS, SVG_EXPAND_ALL, SVG_COLLAPSE_ALL, SVG_OPEN_IN_TAB } = window._DirviewIcons;
  const {
    escHtml, formatBytes, sortDirs, sortFiles, groupEmptyDirs,
    compactedNode, compactedPath, hasExpandedDescendant,
    getVisibleChildren, getVisibleFiles, computeBarWidth,
  } = window._DirviewUtils;
  const { walkExpand, walkCollapse } = window._DirviewState;

  // Creates render helpers bound to a mutable state object.
  //
  // state: {
  //   activeFilters: Set, expanded: Map, truncationExpanded: Set,
  //   emptyGroupExpanded: Set, truncateThreshold: number,
  //   currentSortMode: string, lastRoots: array|null,
  //   lastAutoRescanEnabled: boolean, render: function|null
  // }
  //
  // deps: {
  //   vscode: object, root: HTMLElement, tooltip: HTMLElement,
  //   options: {
  //     skipDepthZeroGuides: boolean,  // true=sidebar, false=tab
  //     barFactor: number,             // fraction of clientWidth for max bar
  //     barMaxWidth: number,           // absolute max bar width (px)
  //     barFallbackWidth: number,      // fallback when clientWidth is 0
  //   }
  // }
  function createRenderer(state, deps) {
    const { vscode, root, tooltip } = deps;
    const opts = deps.options || {};

    // Map from displayNode.path → { node: DirNode, hasChildren: boolean }.
    // Populated during renderDirNode calls; cleared by beforeRender() at the start of
    // each full re-render. Used by delegated event handlers to avoid per-element closures.
    const nodeMap = new Map();

    // ── Delegated event handlers ─────────────────────────────────────────────
    //
    // Instead of attaching 3–6 listeners to each rendered row, we use three delegated
    // handlers on the root container (plus the existing capture-phase guide highlighters).
    // This eliminates thousands of closure allocations and GC cycles per render on large trees.

    // Delegated mouseenter/mouseleave for indent guide hover highlighting.
    // Using capture phase so mouseenter/mouseleave fire for all descendants.
    root.addEventListener('mouseenter', (e) => {
      const guide = e.target.closest('.indent-guide[data-guide-path]');
      if (!guide) { return; }
      const path = guide.dataset.guidePath;
      document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(path)}"]`)
        .forEach(el => el.classList.add('hovered'));
    }, true);
    root.addEventListener('mouseleave', (e) => {
      const guide = e.target.closest('.indent-guide[data-guide-path]');
      if (!guide) { return; }
      const path = guide.dataset.guidePath;
      document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(path)}"]`)
        .forEach(el => el.classList.remove('hovered'));
    }, true);

    // Delegated click: handles guide collapse, dir-action buttons, dir row toggle, file open.
    root.addEventListener('click', (e) => {
      // Action elements (buttons, guide spans) take priority — check them first so they
      // don't also trigger the parent dir-row toggle.
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.dataset.action;
        const path = actionEl.dataset.path;

        if (action === 'collapseGuide') {
          if (state.activeFilters.size > 0) { return; }
          const guidePath = actionEl.dataset.guidePath;
          if (!guidePath) { return; }
          state.expanded.set(guidePath, false);
          state.rerender();
          return;
        }

        if (action === 'openFile') {
          vscode.postMessage({ command: 'openFile', path });
          return;
        }

        if (action === 'openFileAtLine') {
          vscode.postMessage({ command: 'openFile', path, line: parseInt(actionEl.dataset.line, 10) });
          return;
        }

        tooltip.style.display = 'none';

        if (action === 'expandDir') {
          const entry = nodeMap.get(path);
          if (!entry) { return; }
          const node = entry.node;
          const isExp = state.expanded.get(node.path);
          if (!isExp) {
            state.expanded.set(node.path, true);
          } else {
            const allDirectChildrenExpanded = node.children.every(child => {
              const cn = compactedNode(child);
              return cn.children.length === 0 || state.expanded.get(cn.path);
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
          const entry = nodeMap.get(path);
          if (!entry) { return; }
          const node = entry.node;
          if (!state.expanded.get(node.path)) { return; }
          const anyChildExpanded = node.children.some(child => state.expanded.get(compactedPath(child)));
          if (anyChildExpanded) {
            const anyDeeperExpanded = node.children.some(child => {
              const cn = compactedNode(child);
              return hasExpandedDescendant(state, cn);
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
          vscode.postMessage({ command: 'openDirInTab', path });
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

        if (action === 'expandEmptyGroup') {
          const gk = actionEl.dataset.groupKey;
          if (gk != null) {
            state.emptyGroupExpanded.add(gk);
            state.rerender();
          }
          return;
        }

        return;
      }

      // Dir-name click → navigate (tab mode only; onNavigate is not set in sidebar).
      if (deps.onNavigate) {
        // Breadcrumb ancestor segment: navigate to that specific ancestor path.
        const navSeg = e.target.closest('[data-navigate-path]');
        if (navSeg) { deps.onNavigate(navSeg.dataset.navigatePath); return; }
        // Any dir-name click: navigate to that directory.
        const dirNameEl = e.target.closest('.dir-name');
        if (dirNameEl) {
          const parentDirRow = dirNameEl.closest('.dir-row[data-path]');
          if (parentDirRow) { deps.onNavigate(parentDirRow.dataset.path); return; }
        }
      }

      // Dir row toggle (expand/collapse) — only when click is not on an action element.
      const dirRow = e.target.closest('.dir-row[data-path]');
      if (dirRow) {
        // Ignore the second click of a double-click. After an action button (e.g. expand)
        // triggers a rerender, the rebuilt dir-row loses hover state so its action buttons
        // become display:none. The second click then lands on the dir-row itself and would
        // toggle the directory back — undoing the action. e.detail >= 2 catches this.
        if (e.detail >= 2) { return; }
        const path = dirRow.dataset.path;
        const entry = nodeMap.get(path);
        if (!entry || !entry.hasChildren) { return; }

        const nowExpanded = !state.expanded.get(path);
        state.expanded.set(path, nowExpanded);

        // Reset truncation when collapsing so it re-truncates on next expand.
        if (!nowExpanded && state.truncationExpanded.has(path)) {
          state.truncationExpanded.delete(path);
          state.rerender();
          return;
        }

        const chevron = dirRow.querySelector('.chevron');
        const childrenEl = dirRow.nextElementSibling;

        // Lazy rendering: if expanding and the children UL is empty (was rendered
        // collapsed), we need a full rerender to populate the children DOM.
        if (nowExpanded && childrenEl && !childrenEl.firstChild) {
          state.rerender();
          if (deps.onExpandChanged) {
            deps.onExpandChanged([...state.expanded.values()].some(v => v));
          }
          return;
        }

        if (chevron) { chevron.className = 'chevron' + (nowExpanded ? ' open' : ''); }
        if (childrenEl) { childrenEl.className = 'children' + (nowExpanded ? ' open' : ''); }

        if (deps.onExpandChanged) {
          deps.onExpandChanged([...state.expanded.values()].some(v => v));
        }
      }
    });

    // Delegated tooltip: show on mouseover a dir-row, hide on mouseout.
    // Using mouseover/mouseout (bubbling) instead of per-row mouseenter/mouseleave.
    root.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.dir-row[data-path]');
      if (!row) { return; }
      // Avoid re-triggering when moving between child elements of the same row.
      if (e.relatedTarget && row.contains(e.relatedTarget)) { return; }

      const path = row.dataset.path;
      const entry = nodeMap.get(path);
      if (!entry || !entry.node.totalFiles) { tooltip.style.display = 'none'; return; }

      const node = entry.node;
      // Populate tooltip content.
      tooltip.innerHTML = '';
      const total = node.totalFiles;
      for (const s of node.stats) {
        const segPct = (s.count / total) * 100;
        const tRow = document.createElement('div');
        tRow.className = 'bar-tooltip-row';
        tRow.innerHTML =
          `<span class="bar-tooltip-swatch" style="background:${s.color}"></span>` +
          `<span class="bar-tooltip-name">${escHtml(s.name)}</span>` +
          `<span class="bar-tooltip-pct">${segPct.toFixed(1).replace(/\.0$/, '')}%</span>` +
          `<span class="bar-tooltip-count">${s.count} file${s.count !== 1 ? 's' : ''}</span>`;
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

    root.addEventListener('mouseout', (e) => {
      const row = e.target.closest('.dir-row[data-path]');
      if (row && !row.contains(e.relatedTarget)) {
        tooltip.style.display = 'none';
      }
    });

    // Hide tooltip when the tree scrolls (rows move away from the cursor without firing mouseout).
    root.addEventListener('scroll', () => { tooltip.style.display = 'none'; }, { passive: true });

    function dirMatchesFilter(node) {
      if (state.activeFilters.size === 0) { return true; }
      return node.stats.some(s => state.activeFilters.has(s.name) && s.count > 0);
    }

    function renderIndentGuides(depth, ancestors) {
      const container = document.createElement('span');
      container.className = 'indent-guides';
      for (let i = 0; i < depth; i++) {
        const guide = document.createElement('span');
        guide.className = 'indent-guide';
        const ancestor = ancestors[i];
        if (ancestor) {
          guide.dataset.guidePath = ancestor.path;
          // data-action enables the delegated click handler in createRenderer.
          guide.dataset.action = 'collapseGuide';
        }
        container.appendChild(guide);
      }
      return container;
    }

    // WeakMap cache for search-result matching — reset by beforeRender() each render cycle.
    // Prevents redundant recursive tree walks when the same node is checked multiple times.
    let _searchMatchCache = new WeakMap();

    // Returns true if any descendant file of node has a path in state.searchResults.
    // Short-circuits as soon as a match is found; results are memoized in _searchMatchCache.
    function dirMatchesSearch(node) {
      if (!state.searchResults) { return true; }
      const cached = _searchMatchCache.get(node);
      if (cached !== undefined) { return cached; }
      for (const f of (node.files || [])) {
        if (state.searchResults.has(f.path) &&
          (state.activeFilters.size === 0 || state.activeFilters.has(f.langName))) {
          _searchMatchCache.set(node, true);
          return true;
        }
      }
      for (const c of (node.children || [])) {
        if (dirMatchesSearch(c)) {
          _searchMatchCache.set(node, true);
          return true;
        }
      }
      _searchMatchCache.set(node, false);
      return false;
    }

    // Renders a single match line beneath a file row in search-results mode.
    // file: FileNode (needed for path/line target), match: { line, column, matchLength, lineText }
    function renderMatchLine(file, match, depth, ancestors) {
      const li = document.createElement('li');
      // Stable key for DOM patching — lets patchTreeChildren reuse match-line nodes.
      li.dataset.nodePath = 'match:' + file.path + ':' + match.line + ':' + match.column;
      const row = document.createElement('div');
      row.className = 'match-line-row';
      // data-action + data-path + data-line use the delegated click handler in createRenderer.
      row.dataset.action = 'openFileAtLine';
      row.dataset.path = file.path;
      row.dataset.line = String(match.line);
      row.appendChild(renderIndentGuides(depth, ancestors));

      const lineNumEl = document.createElement('span');
      lineNumEl.className = 'match-line-number';
      lineNumEl.textContent = String(match.line);
      row.appendChild(lineNumEl);

      const textEl = document.createElement('span');
      textEl.className = 'match-line-text';

      if (match.highlightedHtml) {
        // Backend pre-rendered syntax-highlighted HTML; already includes match-highlight span
        // and truncation. Trusted server-generated markup — safe to set as innerHTML.
        textEl.innerHTML = match.highlightedHtml;
      } else {
        // Plain-text fallback: trim leading whitespace, highlight match substring manually.
        const rawText = match.lineText || '';
        const { lineText, adjustedCol: col } = trimLeadingWhitespace(rawText, match.column || 0);
        const len = match.matchLength || 0;
        const win = computeVisibleWindow(lineText.length, col, len, MAX_MATCH_LINE_DISPLAY);

        if (!win) {
          if (len > 0 && col + len <= lineText.length) {
            textEl.appendChild(document.createTextNode(lineText.slice(0, col)));
            const hl = document.createElement('span');
            hl.className = 'match-highlight';
            hl.textContent = lineText.slice(col, col + len);
            textEl.appendChild(hl);
            textEl.appendChild(document.createTextNode(lineText.slice(col + len)));
          } else {
            textEl.textContent = lineText;
          }
        } else {
          // Truncate: show context centered around the match
          const prefix = (win.start > 0 ? '\u2026' : '') + lineText.slice(win.start, col);
          const suffix = lineText.slice(col + len, win.end) + (win.end < lineText.length ? '\u2026' : '');
          textEl.appendChild(document.createTextNode(prefix));
          if (len > 0) {
            const hl = document.createElement('span');
            hl.className = 'match-highlight';
            hl.textContent = lineText.slice(col, col + len);
            textEl.appendChild(hl);
          }
          textEl.appendChild(document.createTextNode(suffix));
        }
      }

      row.appendChild(textEl);
      li.appendChild(row);
      return li;
    }

    // Renders a single context line (surrounding code) beneath a file row in search-results mode.
    // Context lines are dimmed relative to match lines and share the same click behaviour.
    function renderContextLine(file, match, depth, ancestors) {
      const li = document.createElement('li');
      li.dataset.nodePath = 'context:' + file.path + ':' + match.line;
      const row = document.createElement('div');
      row.className = 'match-context-row';
      row.dataset.action = 'openFileAtLine';
      row.dataset.path = file.path;
      row.dataset.line = String(match.line);
      row.appendChild(renderIndentGuides(depth, ancestors));

      const lineNumEl = document.createElement('span');
      lineNumEl.className = 'match-line-number';
      lineNumEl.textContent = String(match.line);
      row.appendChild(lineNumEl);

      const textEl = document.createElement('span');
      textEl.className = 'match-line-text';
      if (match.highlightedHtml) {
        textEl.innerHTML = match.highlightedHtml;
      } else {
        const { lineText } = trimLeadingWhitespace(match.lineText || '', 0);
        textEl.textContent = lineText;
      }
      row.appendChild(textEl);
      li.appendChild(row);
      return li;
    }

    // Renders a "N more matches" summary row when match lines are capped at 5 per file.
    function renderMoreMatchesRow(count, depth, ancestors, filePath) {
      const li = document.createElement('li');
      if (filePath) { li.dataset.nodePath = 'more:' + filePath; }
      const row = document.createElement('div');
      row.className = 'match-more-row';
      row.appendChild(renderIndentGuides(depth, ancestors));
      const label = document.createElement('span');
      label.className = 'match-more-label';
      label.textContent = `${count} more match${count !== 1 ? 'es' : ''}`;
      row.appendChild(label);
      li.appendChild(row);
      return li;
    }

    function renderFileNode(file, depth, ancestors) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'file-row clickable';
      // data-action + data-path enable the delegated click handler in createRenderer.
      row.dataset.action = 'openFile';
      row.dataset.path = file.path;
      row.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'file',
        path: file.path,
        preventDefaultContextMenuItems: true
      }));
      row.appendChild(renderIndentGuides(depth, ancestors));

      const dotSlot = document.createElement('span');
      dotSlot.className = 'chevron';
      const leftDot = document.createElement('span');
      leftDot.className = 'file-dot';
      leftDot.style.backgroundColor = file.langColor;
      leftDot.title = file.langName;
      dotSlot.appendChild(leftDot);
      row.appendChild(dotSlot);

      const nameEl = document.createElement('span');
      nameEl.className = 'file-name';
      nameEl.textContent = file.name;
      nameEl.title = file.path;
      row.appendChild(nameEl);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      const rightDot = document.createElement('span');
      rightDot.className = 'file-dot';
      rightDot.style.backgroundColor = file.langColor;
      rightDot.title = file.langName;
      row.appendChild(rightDot);

      if (!opts.hideCounts) {
        const sizeEl = document.createElement('span');
        sizeEl.className = 'file-count';
        sizeEl.textContent = file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : '';
        row.appendChild(sizeEl);
      }

      li.appendChild(row);
      return li;
    }

    function renderTruncatedRow(hiddenFiles, depth, ancestors, dirPath, maxMetric, clientWidth) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'dir-row truncated-row';
      row.dataset.action = 'expandTruncated';
      row.dataset.dirPath = dirPath;
      // Use a synthetic path so the delegated tooltip handler can look up this row's stats.
      const truncKey = dirPath + '\0truncated';
      row.dataset.path = truncKey;
      row.appendChild(renderIndentGuides(depth, ancestors));

      const slot = document.createElement('span');
      slot.className = 'chevron';
      slot.innerHTML = SVG_PLUS;
      row.appendChild(slot);

      // Colored dots for unique language types among hidden files
      const langMap = new Map();
      for (const f of hiddenFiles) {
        if (f.langName) {
          const ex = langMap.get(f.langName);
          if (ex) { ex.count++; ex.sizeBytes += (f.sizeBytes || 0); }
          else { langMap.set(f.langName, { color: f.langColor, count: 1, sizeBytes: f.sizeBytes || 0 }); }
        }
      }
      const isSizeSort = state.currentSortMode === 'size';
      const langs = Array.from(langMap.entries()).sort((a, b) =>
        isSizeSort ? b[1].sizeBytes - a[1].sizeBytes : b[1].count - a[1].count
      );

      // Register synthetic node for tooltip hover
      nodeMap.set(truncKey, {
        node: {
          totalFiles: hiddenFiles.length,
          stats: langs.map(([name, { color, count, sizeBytes }]) => ({ name, color, count, sizeBytes })),
        },
        hasChildren: false,
      });

      const dotsEl = document.createElement('span');
      dotsEl.className = 'truncated-dots';
      for (const [langName, { color }] of langs.slice(0, 5)) {
        const dot = document.createElement('span');
        dot.className = 'file-dot';
        dot.style.backgroundColor = color;
        dot.title = langName;
        dotsEl.appendChild(dot);
      }
      row.appendChild(dotsEl);

      const label = document.createElement('span');
      label.className = 'dir-name';
      label.textContent = `${hiddenFiles.length} more file${hiddenFiles.length !== 1 ? 's' : ''}`;
      row.appendChild(label);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      // Proportional bar showing language makeup of hidden files
      if (langs.length > 0 && maxMetric > 0) {
        const totalCount = hiddenFiles.length;
        const totalBytes = hiddenFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0);
        const metric = state.currentSortMode === 'size' ? totalBytes : totalCount;
        const pct = metric / maxMetric;
        const barWrapWidth = computeBarWidth(pct, clientWidth, root, opts);

        const barWrap = document.createElement('div');
        barWrap.className = 'bar-wrap';
        barWrap.style.width = barWrapWidth + 'px';

        const bar = document.createElement('div');
        bar.className = 'bar';

        for (const [, { color, count, sizeBytes }] of langs) {
          const segMetric = isSizeSort ? sizeBytes : count;
          const segTotal = isSizeSort ? totalBytes : totalCount;
          const segPct = (segMetric / segTotal) * 100;
          const seg = document.createElement('div');
          seg.className = 'bar-segment';
          seg.style.width = segPct + '%';
          seg.style.backgroundColor = color;
          bar.appendChild(seg);
        }

        barWrap.appendChild(bar);
        row.appendChild(barWrap);
      }

      // Right column: file count or size depending on sort mode
      if (!opts.hideCounts) {
        const totalBytes = hiddenFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0);
        const metaEl = document.createElement('span');
        metaEl.className = 'file-count';
        if (state.currentSortMode === 'size') {
          metaEl.textContent = totalBytes > 0 ? formatBytes(totalBytes) : '';
          metaEl.title = hiddenFiles.length + ' files';
        } else {
          metaEl.textContent = String(hiddenFiles.length);
          metaEl.title = totalBytes > 0 ? formatBytes(totalBytes) : '';
        }
        row.appendChild(metaEl);
      }

      li.appendChild(row);
      return li;
    }

    function renderEmptyGroupNode(nodes, depth, maxMetric, ancestors) {
      const li = document.createElement('li');
      const groupKey = nodes[0].path;

      const row = document.createElement('div');
      row.className = 'dir-row empty-group-row';
      row.dataset.action = 'expandEmptyGroup';
      row.dataset.groupKey = groupKey;
      row.appendChild(renderIndentGuides(depth, ancestors));

      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.innerHTML = SVG_PLUS;
      row.appendChild(chevron);

      const label = document.createElement('span');
      label.className = 'dir-name';
      label.textContent = `${nodes.length} empty director${nodes.length !== 1 ? 'ies' : 'y'}`;
      row.appendChild(label);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      // Always show "—" for empty group rows (visual alignment with other rows)
      const metaEl = document.createElement('span');
      metaEl.className = 'file-count';
      metaEl.textContent = '\u2014';
      metaEl.style.opacity = '0.5';
      row.appendChild(metaEl);

      li.appendChild(row);

      return li;
    }

    function renderDirNode(node, depth, maxMetric, ancestors, clientWidth) {
      const li = document.createElement('li');

      // Compact folders: collapse chain of dirs with exactly 1 child dir and 0 files.
      // Skip sortDirs inside the loop — single-child arrays don't need sorting.
      let displayNode = node;
      let displayName = node.name;
      const compactSegments = [{ name: node.name, path: node.path }];
      while (true) {
        const children = displayNode.children;
        const files = displayNode.files || [];
        let vChildren = state.activeFilters.size > 0
          ? children.filter(c => dirMatchesFilter(c))
          : children;
        let vFiles = state.activeFilters.size > 0
          ? files.filter(f => state.activeFilters.has(f.langName))
          : files;
        // Also apply search filter when active — only compact through dirs with a single matching child.
        if (state.searchResults) {
          vChildren = vChildren.filter(c => dirMatchesSearch(c));
          vFiles = vFiles.filter(f => state.searchResults.has(f.path));
        }
        if (vChildren.length === 1 && vFiles.length === 0) {
          displayName += ' / ' + vChildren[0].name;
          compactSegments.push({ name: vChildren[0].name, path: vChildren[0].path });
          displayNode = vChildren[0];
        } else {
          break;
        }
      }

      // data-node-path enables incremental DOM patching in renderTree.
      // Must use displayNode.path (post-compaction) so it matches the key
      // used by nodeMap, state.expanded, and the dir-row's data-path attribute.
      li.dataset.nodePath = displayNode.path;

      const isExpanded = state.expanded.get(displayNode.path) ?? (state.activeFilters.size > 0 || depth === 0);
      // Record implicit depth-0 expansion so button state reflects reality after initial render.
      // Skip during active filter/search to avoid recording ephemeral auto-expanded state.
      if (!state.expanded.has(displayNode.path) && depth === 0 && state.activeFilters.size === 0 && !state.searchResults) {
        state.expanded.set(displayNode.path, true);
      }

      const sortedChildren = sortDirs(displayNode.children, state.currentSortMode);
      const sortedFiles = sortFiles(displayNode.files || []);

      // Apply language filter and search results filter
      const visibleChildren = getVisibleChildren(sortedChildren, state.activeFilters, dirMatchesFilter, state.searchResults, c => dirMatchesSearch(c));
      const visibleFiles = getVisibleFiles(sortedFiles, state.activeFilters, state.searchResults);

      const hasChildren = visibleChildren.length > 0 || visibleFiles.length > 0;

      // Dir row
      const row = document.createElement('div');
      row.className = 'dir-row' + (displayNode.totalFiles === 0 ? ' empty-dir' : '');

      // Sticky positioning: dirs with children stick at a depth-based top offset so
      // ancestors remain visible while scrolling through long child lists.
      if (hasChildren) {
        row.classList.add('sticky-dir');
        row.style.setProperty('--depth', String(depth));
      }
      row.setAttribute('data-path', displayNode.path);
      row.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'directory',
        path: displayNode.path,
        rootName: state.workspaceFolderName || state.currentRootName,
        preventDefaultContextMenuItems: true
      }));

      // skipDepthZeroGuides=true (sidebar): omit the empty indent-guides container at depth 0
      if (!opts.skipDepthZeroGuides || depth > 0) {
        row.appendChild(renderIndentGuides(depth, ancestors));
      }

      // Chevron
      const chevron = document.createElement('span');
      chevron.className = 'chevron' + (hasChildren ? (isExpanded ? ' open' : '') : ' leaf');
      chevron.innerHTML = SVG_CHEVRON;
      row.appendChild(chevron);

      // Name — for compacted paths, render each segment separately with dimmed separators
      // and per-segment data-vscode-context for RMB "copy path" etc on individual segments.
      const nameEl = document.createElement('span');
      nameEl.className = 'dir-name';
      nameEl.title = displayNode.path || displayName;

      // In tab mode (onNavigate set), render ancestor breadcrumb for the root node of a subdir tab.
      // For workspace root tabs (state.dirPath falsy), the root name renders normally below.
      if (depth === 0 && typeof deps.onNavigate === 'function' && state.dirPath) {
        const segments = state.dirPath.split('/');
        const hasRootName = !!state.workspaceFolderName;
        const allNames = hasRootName ? [state.workspaceFolderName, ...segments] : segments;
        for (let i = 0; i < allNames.length; i++) {
          if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'path-sep';
            sep.textContent = ' / ';
            nameEl.appendChild(sep);
          }
          const offset = hasRootName ? i - 1 : i;
          const segPath = offset < 0 ? '' : segments.slice(0, offset + 1).join('/');
          const seg = document.createElement('span');
          seg.className = 'path-segment';
          seg.dataset.navigatePath = segPath;
          seg.textContent = allNames[i];
          nameEl.appendChild(seg);
        }
      } else if (compactSegments.length === 1) {
        nameEl.textContent = compactSegments[0].name;
      } else {
        for (let i = 0; i < compactSegments.length; i++) {
          if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'path-sep';
            sep.textContent = ' / ';
            nameEl.appendChild(sep);
          }
          const seg = document.createElement('span');
          seg.className = 'path-segment';
          seg.textContent = compactSegments[i].name;
          seg.setAttribute('data-vscode-context', JSON.stringify({
            webviewSection: 'directory',
            path: compactSegments[i].path,
            rootName: state.workspaceFolderName || state.currentRootName,
            preventDefaultContextMenuItems: true,
          }));
          nameEl.appendChild(seg);
        }
      }

      row.appendChild(nameEl);

      // Flex spacer pushes bar + count to the right
      const barSpacer = document.createElement('div');
      barSpacer.className = 'bar-spacer';
      row.appendChild(barSpacer);

      // Proportional bar — skip for root node when hideRootBar is set (tab breadcrumb row)
      if (displayNode.totalFiles > 0 && !(depth === 0 && opts.hideRootBar)) {
        const metric = state.currentSortMode === 'size' ? displayNode.sizeBytes : displayNode.totalFiles;
        const pct = metric / maxMetric;
        const barWrapWidth = computeBarWidth(pct, clientWidth, root, opts);

        const barWrap = document.createElement('div');
        barWrap.className = 'bar-wrap';
        barWrap.style.width = barWrapWidth + 'px';

        const bar = document.createElement('div');
        bar.className = 'bar';

        const total = displayNode.totalFiles;
        for (const s of displayNode.stats) {
          const segPct = (s.count / total) * 100;
          const seg = document.createElement('div');
          seg.className = 'bar-segment';
          seg.style.width = segPct + '%';
          seg.style.backgroundColor = s.color;
          bar.appendChild(seg);
        }

        // Tooltip is now handled by the delegated mouseover/mouseout handler in createRenderer,
        // which looks up node data from nodeMap. No per-element listeners needed.

        barWrap.appendChild(bar);
        row.appendChild(barWrap);
      }

      // Right column: file count or size depending on sort mode.
      // Empty dirs always show "—" for visual alignment, even when hideCounts is set.
      if (!opts.hideCounts || displayNode.totalFiles === 0) {
        const metaEl = document.createElement('span');
        metaEl.className = 'file-count';
        if (displayNode.totalFiles > 0) {
          if (state.currentSortMode === 'size') {
            metaEl.textContent = formatBytes(displayNode.sizeBytes);
            metaEl.title = displayNode.totalFiles + ' files';
          } else {
            metaEl.textContent = String(displayNode.totalFiles);
            metaEl.title = formatBytes(displayNode.sizeBytes);
          }
        } else {
          metaEl.textContent = '\u2014';
          metaEl.style.opacity = '0.5';
        }
        row.appendChild(metaEl);
      }

      // Hover action buttons — overlay on the right (sidebar) or inline after name (tab)
      //
      // Expand uses 3-tier progressive escalation:
      //   1. Target is collapsed → expand target only
      //   2. Target is expanded, not all direct children expanded → expand all direct children
      //   3. Target is expanded, all direct children expanded → recursively expand entire subtree
      //
      // Collapse mirrors expand with 3-tier progressive de-escalation:
      //   1. Any descendant beyond direct children is expanded → collapse those deeper descendants
      //      (direct children stay expanded, giving the user a "flatten to one level" step)
      //   2. Some/all direct children are expanded (no deeper) → collapse all direct children
      //   3. No children are expanded → collapse target itself
      //
      // This design lets the user incrementally drill deeper with repeated expand clicks,
      // and incrementally retreat with repeated collapse clicks, without jarring jumps.
      // Action buttons use data-action + data-path so the delegated click handler
      // in createRenderer can process them without per-element listener closures.
      const actionsEl = document.createElement('div');
      actionsEl.className = 'dir-actions';
      if (displayNode.children.length > 0) {
        const expandBtn = document.createElement('button');
        expandBtn.className = 'dir-action-btn';
        expandBtn.innerHTML = SVG_EXPAND_ALL;
        expandBtn.title = 'Expand children';
        expandBtn.dataset.action = 'expandDir';
        expandBtn.dataset.path = displayNode.path;
        actionsEl.appendChild(expandBtn);

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'dir-action-btn';
        collapseBtn.innerHTML = SVG_COLLAPSE_ALL;
        collapseBtn.title = 'Collapse children';
        collapseBtn.dataset.action = 'collapseDir';
        collapseBtn.dataset.path = displayNode.path;
        actionsEl.appendChild(collapseBtn);
      }
      const focusBtn = document.createElement('button');
      focusBtn.className = 'dir-action-btn';
      focusBtn.innerHTML = SVG_OPEN_IN_TAB;
      focusBtn.title = 'Open in new tab';
      focusBtn.dataset.action = 'openInTab';
      focusBtn.dataset.path = displayNode.path;
      actionsEl.appendChild(focusBtn);
      row.insertBefore(actionsEl, barSpacer);

      // Register this node in nodeMap so the delegated handlers can look it up by path.
      nodeMap.set(displayNode.path, { node: displayNode, hasChildren });

      li.appendChild(row);

      // Children container — lazy: only populate when expanded to avoid building
      // collapsed subtrees during off-screen tree construction for patching.
      if (hasChildren) {
        const childrenEl = document.createElement('ul');
        childrenEl.className = 'children' + (isExpanded ? ' open' : '');

        if (isExpanded) {
          const nextAncestors = [...ancestors, { path: displayNode.path }];

          // Empty dir grouping (only when no filter and no search active)
          if (state.activeFilters.size === 0 && !state.searchResults && visibleChildren.length > 0) {
            for (const group of groupEmptyDirs(visibleChildren)) {
              if (group.type === 'emptyGroup') {
                if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
                  // Already expanded — render individual dirs
                  for (const n of group.nodes) {
                    childrenEl.appendChild(renderDirNode(n, depth + 1, maxMetric, nextAncestors, clientWidth));
                  }
                } else {
                  childrenEl.appendChild(renderEmptyGroupNode(group.nodes, depth + 1, maxMetric, nextAncestors));
                }
              } else {
                childrenEl.appendChild(renderDirNode(group.node, depth + 1, maxMetric, nextAncestors, clientWidth));
              }
            }
          } else {
            for (const child of visibleChildren) {
              childrenEl.appendChild(renderDirNode(child, depth + 1, maxMetric, nextAncestors, clientWidth));
            }
          }

          // File truncation — disabled when search is active (all matched files must be shown).
          const shouldTruncate = !state.searchResults && state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(displayNode.path);
          const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
          const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];

          for (const file of shownFiles) {
            childrenEl.appendChild(renderFileNode(file, depth + 1, nextAncestors));
            renderFileMatches(childrenEl, file, depth + 2, nextAncestors);
          }
          if (hiddenFiles.length > 0) {
            childrenEl.appendChild(renderTruncatedRow(hiddenFiles, depth + 1, nextAncestors, displayNode.path, maxMetric, clientWidth));
          }
        }
        // When collapsed, childrenEl is left empty — children are rendered lazily on expand.

        li.appendChild(childrenEl);
      }

      return li;
    }

    // Renders inline match lines (and optional context lines) beneath a file row when content
    // search is active. Renders up to MAX_MATCH_LINES match lines plus their associated context
    // lines. Inserts a separator element between non-contiguous line groups (gaps in line numbers).
    function renderFileMatches(container, file, depth, ancestors) {
      if (!state.searchResults?.has(file.path)) { return; }
      const fileMatches = state.searchResults.get(file.path);
      if (!fileMatches || fileMatches.length === 0) { return; }

      // Sort by line number — entries arrive sorted from the backend but sorting here is
      // defensive against any reordering during streaming patches.
      const sorted = fileMatches.slice().sort((a, b) => a.line - b.line);

      // Count total match lines (not context) to compute the "more matches" label.
      let totalMatchLines = 0;
      for (const m of sorted) { if (!m.isContext) { totalMatchLines++; } }

      let renderedMatchCount = 0;
      let prevLine = null;

      for (const m of sorted) {
        if (!m.isContext) {
          renderedMatchCount++;
          if (renderedMatchCount > MAX_MATCH_LINES) { break; }
        } else if (renderedMatchCount > MAX_MATCH_LINES) {
          // Context line after the cap has been exceeded — stop rendering.
          break;
        }

        // Insert a separator between non-contiguous line groups.
        if (prevLine !== null && m.line > prevLine + 1) {
          const sepLi = document.createElement('li');
          const sepDiv = document.createElement('div');
          sepDiv.className = 'match-group-separator';
          sepLi.appendChild(sepDiv);
          container.appendChild(sepLi);
        }
        prevLine = m.line;

        if (m.isContext) {
          container.appendChild(renderContextLine(file, m, depth, ancestors));
        } else {
          container.appendChild(renderMatchLine(file, m, depth, ancestors));
        }
      }

      if (totalMatchLines > MAX_MATCH_LINES) {
        container.appendChild(renderMoreMatchesRow(totalMatchLines - MAX_MATCH_LINES, depth, ancestors, file.path));
      }
    }

    return {
      // Called at the start of each full renderTree pass to flush stale node references.
      beforeRender() { nodeMap.clear(); _searchMatchCache = new WeakMap(); },
      dirMatchesFilter, dirMatchesSearch, renderIndentGuides, renderFileNode,
      renderMatchLine, renderContextLine, renderMoreMatchesRow, renderFileMatches, renderTruncatedRow, renderEmptyGroupNode, renderDirNode,
    };
  }

  window._DirviewRenderer = { createRenderer };
})();
