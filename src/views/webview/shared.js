// @ts-check
// Barrel module for dirview webviews — assembles window.DirviewShared from split modules.
// Must be loaded after shared-icons.js, shared-utils.js, shared-state.js, shared-renderer.js.
// Contains: renderRoots, DOM patching, renderTree, createMessageHandler, createSearchBar, expandMatchedDirs.
(function () {
  'use strict';

  const I = window._DirviewIcons;
  const U = window._DirviewUtils;
  const St = window._DirviewState;
  const R = window._DirviewRenderer;

  const { escHtml, sortDirs, sortFiles, groupEmptyDirs, computeMaxMetric, compactedPath } = U;

  // ── Shared view helpers ───────────────────────────────────────────────────

  /**
   * Creates the "auto-rescan disabled" warning banner with a wired Refresh button.
   * @param {object} vscode — VS Code webview API (for postMessage)
   * @returns {HTMLElement}
   */
  function createRescanWarning(vscode) {
    const warn = document.createElement('div');
    warn.className = 'rescan-warning';
    warn.innerHTML = `
      <span class="rescan-warning-icon">${I.SVG_WARNING}</span>
      <span>Auto-rescan disabled (large repo)</span>
      <button class="rescan-btn">Refresh</button>
    `;
    warn.querySelector('.rescan-btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
    return warn;
  }

  // Renders the root-level tree rows into treeEl. Shared between sidebar and tab views.
  // Requires state.lastRoots to be set.
  function renderRoots(renderer, state, treeEl, maxMetric, clientWidth) {
    const roots = state.lastRoots;

    for (const r of roots) {
      state.currentRootName = r.name;
      if (roots.length > 1) {
        const header = document.createElement('li');
        header.className = 'workspace-root-header';
        header.textContent = r.name;
        treeEl.appendChild(header);
      }
      const sortedChildren = sortDirs(r.children, state.currentSortMode);
      const sortedFiles = sortFiles(r.files || []);
      const visibleChildren = U.getVisibleChildren(sortedChildren, state.activeFilters, c => renderer.dirMatchesFilter(c), state.searchResults, c => renderer.dirMatchesSearch(c));
      const visibleFiles = U.getVisibleFiles(sortedFiles, state.activeFilters, state.searchResults);
      if (state.activeFilters.size === 0 && !state.searchResults && visibleChildren.length > 0) {
        for (const group of groupEmptyDirs(visibleChildren)) {
          if (group.type === 'emptyGroup') {
            if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
              for (const n of group.nodes) { treeEl.appendChild(renderer.renderDirNode(n, 0, maxMetric, [], clientWidth)); }
            } else {
              treeEl.appendChild(renderer.renderEmptyGroupNode(group.nodes, 0, maxMetric, []));
            }
          } else {
            treeEl.appendChild(renderer.renderDirNode(group.node, 0, maxMetric, [], clientWidth));
          }
        }
      } else {
        for (const child of visibleChildren) {
          treeEl.appendChild(renderer.renderDirNode(child, 0, maxMetric, [], clientWidth));
        }
      }
      // File truncation — disabled when search is active.
      const shouldTruncate = !state.searchResults && state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(r.path);
      const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
      const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];
      for (const file of shownFiles) {
        treeEl.appendChild(renderer.renderFileNode(file, 0, []));
        // Render inline match lines for root-level files when content search is active.
        if (state.searchResults?.has(file.path)) {
          const fileMatches = state.searchResults.get(file.path);
          if (fileMatches.length > 0) {
            const MAX_MATCH_LINES = 5;
            for (const m of fileMatches.slice(0, MAX_MATCH_LINES)) {
              treeEl.appendChild(renderer.renderMatchLine(file, m, 1, []));
            }
            if (fileMatches.length > MAX_MATCH_LINES) {
              treeEl.appendChild(renderer.renderMoreMatchesRow(fileMatches.length - MAX_MATCH_LINES, 1, [], file.path));
            }
          }
        }
      }
      if (hiddenFiles.length > 0) {
        treeEl.appendChild(renderer.renderTruncatedRow(hiddenFiles, 0, [], r.path, maxMetric, clientWidth));
      }
    }
  }

  // ── Incremental DOM patching ─────────────────────────────────────────────
  //
  // On file-change rescans the tree structure is typically stable (same directories,
  // same files, possibly different counts/bar widths). patchTreeChildren/patchDirLi
  // reuse existing <li> DOM nodes rather than replacing the whole tree, which:
  //   • Preserves scroll position (no parent innerHTML wipe)
  //   • Avoids visual flicker for unchanged nodes
  //   • Updates only what changed (bar widths, file counts)
  //
  // Each <li> produced by renderDirNode carries data-node-path so matching is O(1).

  /**
   * Patches oldEl's direct children to match newEl's, keyed by data-node-path.
   * Keyed nodes (dirs) are updated in-place via patchDirLi; unkeyed nodes (file
   * rows, truncated rows, empty-group rows, workspace headers) are replaced
   * wholesale.  The reconciled list is built in a DocumentFragment and swapped
   * in one shot so only a single reflow occurs.
   * @param {HTMLElement} oldEl
   * @param {HTMLElement} newEl
   */
  function patchTreeChildren(oldEl, newEl) {
    // Index existing keyed children for O(1) lookup.
    const oldByPath = new Map();
    for (const child of oldEl.children) {
      const p = child.dataset.nodePath;
      if (p !== undefined) { oldByPath.set(p, child); }
    }

    // Build the reconciled child list: reuse matched old dir nodes, take new
    // nodes for everything else (files, truncated rows, headers, new dirs).
    const fragment = document.createDocumentFragment();
    for (const newChild of [...newEl.children]) {
      const p = newChild.dataset.nodePath;
      const oldChild = (p !== undefined) ? oldByPath.get(p) : undefined;

      if (oldChild) {
        oldByPath.delete(p);
        if (oldChild.querySelector(':scope > .dir-row')) {
          // Dir node: update bar/count in place and recurse into children UL.
          patchDirLi(oldChild, newChild);
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
   * @param {HTMLElement} oldLi
   * @param {HTMLElement} newLi
   */
  function patchDirLi(oldLi, newLi) {
    const oldRow = oldLi.querySelector(':scope > .dir-row');
    const newRow = newLi.querySelector(':scope > .dir-row');
    if (oldRow && newRow) {
      // Update bar-wrap width and segment colors/widths.
      const oldBarWrap = oldRow.querySelector('.bar-wrap');
      const newBarWrap = newRow.querySelector('.bar-wrap');
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
      const oldCount = oldRow.querySelector('.file-count');
      const newCount = newRow.querySelector('.file-count');
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
    const oldChildren = oldLi.querySelector(':scope > ul.children');
    const newChildren = newLi.querySelector(':scope > ul.children');
    if (oldChildren && newChildren) {
      oldChildren.className = newChildren.className;
      patchTreeChildren(oldChildren, newChildren);
    } else if (!oldChildren && newChildren) {
      oldLi.appendChild(newChildren);
    } else if (oldChildren && !newChildren) {
      oldChildren.remove();
    }
  }

  /**
   * Renders the tree <ul> into rootEl. If rootEl already contains a <ul class="tree">
   * from a previous render, patches it incrementally (preserves scroll, avoids flicker).
   * Otherwise creates and appends a new tree element (first render or after loading/error).
   * @param {object} state
   * @param {object} renderer
   * @param {HTMLElement} rootEl
   * @param {{ cssClass?: string }} [opts]
   */
  function renderTree(state, renderer, rootEl, opts) {
    // Clear the nodeMap so stale entries from the previous render don't persist.
    if (renderer.beforeRender) { renderer.beforeRender(); }
    const maxMetric = computeMaxMetric(state.lastRoots, state.currentSortMode, false);
    const clientWidth = rootEl.clientWidth;
    const treeClass = 'tree' +
      (opts && opts.cssClass ? ' ' + opts.cssClass : '') +
      (state.currentSortMode === 'size' ? ' sort-size' : '');

    const existingTree = rootEl.querySelector(':scope > ul.tree');
    if (existingTree) {
      // Incremental path: build the new tree off-screen, then reconcile with existing DOM.
      existingTree.className = treeClass;
      const newTreeEl = document.createElement('ul');
      newTreeEl.className = treeClass;
      renderRoots(renderer, state, newTreeEl, maxMetric, clientWidth);
      patchTreeChildren(existingTree, newTreeEl);
    } else {
      // First render (or after loading/error cleared the container): full creation.
      const treeEl = document.createElement('ul');
      treeEl.className = treeClass;
      renderRoots(renderer, state, treeEl, maxMetric, clientWidth);
      rootEl.appendChild(treeEl);
    }

  }

  /**
   * Creates a window 'message' handler that handles common message types
   * (scanning, loading, update, filter, expandAll, collapseAll, error).
   *
   * @param {object} state
   * @param {object} scanBar
   * @param {HTMLElement} rootEl
   * @param {object} deps
   *   deps.render(roots, autoRescanEnabled, sortMode) — the view's render function
   *   deps.resolveUpdateSortMode?(msg) — returns the sortMode to use for 'update'; defaults to msg.sortMode
   *   deps.onBeforeUpdate?(msg) — called synchronously before rAF on 'update'
   *   deps.onAfterRender?(msg) — called inside rAF after render on 'update'
   *   deps.onLoading?() — called after clearing rootEl on 'loading'
   *   deps.onFilter?(hadFilters) — called after filter state update + re-render
   *   deps.onExpandAll?() — called after tieredExpandAll + re-render
   *   deps.onCollapseAll?() — called after tieredCollapseAll + re-render
   * @returns {function} — pass directly to window.addEventListener('message', ...)
   */
  function createMessageHandler(state, scanBar, rootEl, deps) {
    const handlers = {
      scanning() {
        scanBar.show(true);
      },
      loading() {
        scanBar.show(false);
        rootEl.innerHTML = '<div class="loading">Scanning workspace\u2026</div>';
        if (deps.onLoading) { deps.onLoading(); }
      },
      update(message) {
        if (deps.onBeforeUpdate) { deps.onBeforeUpdate(message); }
        scanBar.show(true);
        requestAnimationFrame(() => {
          const sortMode = deps.resolveUpdateSortMode ? deps.resolveUpdateSortMode(message) : message.sortMode;
          deps.render(message.roots, message.autoRescanEnabled, sortMode);
          scanBar.show(false);
          if (deps.onAfterRender) { deps.onAfterRender(message); }
        });
      },
      filter(message) {
        const hadFilters = state.activeFilters.size > 0;
        state.activeFilters = new Set(message.langs || []);
        if (!hadFilters && state.activeFilters.size > 0) { state.expanded.clear(); }
        if (state.lastRoots) {
          state.rerender();
        }
        if (deps.onFilter) { deps.onFilter(hadFilters); }
      },
      expandAll() {
        if (state.lastRoots) {
          St.tieredExpandAll(state, state.lastRoots);
          state.rerender();
          if (deps.onExpandAll) { deps.onExpandAll(); }
        }
      },
      collapseAll() {
        if (state.lastRoots) {
          St.tieredCollapseAll(state, state.lastRoots);
          state.truncationExpanded.clear();
          state.emptyGroupExpanded.clear();
          state.rerender();
          if (deps.onCollapseAll) { deps.onCollapseAll(); }
        }
      },
      updateSortMode(message) {
        // Lightweight sort-mode change from sidebarProvider.updateSortMode():
        // avoids re-serializing the full tree when only the sort order changed.
        state.currentSortMode = message.sortMode || 'files';
        if (state.lastRoots) { state.rerender(); }
      },
      updateTruncation(message) {
        // Lightweight truncation change from sidebarProvider.updateTruncateThreshold():
        // avoids re-serializing the full tree when only the truncation threshold changed.
        if (typeof message.truncateThreshold === 'number' && message.truncateThreshold !== state.truncateThreshold) {
          state.truncationExpanded.clear();
          state.emptyGroupExpanded.clear();
        }
        if (typeof message.truncateThreshold === 'number') { state.truncateThreshold = message.truncateThreshold; }
        if (state.lastRoots) { state.rerender(); }
      },
      error(message) {
        scanBar.show(false);
        rootEl.innerHTML = `<div class="error">Error: ${escHtml(message.message)}</div>`;
      },
      searchResults(message) {
        // Non-streaming fallback (used by searchFiles / clearSearch / errors).
        state.searchResults = message.matches
          ? new Map(Object.entries(message.matches))
          : null;
        state.searchActive = false;
        state.searchTruncated = message.truncated || false;
        state.searchFileCount = message.fileCount || 0;
        state.searchMatchCount = message.matchCount || 0;
        if (state.scanBar) { state.scanBar.show(false); }
        // Selectively expand only dirs that contain matches (avoids rendering entire tree).
        if (state.searchResults && state.searchResults.size > 0 && state.lastRoots) {
          expandMatchedDirs(state, state.lastRoots, state.searchResults, state.activeFilters);
        }
        if (state.searchBar_updateStatus) { state.searchBar_updateStatus(); }
        if (state.lastRoots) { state.rerender(); }
      },
      searchResultsBatch(message) {
        // Progressive delivery: merge incoming batch into accumulated results.
        const newFilePaths = new Set(Object.keys(message.matches || {}));
        if (!state.searchResults) { state.searchResults = new Map(); }
        for (const [p, m] of Object.entries(message.matches || {})) { state.searchResults.set(p, m); }
        state.searchFileCount = message.fileCount || 0;
        state.searchMatchCount = message.matchCount || 0;
        // Incrementally expand only dirs containing newly arrived files — avoids full tree
        // walk on every batch. searchProgress must have cleared expanded first.
        if (newFilePaths.size > 0 && state.lastRoots) {
          expandBatchFiles(state, state.lastRoots, newFilePaths);
        }
        if (state.searchBar_updateStatus) { state.searchBar_updateStatus(); }
        // Throttle: coalesce rapid batch arrivals into at most one render per 300ms.
        if (state.lastRoots && !state._searchRenderTimer) {
          state._searchRenderTimer = setTimeout(() => {
            state._searchRenderTimer = null;
            state.rerender();
          }, 300);
        }
      },
      searchResultsHighlight(message) {
        // Syntax highlight patches arrive after the plain-text batch has already rendered.
        // Merge highlighted HTML into the in-place match objects and schedule a re-render.
        if (!state.searchResults) { return; }
        for (const { path, idx, html } of (message.patches || [])) {
          const fileMatches = state.searchResults.get(path);
          if (fileMatches && fileMatches[idx] !== undefined) {
            fileMatches[idx].highlightedHtml = html;
          }
        }
        if (state.lastRoots && !state._searchRenderTimer) {
          state._searchRenderTimer = setTimeout(() => {
            state._searchRenderTimer = null;
            state.rerender();
          }, 300);
        }
      },
      searchResultsDone(message) {
        // Final signal after all batches have been delivered.
        // If no batches arrived (zero results), searchResults is still null — set to empty Map
        // so the tree filters to empty rather than falling back to showing the full tree.
        if (state.searchResults === null) { state.searchResults = new Map(); }
        state.searchActive = false;
        state.searchTruncated = message.truncated || false;
        state.searchFileCount = message.fileCount || 0;
        state.searchMatchCount = message.matchCount || 0;
        if (state.scanBar) { state.scanBar.show(false); }
        if (state.searchBar_updateStatus) { state.searchBar_updateStatus(); }
        // Cancel any pending throttled render and do a final immediate render.
        if (state._searchRenderTimer) { clearTimeout(state._searchRenderTimer); state._searchRenderTimer = null; }
        if (state.lastRoots) { state.rerender(); }
      },
      searchProgress() {
        state.searchActive = true;
        // Clear stale results and expand state from a previous search.
        state.searchResults = null;
        state.searchFileCount = 0;
        state.searchMatchCount = 0;
        state.searchTruncated = false;
        // Clear expanded so expandBatchFiles starts fresh for the new search.
        state.expanded.clear();
        // Cancel any throttled render from the previous search.
        if (state._searchRenderTimer) { clearTimeout(state._searchRenderTimer); state._searchRenderTimer = null; }
        if (state.scanBar) { state.scanBar.show(true); }
        if (state.searchBar_updateStatus) { state.searchBar_updateStatus(); }
        if (state.lastRoots) { state.rerender(); }
      },
      /* @DEV_START */
      debugEval(message) {
        // Cross-frame debug bridge: evals a script string and returns the result
        // to the extension host AND to the parent frame (so CDP can read it).
        // Only functional when CSP includes 'unsafe-eval' (Development mode).
        // Double-gated: body must have data-debug attribute AND CSP must allow eval.
        // Stripped entirely from production builds by copyWebview.js.
        if (!document.body.hasAttribute('data-debug')) { return; }
        const id = message.id;
        try {
          // eslint-disable-next-line no-eval
          const result = eval(message.script);
          const serialized = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          if (deps.vscode) { deps.vscode.postMessage({ command: 'debugEvalResult', id, result: serialized }); }
          // Also post to parent chain so the renderer (CDP) can read results.
          window.parent.postMessage({ type: 'dirview-debug-result', id, result: serialized }, '*');
        } catch (err) {
          const errStr = String(err);
          if (deps.vscode) { deps.vscode.postMessage({ command: 'debugEvalResult', id, error: errStr }); }
          window.parent.postMessage({ type: 'dirview-debug-result', id, error: errStr }, '*');
        }
      },
      /* @DEV_END */
    };

    return function (event) {
      const message = event.data;
      const handler = handlers[message.type];
      if (handler) { handler(message); }
    };
  }

  /**
   * Creates the search bar UI.
   * @param {object} state — shared webview state
   * @param {object} vscode — VS Code webview API
   * @param {object} [options]
   * @param {boolean} [options.standalone] — true when used in the standalone search fold:
   *   disables the Cmd+F global listener (the fold is focused via searchProvider.focusInput())
   *   and provides setStatus(data) for externally-driven status updates.
   */
  function createSearchBar(state, vscode, options) {
    const standalone = !!(options && options.standalone);
    const el = document.createElement('div');
    el.className = 'search-bar';

    // ── Main input row: input + toggle buttons inside a shared border ──────
    // This matches VSCode's native search panel (Aa, .*, and × inside the border).
    const inputRow = document.createElement('div');
    inputRow.className = 'search-input-row';

    const inputContainer = document.createElement('div');
    inputContainer.className = 'search-input-container';

    const mainInput = document.createElement('input');
    mainInput.type = 'text';
    mainInput.className = 'search-main-input';
    mainInput.placeholder = 'Search file contents\u2026';
    mainInput.setAttribute('aria-label', 'Search');
    inputContainer.appendChild(mainInput);

    // Case-sensitive toggle — reuses the "Aa" sort icon (same codicon)
    const caseBtn = document.createElement('button');
    caseBtn.className = 'search-toggle';
    caseBtn.title = 'Case Sensitive';
    caseBtn.setAttribute('aria-label', 'Case Sensitive');
    caseBtn.innerHTML = I.SVG_SORT_NAME;
    let caseSensitive = false;
    inputContainer.appendChild(caseBtn);

    // Regex mode toggle
    const regexBtn = document.createElement('button');
    regexBtn.className = 'search-toggle';
    regexBtn.title = 'Use Regular Expression';
    regexBtn.setAttribute('aria-label', 'Use Regular Expression');
    regexBtn.innerHTML = I.SVG_REGEX;
    let useRegex = false;
    inputContainer.appendChild(regexBtn);

    // Clear button — only visible when there's a query, sits inside the container border
    const clearBtn = document.createElement('button');
    clearBtn.className = 'search-toggle';
    clearBtn.title = 'Clear Search (Escape)';
    clearBtn.setAttribute('aria-label', 'Clear Search');
    clearBtn.innerHTML = I.SVG_CLOSE;
    clearBtn.style.display = 'none';
    inputContainer.appendChild(clearBtn);

    inputRow.appendChild(inputContainer);
    el.appendChild(inputRow);

    // ── Files to include — label above input, matching VSCode native search ─
    const includeSection = document.createElement('div');
    includeSection.className = 'search-filter-section';
    const includeLabel = document.createElement('label');
    includeLabel.className = 'search-filter-label';
    includeLabel.textContent = 'files to include';
    const includeInput = document.createElement('input');
    includeInput.type = 'text';
    includeInput.className = 'search-input search-filter-input';
    includeInput.placeholder = 'e.g. src/**/*.ts';
    includeInput.setAttribute('aria-label', 'Files to include');
    // Warning icon shown when a language filter is active — alerts the user that search
    // results are being intersected with the language filter, so some matches may be hidden.
    const filterWarning = document.createElement('span');
    filterWarning.className = 'search-filter-warning';
    filterWarning.innerHTML = I.SVG_WARNING;
    filterWarning.title = 'Language filter active \u2014 some results may be hidden';
    filterWarning.style.display = 'none';
    const inputRow2 = document.createElement('div');
    inputRow2.className = 'search-filter-input-row';
    inputRow2.appendChild(includeInput);
    inputRow2.appendChild(filterWarning);
    includeSection.appendChild(includeLabel);
    includeSection.appendChild(inputRow2);
    el.appendChild(includeSection);

    // ── Status line ────────────────────────────────────────────────────────
    const statusEl = document.createElement('div');
    statusEl.className = 'search-status';
    statusEl.style.display = 'none';
    el.appendChild(statusEl);

    // ── State ──────────────────────────────────────────────────────────────
    let debounceTimer = null;

    // Shared status text formatting — deduplicates updateStatus/setStatus logic.
    function formatSearchStatus(active, hasResults, resultCount, matchCount, fileCount, truncated) {
      if (active) {
        return { text: 'Searching\u2026', visible: true };
      }
      if (!hasResults) {
        return { text: '', visible: false };
      }
      if (resultCount === 0) {
        const q = mainInput.value.trim() || includeInput.value.trim();
        return { text: q ? 'No results' : '', visible: !!q };
      }
      const trunc = truncated ? ' (truncated)' : '';
      if (matchCount > 0) {
        return {
          text: `${matchCount} result${matchCount !== 1 ? 's' : ''} in ${fileCount} file${fileCount !== 1 ? 's' : ''}${trunc}`,
          visible: true,
        };
      }
      return {
        text: `${fileCount} file${fileCount !== 1 ? 's' : ''}${trunc}`,
        visible: true,
      };
    }

    // updateStatus reads from state (used in non-standalone/tab mode where createMessageHandler
    // keeps state.searchActive / state.searchResults / etc. up to date).
    function updateStatus() {
      const { text, visible } = formatSearchStatus(
        state.searchActive,
        state.searchResults !== null,
        state.searchResults ? state.searchResults.size : 0,
        state.searchMatchCount,
        state.searchFileCount,
        state.searchTruncated,
      );
      statusEl.textContent = text;
      statusEl.style.display = visible ? '' : 'none';
    }

    // setStatus is the externally-driven variant used by the standalone search fold.
    // Called with the searchStatus message data from the host (no state dependency).
    function setStatus(data) {
      const { text, visible } = formatSearchStatus(
        data.active,
        !!data.matches,
        data.matches ? Object.keys(data.matches).length : 0,
        data.matchCount ?? 0,
        data.fileCount ?? 0,
        data.truncated,
      );
      statusEl.textContent = text;
      statusEl.style.display = visible ? '' : 'none';
    }

    // Wire state.searchBar_updateStatus so the message handler can call it (non-standalone only).
    if (!standalone) {
      state.searchBar_updateStatus = updateStatus;
    }

    function triggerSearch() {
      const pattern = mainInput.value.trim();
      const includeGlob = includeInput.value.trim();

      clearBtn.style.display = (pattern || includeGlob) ? '' : 'none';

      if (!pattern && !includeGlob) {
        vscode.postMessage({ command: 'clearSearch' });
        return;
      }

      // Detection logic: glob chars or path separators in the main input → filename search.
      const isGlobPattern = /[*?/]/.test(pattern);

      if (!pattern && includeGlob) {
        // Include glob with no content query → filename-only search.
        vscode.postMessage({ command: 'searchFiles', glob: includeGlob });
      } else if (pattern && isGlobPattern) {
        // Main input looks like a glob/path → filename-only search.
        vscode.postMessage({ command: 'searchFiles', glob: pattern });
      } else {
        // Content search.
        vscode.postMessage({
          command: 'search',
          pattern,
          caseSensitive,
          useRegex,
          include: includeGlob || undefined,
        });
      }
    }

    function clearSearch() {
      mainInput.value = '';
      includeInput.value = '';
      clearBtn.style.display = 'none';
      statusEl.style.display = 'none';
      vscode.postMessage({ command: 'clearSearch' });
    }

    // ── Event listeners ────────────────────────────────────────────────────

    caseBtn.addEventListener('click', () => {
      caseSensitive = !caseSensitive;
      caseBtn.classList.toggle('active', caseSensitive);
      if (mainInput.value.trim() || includeInput.value.trim()) { triggerSearch(); }
    });

    regexBtn.addEventListener('click', () => {
      useRegex = !useRegex;
      regexBtn.classList.toggle('active', useRegex);
      if (mainInput.value.trim() || includeInput.value.trim()) { triggerSearch(); }
    });

    clearBtn.addEventListener('click', clearSearch);

    mainInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      clearBtn.style.display = mainInput.value ? '' : 'none';
      if (!mainInput.value && !includeInput.value) {
        vscode.postMessage({ command: 'clearSearch' });
        return;
      }
      debounceTimer = setTimeout(triggerSearch, 300);
    });

    includeInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(triggerSearch, 300);
    });

    // Escape: clear search
    mainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearSearch();
        mainInput.blur();
      }
    });

    // Cmd+F / Ctrl+F — focus the search input from anywhere in the webview.
    // Not wired in standalone mode: the fold is focused via searchProvider.focusInput().
    if (!standalone) {
      window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault();
          mainInput.focus();
          mainInput.select();
        }
      });
    }

    function focus() { mainInput.focus(); mainInput.select(); }
    function show() { mainInput.focus(); }
    function hide() { clearSearch(); }

    function updateFilterWarning(active) {
      filterWarning.style.display = active ? '' : 'none';
    }

    return { el, focus, clear: clearSearch, show, hide, updateStatus, setStatus, updateFilterWarning };
  }

  // Incrementally expands dirs for a new batch of file paths, without clearing state.expanded.
  // Called on each searchResultsBatch; searchProgress must clear expanded first so this
  // only needs to add newly matched dirs rather than rebuilding from all results.
  // O(dir_nodes) per batch — far cheaper than expandMatchedDirs(O(file_nodes × batches)).
  function expandBatchFiles(state, roots, newFilePaths) {
    function walk(node) {
      let hasNew = false;
      for (const f of (node.files || [])) {
        if (newFilePaths.has(f.path) && (state.activeFilters.size === 0 || state.activeFilters.has(f.langName))) {
          hasNew = true;
          break;
        }
      }
      for (const child of (node.children || [])) {
        if (walk(child)) { hasNew = true; }
      }
      if (hasNew) { state.expanded.set(compactedPath(node), true); }
      return hasNew;
    }
    for (const r of roots) { walk(r); }
  }

  // Pre-populates state.expanded so only directories containing search matches are expanded.
  // Full rebuild from all results — used for non-streaming searchResults and clearSearch.
  // Returns true if any descendant matches, allowing the caller to expand ancestors.
  function expandMatchedDirs(state, roots, searchResults, activeFilters) {
    state.expanded.clear();
    function walk(node) {
      let hasMatch = false;
      for (const f of (node.files || [])) {
        if (searchResults.has(f.path) && (activeFilters.size === 0 || activeFilters.has(f.langName))) {
          hasMatch = true;
          break;
        }
      }
      for (const child of (node.children || [])) {
        if (walk(child)) { hasMatch = true; }
      }
      if (hasMatch) {
        const cp = compactedPath(node);
        state.expanded.set(cp, true);
      }
      return hasMatch;
    }
    for (const r of roots) { walk(r); }
  }

  window.DirviewShared = {
    // Icons
    SVG_CHEVRON: I.SVG_CHEVRON, SVG_PLUS: I.SVG_PLUS, SVG_WARNING: I.SVG_WARNING,
    SVG_EYE: I.SVG_EYE, SVG_EYE_CLOSED: I.SVG_EYE_CLOSED, SVG_FOLD: I.SVG_FOLD, SVG_UNFOLD: I.SVG_UNFOLD,
    SVG_EXPAND_ALL: I.SVG_EXPAND_ALL, SVG_COLLAPSE_ALL: I.SVG_COLLAPSE_ALL, SVG_OPEN_IN_TAB: I.SVG_OPEN_IN_TAB,
    SVG_SORT_FILES: I.SVG_SORT_FILES, SVG_SORT_NAME: I.SVG_SORT_NAME, SVG_SORT_SIZE: I.SVG_SORT_SIZE,
    SVG_SEARCH: I.SVG_SEARCH, SVG_REGEX: I.SVG_REGEX, SVG_CLOSE: I.SVG_CLOSE,
    // Utils
    escHtml: U.escHtml, formatBytes: U.formatBytes, sortDirs: U.sortDirs, sortFiles: U.sortFiles,
    computeMaxMetric: U.computeMaxMetric, groupEmptyDirs: U.groupEmptyDirs,
    createScanBar: U.createScanBar, createTooltip: U.createTooltip,
    // Stats & Legend
    computeStats: U.computeStats, renderLegend: U.renderLegend,
    // State
    createState: St.createState, walkExpand: St.walkExpand, walkCollapse: St.walkCollapse,
    tieredExpandAll: St.tieredExpandAll, tieredCollapseAll: St.tieredCollapseAll,
    // Renderer
    createRenderer: R.createRenderer,
    // Local to this file
    renderRoots, createRescanWarning, renderTree, createMessageHandler,
    patchTreeChildren, patchDirLi, createSearchBar, expandMatchedDirs, expandBatchFiles,
  };
})();
