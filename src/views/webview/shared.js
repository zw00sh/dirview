// @ts-check
// Shared utilities for dirview webviews (main.js and tab.js).
// Exposes window.DirviewShared — must be loaded before main.js / tab.js / languages.js.
(function () {
  'use strict';

  // Codicon SVG constants (MIT licensed, microsoft/vscode-codicons)
  const SVG_CHEVRON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M6.146 3.146a.5.5 0 0 0 0 .707l4.146 4.146-4.146 4.146a.5.5 0 0 0 .707.707l4.5-4.5a.5.5 0 0 0 0-.707l-4.5-4.5a.5.5 0 0 0-.707 0Z"/></svg>';
  const SVG_PLUS = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 1.5C8 1.22386 7.77614 1 7.5 1C7.22386 1 7 1.22386 7 1.5V7H1.5C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H7V13.5C7 13.7761 7.22386 14 7.5 14C7.77614 14 8 13.7761 8 13.5V8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H8V1.5Z"/></svg>';
  const SVG_WARNING = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.72L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4H7.375z"/></svg>';

  // Toolbar icons
  const SVG_EYE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2.984 8.625v.003a.5.5 0 0 1-.612.355c-.431-.114-.355-.611-.355-.611l.018-.062s.026-.084.047-.145a6.7 6.7 0 0 1 1.117-1.982C4.096 5.089 5.605 4 8 4s3.904 1.089 4.802 2.183a6.7 6.7 0 0 1 1.117 1.982 4.077 4.077 0 0 1 .06.187l.003.013v.004l.001.002a.5.5 0 0 1-.966.258l-.001-.004-.008-.025a4.872 4.872 0 0 0-.2-.52 5.696 5.696 0 0 0-.78-1.263C11.286 5.912 10.044 5 8 5c-2.044 0-3.285.912-4.028 1.817a5.7 5.7 0 0 0-.945 1.674 3.018 3.018 0 0 0-.035.109l-.008.025ZM8 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 9.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"/></svg>';
  const SVG_EYE_CLOSED = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="m10.12 10.827 4.026 4.027a.5.5 0 0 0 .708-.708l-13-13a.5.5 0 1 0-.708.708l3.23 3.23A5.987 5.987 0 0 0 3.2 6.182a6.7 6.7 0 0 0-1.117 1.982c-.021.061-.047.145-.047.145l-.018.062s-.076.497.355.611a.5.5 0 0 0 .611-.355l.001-.003.008-.025.035-.109a5.7 5.7 0 0 1 .945-1.674 4.94 4.94 0 0 1 1.124-1.014l1.578 1.578a2.5 2.5 0 1 0 3.446 3.446Zm-.74-.74A1.5 1.5 0 1 1 7.413 8.12l1.969 1.968ZM6.32 4.2l.854.854C7.434 5.019 7.709 5 8 5c2.044 0 3.286.912 4.028 1.817a5.695 5.695 0 0 1 .945 1.674c.017.048.028.085.035.109l.008.025v.003l.001.001a.5.5 0 0 0 .966-.257v-.003l-.001-.004-.004-.013a2.3 2.3 0 0 0-.06-.187 6.7 6.7 0 0 0-1.117-1.982C11.905 5.088 10.396 4 8.002 4c-.618 0-1.177.072-1.681.199Z"/></svg>';
  const SVG_FOLD = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11.8536 3.35355L8.35355 6.85355C8.15829 7.04882 7.84171 7.04882 7.64645 6.85355L4.14645 3.35355C3.95118 3.15829 3.95118 2.84171 4.14645 2.64645C4.34171 2.45118 4.65829 2.45118 4.85355 2.64645L8 5.79289L11.1464 2.64645C11.3417 2.45118 11.6583 2.45118 11.8536 2.64645C12.0488 2.84171 12.0488 3.15829 11.8536 3.35355ZM11.8536 12.6464L8.35355 9.14645C8.15829 8.95118 7.84171 8.95118 7.64645 9.14645L4.14645 12.6464C3.95118 12.8417 3.95118 13.1583 4.14645 13.3536C4.34171 13.5488 4.65829 13.5488 4.85355 13.3536L8 10.2071L11.1464 13.3536C11.3417 13.5488 11.6583 13.5488 11.8536 13.3536C12.0488 13.1583 12.0488 12.8417 11.8536 12.6464Z"/></svg>';
  const SVG_UNFOLD = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11.854 10.146C12.049 10.341 12.049 10.658 11.854 10.853L8.35401 14.353C8.15901 14.548 7.84201 14.548 7.64701 14.353L4.14701 10.853C3.95201 10.658 3.95201 10.341 4.14701 10.146C4.34201 9.95098 4.65901 9.95098 4.85401 10.146L8.00001 13.293L11.146 10.146C11.341 9.95098 11.658 9.95098 11.853 10.146H11.854ZM4.85401 5.85398L8.00001 2.70798L11.146 5.85398C11.341 6.04898 11.658 6.04898 11.853 5.85398C12.048 5.65898 12.048 5.34198 11.853 5.14698L8.35301 1.64698C8.15801 1.45198 7.84101 1.45198 7.64601 1.64698L4.14601 5.14698C3.95101 5.34198 3.95101 5.65898 4.14601 5.85398C4.34101 6.04898 4.65901 6.04898 4.85401 5.85398Z"/></svg>';
  const SVG_EXPAND_ALL = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 6v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27c.6.35 1 .99 1 1.73Zm-4 7H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2Zm-7-1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1Zm5.5-5H8V5.5a.5.5 0 0 0-1 0V7H5.5a.5.5 0 0 0 0 1H7v1.5a.5.5 0 0 0 1 0V8h1.5a.5.5 0 0 0 0-1Z"/></svg>';
  const SVG_COLLAPSE_ALL = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M14 4.27c.6.35 1 .99 1 1.73v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27ZM9.5 7a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1h4Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11 2c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7ZM4 3c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4Z"/></svg>';

  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    if (bytes === 0) { return '0 B'; }
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1024 * 1024) { return Math.round(bytes / 1024) + ' KB'; }
    return Math.round(bytes / (1024 * 1024)) + ' MB';
  }

  function sortDirs(dirs, mode) {
    const copy = dirs.slice();
    if (mode === 'name') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (mode === 'size') {
      copy.sort((a, b) => b.sizeBytes - a.sizeBytes);
    } else {
      // 'files' — by total file count desc
      copy.sort((a, b) => b.totalFiles - a.totalFiles);
    }
    return copy;
  }

  function sortFiles(files, mode) {
    const copy = files.slice();
    copy.sort((a, b) => a.name.localeCompare(b.name));
    return copy;
  }

  function computeMaxMetric(roots, sortMode) {
    let max = 0;
    function walk(node) {
      const val = sortMode === 'size' ? node.sizeBytes : node.totalFiles;
      if (val > max) { max = val; }
      for (const c of node.children) { walk(c); }
    }
    // Skip roots (always 100%) — scale relative to largest subdirectory
    for (const r of roots) {
      for (const c of r.children) { walk(c); }
    }
    return max || 1;
  }

  // Groups consecutive empty-dir siblings (totalFiles === 0) into {type:'emptyGroup', nodes:[]}
  function groupEmptyDirs(children) {
    const result = [];
    let i = 0;
    while (i < children.length) {
      if (children[i].totalFiles === 0) {
        const start = i;
        while (i < children.length && children[i].totalFiles === 0) { i++; }
        const emptyNodes = children.slice(start, i);
        if (emptyNodes.length >= 2) {
          result.push({ type: 'emptyGroup', nodes: emptyNodes });
        } else {
          result.push({ type: 'dir', node: emptyNodes[0] });
        }
      } else {
        result.push({ type: 'dir', node: children[i] });
        i++;
      }
    }
    return result;
  }

  // Creates and inserts the scan progress bar element. Returns a controller.
  function createScanBar() {
    const el = document.createElement('div');
    el.className = 'scan-progress';
    document.body.insertBefore(el, document.body.firstChild);
    return {
      show(active) {
        el.className = 'scan-progress' + (active ? ' active' : '');
      },
    };
  }

  // Creates and appends the shared bar hover tooltip element.
  function createTooltip() {
    const el = document.createElement('div');
    el.className = 'bar-tooltip';
    document.body.appendChild(el);
    return el;
  }

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
          guide.addEventListener('mouseenter', () => {
            document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(ancestor.path)}"]`)
              .forEach(el => el.classList.add('hovered'));
          });
          guide.addEventListener('mouseleave', () => {
            document.querySelectorAll(`.indent-guide[data-guide-path="${CSS.escape(ancestor.path)}"]`)
              .forEach(el => el.classList.remove('hovered'));
          });
          guide.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.activeFilters.size > 0) { return; }
            state.expanded.set(ancestor.path, false);
            state.render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
          });
        }
        container.appendChild(guide);
      }
      return container;
    }

    function renderFileNode(file, depth, ancestors) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'file-row clickable';
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

      row.addEventListener('click', () => vscode.postMessage({ command: 'openFile', path: file.path }));
      li.appendChild(row);
      return li;
    }

    function renderTruncatedRow(hiddenFiles, depth, ancestors, dirPath, childrenEl) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'dir-row truncated-row';
      row.appendChild(renderIndentGuides(depth, ancestors));

      const slot = document.createElement('span');
      slot.className = 'chevron';
      slot.innerHTML = SVG_PLUS;
      row.appendChild(slot);

      const label = document.createElement('span');
      label.className = 'dir-name';
      label.textContent = `${hiddenFiles.length} more file${hiddenFiles.length !== 1 ? 's' : ''}`;
      row.appendChild(label);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      // Colored dots for unique language types among hidden files
      const langMap = new Map();
      for (const f of hiddenFiles) {
        if (f.langName) {
          const ex = langMap.get(f.langName);
          if (ex) { ex.count++; } else { langMap.set(f.langName, { color: f.langColor, count: 1 }); }
        }
      }
      const langs = Array.from(langMap.entries()).sort((a, b) => b[1].count - a[1].count);
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

      if (!opts.hideCounts) {
        const totalBytes = hiddenFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0);
        const sizeEl = document.createElement('span');
        sizeEl.className = 'file-count';
        sizeEl.textContent = totalBytes > 0 ? formatBytes(totalBytes) : '';
        row.appendChild(sizeEl);
      }

      row.addEventListener('click', () => {
        state.truncationExpanded.add(dirPath);
        li.remove();
        for (const file of hiddenFiles) {
          childrenEl.appendChild(renderFileNode(file, depth, ancestors));
        }
      });

      li.appendChild(row);
      return li;
    }

    function renderEmptyGroupNode(nodes, depth, maxMetric, ancestors) {
      const li = document.createElement('li');
      const groupKey = nodes[0].path;

      const row = document.createElement('div');
      row.className = 'dir-row empty-group-row';
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
      metaEl.textContent = '—';
      metaEl.style.opacity = '0.5';
      row.appendChild(metaEl);

      li.appendChild(row);

      // On click: replace this row with the individual empty dir nodes
      row.addEventListener('click', () => {
        state.emptyGroupExpanded.add(groupKey);
        const clientWidth = root.clientWidth;
        const frag = document.createDocumentFragment();
        for (const node of nodes) {
          frag.appendChild(renderDirNode(node, depth, maxMetric, ancestors, clientWidth));
        }
        li.replaceWith(frag);
      });

      return li;
    }

    function renderDirNode(node, depth, maxMetric, ancestors, clientWidth) {
      const li = document.createElement('li');
      // Shared timer for click/dblclick disambiguation
      let clickTimer = null;

      // Compact folders: collapse chain of dirs with exactly 1 child dir and 0 files
      let displayNode = node;
      let displayName = node.name;
      while (true) {
        const sorted = sortDirs(displayNode.children, state.currentSortMode);
        const files = displayNode.files || [];
        const vChildren = state.activeFilters.size > 0
          ? sorted.filter(c => dirMatchesFilter(c))
          : sorted;
        const vFiles = state.activeFilters.size > 0
          ? files.filter(f => state.activeFilters.has(f.langName))
          : files;
        if (vChildren.length === 1 && vFiles.length === 0) {
          displayName += ' / ' + vChildren[0].name;
          displayNode = vChildren[0];
        } else {
          break;
        }
      }

      const isExpanded = state.expanded.get(displayNode.path) ?? (state.activeFilters.size > 0 || depth === 0);
      // Record implicit depth-0 expansion so button state reflects reality after initial render
      if (!state.expanded.has(displayNode.path) && depth === 0 && state.activeFilters.size === 0) {
        state.expanded.set(displayNode.path, true);
      }

      const sortedChildren = sortDirs(displayNode.children, state.currentSortMode);
      const sortedFiles = sortFiles(displayNode.files || [], state.currentSortMode);

      // Apply language filter
      const visibleChildren = state.activeFilters.size > 0
        ? sortedChildren.filter(c => dirMatchesFilter(c))
        : sortedChildren;
      const visibleFiles = state.activeFilters.size > 0
        ? sortedFiles.filter(f => state.activeFilters.has(f.langName))
        : sortedFiles;

      const hasChildren = visibleChildren.length > 0 || visibleFiles.length > 0;

      // Dir row
      const row = document.createElement('div');
      row.className = 'dir-row' + (displayNode.totalFiles === 0 ? ' empty-dir' : '');
      row.setAttribute('data-path', displayNode.path);
      row.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'directory',
        path: displayNode.path,
        rootName: state.currentRootName,
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

      // Name
      const nameEl = document.createElement('span');
      nameEl.className = 'dir-name';
      nameEl.textContent = displayName;
      nameEl.title = displayNode.path || displayName;
      row.appendChild(nameEl);

      // Flex spacer pushes bar + count to the right
      const barSpacer = document.createElement('div');
      barSpacer.className = 'bar-spacer';
      row.appendChild(barSpacer);

      // Proportional bar
      if (displayNode.totalFiles > 0) {
        const metric = state.currentSortMode === 'size' ? displayNode.sizeBytes : displayNode.totalFiles;
        const pct = metric / maxMetric;
        const cw = clientWidth || root.clientWidth || opts.barFallbackWidth || 300;
        const maxBarWidth = Math.min(cw * (opts.barFactor || 0.4), opts.barMaxWidth || 200);
        const minBarWidth = opts.barMinWidth || 12;
        const barWrapWidth = Math.max((opts.barSqrt ? Math.sqrt(pct) : pct) * maxBarWidth, minBarWidth);

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

        // Rich hover tooltip — attached to row so the full row is hoverable
        row.addEventListener('mouseenter', () => {
          tooltip.innerHTML = '';
          for (const s of displayNode.stats) {
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
          const rect = bar.getBoundingClientRect();
          tooltip.style.left = rect.left + 'px';
          tooltip.style.top = (rect.bottom + 4) + 'px';
          tooltip.style.display = 'block';
          const tooltipRect = tooltip.getBoundingClientRect();
          if (tooltipRect.bottom > window.innerHeight) {
            tooltip.style.top = (rect.top - tooltipRect.height - 4) + 'px';
          }
          const vpWidth = document.documentElement.clientWidth;
          if (tooltipRect.right > vpWidth - 4) {
            tooltip.style.left = Math.max(4, vpWidth - tooltipRect.width - 4) + 'px';
          }
        });
        row.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });

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
          metaEl.textContent = '—';
          metaEl.style.opacity = '0.5';
        }
        row.appendChild(metaEl);
      }
      li.appendChild(row);

      // Children container
      if (hasChildren) {
        const childrenEl = document.createElement('ul');
        childrenEl.className = 'children' + (isExpanded ? ' open' : '');

        const nextAncestors = [...ancestors, { path: displayNode.path }];

        // Empty dir grouping (only when no filter active)
        if (state.activeFilters.size === 0 && visibleChildren.length > 0) {
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

        // File truncation
        const shouldTruncate = state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(displayNode.path);
        const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
        const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];

        for (const file of shownFiles) {
          childrenEl.appendChild(renderFileNode(file, depth + 1, nextAncestors));
        }
        if (hiddenFiles.length > 0) {
          childrenEl.appendChild(renderTruncatedRow(hiddenFiles, depth + 1, nextAncestors, displayNode.path, childrenEl));
        }

        // Use a timer to disambiguate single-click (expand/collapse) from double-click (drill in)
        row.addEventListener('click', () => {
          if (clickTimer !== null) return; // second click of a dblclick sequence — ignore
          clickTimer = setTimeout(() => {
            clickTimer = null;
            const nowExpanded = !state.expanded.get(displayNode.path);
            state.expanded.set(displayNode.path, nowExpanded);

            // Reset truncation when collapsing so it re-truncates on next expand
            if (!nowExpanded && state.truncationExpanded.has(displayNode.path)) {
              state.truncationExpanded.delete(displayNode.path);
              state.render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
              return;
            }

            chevron.className = 'chevron' + (nowExpanded ? ' open' : '');
            childrenEl.className = 'children' + (nowExpanded ? ' open' : '');

            if (deps.onExpandChanged) {
              deps.onExpandChanged([...state.expanded.values()].some(v => v));
            }
          }, 250);
        });

        li.appendChild(childrenEl);
      }

      // Double-click anywhere on the row to drill into this directory
      row.addEventListener('dblclick', () => {
        if (clickTimer !== null) {
          clearTimeout(clickTimer);
          clickTimer = null;
        }
        state.drillStack.push(displayNode.path);
        state.render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
      });

      return li;
    }

    // Renders the "back" header row shown when drilled into a directory.
    function renderBackRow(drillNode, clientWidth) {
      const li = document.createElement('li');
      li.className = 'drill-back-li';
      const row = document.createElement('div');
      row.className = 'dir-row drill-back-row';

      // Match the indent-guides structure of depth-0 child rows (tab view has skipDepthZeroGuides=false)
      if (!opts.skipDepthZeroGuides) {
        row.appendChild(renderIndentGuides(0, []));
      }

      const chevron = document.createElement('span');
      chevron.className = 'chevron back';
      chevron.innerHTML = SVG_CHEVRON;
      row.appendChild(chevron);

      const nameEl = document.createElement('span');
      nameEl.className = 'dir-name';
      nameEl.textContent = drillNode.name;
      nameEl.title = drillNode.path || drillNode.name;
      row.appendChild(nameEl);

      const spacer = document.createElement('div');
      spacer.className = 'bar-spacer';
      row.appendChild(spacer);

      if (drillNode.totalFiles > 0) {
        const cw = clientWidth || root.clientWidth || opts.barFallbackWidth || 300;
        const maxBarWidth = Math.min(cw * (opts.barFactor || 0.4), opts.barMaxWidth || 200);
        const barWrapWidth = Math.max(maxBarWidth, opts.barMinWidth || 12);
        const barWrap = document.createElement('div');
        barWrap.className = 'bar-wrap';
        barWrap.style.width = barWrapWidth + 'px';
        const bar = document.createElement('div');
        bar.className = 'bar';
        const total = drillNode.totalFiles;
        for (const s of drillNode.stats) {
          const segPct = (s.count / total) * 100;
          const seg = document.createElement('div');
          seg.className = 'bar-segment';
          seg.style.width = segPct + '%';
          seg.style.backgroundColor = s.color;
          bar.appendChild(seg);
        }
        row.addEventListener('mouseenter', () => {
          tooltip.innerHTML = '';
          for (const s of drillNode.stats) {
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
          const rect = bar.getBoundingClientRect();
          tooltip.style.left = rect.left + 'px';
          tooltip.style.top = (rect.bottom + 4) + 'px';
          tooltip.style.display = 'block';
          const tooltipRect = tooltip.getBoundingClientRect();
          if (tooltipRect.bottom > window.innerHeight) {
            tooltip.style.top = (rect.top - tooltipRect.height - 4) + 'px';
          }
          const vpWidth = document.documentElement.clientWidth;
          if (tooltipRect.right > vpWidth - 4) {
            tooltip.style.left = Math.max(4, vpWidth - tooltipRect.width - 4) + 'px';
          }
        });
        row.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
        barWrap.appendChild(bar);
        row.appendChild(barWrap);
      }

      if (!opts.hideCounts) {
        const metaEl = document.createElement('span');
        metaEl.className = 'file-count';
        if (drillNode.totalFiles > 0) {
          if (state.currentSortMode === 'size') {
            metaEl.textContent = formatBytes(drillNode.sizeBytes);
            metaEl.title = drillNode.totalFiles + ' files';
          } else {
            metaEl.textContent = String(drillNode.totalFiles);
            metaEl.title = formatBytes(drillNode.sizeBytes);
          }
        } else {
          metaEl.textContent = '—';
          metaEl.style.opacity = '0.5';
        }
        row.appendChild(metaEl);
      }

      row.addEventListener('click', () => {
        state.drillStack.pop();
        state.render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
      });

      li.appendChild(row);
      return li;
    }

    return { dirMatchesFilter, renderIndentGuides, renderFileNode, renderTruncatedRow, renderEmptyGroupNode, renderDirNode, renderBackRow };
  }

  // Aggregate language stats from root nodes. Shared between tab.js and languagesProvider.ts.
  function computeStats(roots) {
    const counts = new Map();
    let total = 0;
    for (const r of roots) {
      for (const s of r.stats) {
        const ex = counts.get(s.name);
        if (ex) { ex.count += s.count; } else { counts.set(s.name, { color: s.color, count: s.count }); }
      }
      total += r.totalFiles;
    }
    return Array.from(counts.entries())
      .map(([name, { color, count }]) => ({ name, color, count, pct: total > 0 ? ((count / total) * 100).toFixed(1) : '0' }))
      .sort((a, b) => b.count - a.count);
  }

  // Render a filterable language legend into a container element.
  // Returns nothing; mutates legendEl in-place.
  function renderLegend(legendEl, stats, activeFilters, onToggle) {
    legendEl.innerHTML = '';
    const items = document.createElement('div');
    items.className = 'legend-items';
    for (const lang of stats) {
      const isActive = activeFilters.has(lang.name);
      const isInactive = activeFilters.size > 0 && !isActive;
      const item = document.createElement('div');
      item.className = 'legend-item' + (isActive ? ' active' : '') + (isInactive ? ' inactive' : '');
      item.innerHTML =
        `<span class="legend-swatch" style="background:${lang.color}"></span>` +
        `<span class="legend-name">${escHtml(lang.name)}</span>` +
        `<span class="legend-count">${lang.count}</span>`;
      item.addEventListener('click', () => onToggle(lang.name));
      items.appendChild(item);
    }
    legendEl.appendChild(items);
  }

  // Create a fresh webview state object with default values.
  function createState() {
    return {
      activeFilters: new Set(),
      expanded: new Map(),
      truncationExpanded: new Set(),
      emptyGroupExpanded: new Set(),
      truncateThreshold: 4,
      currentSortMode: 'files',
      lastRoots: null,
      lastAutoRescanEnabled: true,
      /** @type {Function|null} */
      render: null,
      /** @type {string[]} */
      drillStack: [],
      /** @type {string} */
      currentRootName: '',
    };
  }

  // Recursively search for a node by path in the DirNode tree.
  function findInChildren(children, targetPath) {
    for (const child of children) {
      if (child.path === targetPath) return child;
      const found = findInChildren(child.children || [], targetPath);
      if (found) return found;
    }
    return null;
  }

  function findNodeByPath(roots, targetPath) {
    for (const root of roots) {
      if (root.path === targetPath) return root;
      const found = findInChildren(root.children || [], targetPath);
      if (found) return found;
    }
    return null;
  }

  // Returns the effective roots for rendering (respects drill stack).
  function getDrillRoots(state) {
    if (!state.drillStack || state.drillStack.length === 0) return state.lastRoots;
    while (state.drillStack.length > 0) {
      const path = state.drillStack[state.drillStack.length - 1];
      const node = findNodeByPath(state.lastRoots, path);
      if (node) return [node];
      state.drillStack.pop();
    }
    return state.lastRoots;
  }

  // Validates drillStack against the current tree; pops stale paths.
  function pruneDrillStack(state) {
    if (!state.drillStack || state.drillStack.length === 0) return;
    while (state.drillStack.length > 0) {
      const path = state.drillStack[state.drillStack.length - 1];
      if (findNodeByPath(state.lastRoots, path)) break;
      state.drillStack.pop();
    }
  }

  function walkExpand(state, nodes) {
    for (const n of nodes) {
      state.expanded.set(n.path, true);
      walkExpand(state, n.children || []);
    }
  }

  function walkCollapse(state, nodes) {
    for (const n of nodes) {
      state.expanded.set(n.path, false);
      walkCollapse(state, n.children || []);
    }
  }

  // Renders the root-level tree rows into treeEl. Shared between sidebar and tab views.
  // Requires state.lastRoots to be set. Handles drill-down via state.drillStack.
  function renderRoots(renderer, state, treeEl, maxMetric, clientWidth) {
    const roots = state.lastRoots;

    // Drilled view
    if (state.drillStack && state.drillStack.length > 0) {
      const drillNode = findNodeByPath(roots, state.drillStack[state.drillStack.length - 1]);
      if (drillNode) {
        // Set rootName for context menus inside drilled view
        const drillRootName = roots.find(r => {
          if (r.path === drillNode.path) return true;
          return findInChildren(r.children || [], drillNode.path) !== null;
        });
        state.currentRootName = drillRootName ? drillRootName.name : (roots[0] ? roots[0].name : '');
        treeEl.appendChild(renderer.renderBackRow(drillNode, clientWidth));

        const sortedChildren = sortDirs(drillNode.children, state.currentSortMode);
        const sortedFiles = sortFiles(drillNode.files || [], state.currentSortMode);
        const visibleChildren = state.activeFilters.size > 0
          ? sortedChildren.filter(c => renderer.dirMatchesFilter(c))
          : sortedChildren;
        const visibleFiles = state.activeFilters.size > 0
          ? sortedFiles.filter(f => state.activeFilters.has(f.langName))
          : sortedFiles;

        if (state.activeFilters.size === 0 && visibleChildren.length > 0) {
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
        const shouldTruncate = state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(drillNode.path);
        const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
        const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];
        for (const file of shownFiles) { treeEl.appendChild(renderer.renderFileNode(file, 0, [])); }
        if (hiddenFiles.length > 0) {
          treeEl.appendChild(renderer.renderTruncatedRow(hiddenFiles, 0, [], drillNode.path, treeEl));
        }
        return;
      }
      // Drill target not found — fall through to normal render
    }

    // Normal (non-drilled) render
    for (const r of roots) {
      state.currentRootName = r.name;
      if (roots.length > 1) {
        const header = document.createElement('li');
        header.className = 'workspace-root-header';
        header.textContent = r.name;
        treeEl.appendChild(header);
      }
      const sortedChildren = sortDirs(r.children, state.currentSortMode);
      const sortedFiles = sortFiles(r.files || [], state.currentSortMode);
      const visibleChildren = state.activeFilters.size > 0
        ? sortedChildren.filter(c => renderer.dirMatchesFilter(c))
        : sortedChildren;
      const visibleFiles = state.activeFilters.size > 0
        ? sortedFiles.filter(f => state.activeFilters.has(f.langName))
        : sortedFiles;
      if (state.activeFilters.size === 0 && visibleChildren.length > 0) {
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
      const shouldTruncate = state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(r.path);
      const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
      const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];
      for (const file of shownFiles) { treeEl.appendChild(renderer.renderFileNode(file, 0, [])); }
      if (hiddenFiles.length > 0) {
        treeEl.appendChild(renderer.renderTruncatedRow(hiddenFiles, 0, [], r.path, treeEl));
      }
    }
  }

  window.DirviewShared = {
    SVG_CHEVRON, SVG_PLUS, SVG_WARNING,
    SVG_EYE, SVG_EYE_CLOSED, SVG_FOLD, SVG_UNFOLD, SVG_EXPAND_ALL, SVG_COLLAPSE_ALL,
    escHtml, formatBytes, sortDirs, sortFiles, computeMaxMetric, groupEmptyDirs,
    createScanBar, createTooltip, createRenderer,
    computeStats, renderLegend, createState,
    walkExpand, walkCollapse, renderRoots,
    findNodeByPath, getDrillRoots, pruneDrillStack,
  };
})();
