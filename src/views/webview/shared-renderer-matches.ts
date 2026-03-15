// Match rendering functions for the tree renderer.
// Extracted from createRenderer — handles search match lines, context lines,
// "more matches" rows, and the full renderFileMatches orchestrator.

import { SVG_CHEVRON, SVG_PLUS, SVG_WARNING } from './shared-icons';
import type { FileNode, SearchMatch, IndentAncestor, RendererContext } from './types';

export const MAX_MATCH_LINES = 5;
export const MAX_MATCH_LINE_DISPLAY = 120;

/** Trims leading whitespace from a raw line and adjusts the match column accordingly.
 *  Must stay in sync with trimLeadingWhitespace in highlighter.ts. */
export function trimLeadingWhitespace(rawText: string, col: number): { lineText: string; adjustedCol: number } {
  const trimmedStart = rawText.length - rawText.trimStart().length;
  return { lineText: rawText.trimStart(), adjustedCol: Math.max(0, col - trimmedStart) };
}

/** Strips `count` leading characters from the visible text content of an element.
 *  Walks text nodes via TreeWalker and removes characters from the start, preserving
 *  HTML structure (e.g. syntax-highlighted <span> tags). Used for dedent on highlighted HTML. */
export function stripLeadingChars(el: HTMLElement, count: number): void {
  if (count <= 0) { return; }
  let remaining = count;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (remaining > 0 && walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.textContent!.length <= remaining) {
      remaining -= node.textContent!.length;
      node.textContent = '';
    } else {
      node.textContent = node.textContent!.slice(remaining);
      remaining = 0;
    }
  }
}

/** Returns { start, end } visible window when lineLength > maxDisplay, or null if it fits.
 *  Must stay in sync with computeVisibleWindow in highlighter.ts. */
export function computeVisibleWindow(lineLength: number, col: number, matchLen: number, maxDisplay: number): { start: number; end: number } | null {
  if (lineLength <= maxDisplay) { return null; }
  const half = Math.floor((maxDisplay - matchLen) / 2);
  return { start: Math.max(0, col - half), end: Math.min(lineLength, col + matchLen + half) };
}

// Renders a single row for one or more matches on the same line.
// matchGroup: array of { line, column, matchLength, lineText, highlightedHtml? } sharing the same line.
// dedent: number of leading characters to strip (computed per match group for relative indentation).
export function renderMatchLine(ctx: RendererContext, file: FileNode, matchGroup: SearchMatch[], depth: number, ancestors: IndentAncestor[], dedent: number = 0): HTMLLIElement {
  const first = matchGroup[0];
  const li = document.createElement('li');
  // Stable key: one row per line (column dropped since same-line matches are merged).
  li.dataset.nodePath = 'match:' + file.path + ':' + first.line;
  const row = document.createElement('div');
  row.className = 'match-line-row';
  row.dataset.action = 'openFileAtLine';
  row.dataset.path = file.path;
  row.dataset.line = String(first.line);
  row.setAttribute('data-vscode-context', JSON.stringify({
    webviewSection: 'matchLine',
    path: file.path,
    lineText: first.lineText || '',
    preventDefaultContextMenuItems: true
  }));
  row.appendChild(ctx.renderIndentGuides(depth, ancestors));

  const lineNumEl = document.createElement('span');
  lineNumEl.className = 'match-line-number';
  lineNumEl.textContent = String(first.line);
  row.appendChild(lineNumEl);

  const textEl = document.createElement('span');
  textEl.className = 'match-line-text';

  let clippedCount = 0;

  if (first.highlightedHtml) {
    // Backend pre-rendered syntax-highlighted HTML (untrimmed). Strip dedent chars
    // from the leading text nodes to apply group-level dedent.
    textEl.innerHTML = first.highlightedHtml;
    stripLeadingChars(textEl, dedent);
    // Detect clipped matches: compare each range against the visible window.
    if (matchGroup.length > 1) {
      const rawText = first.lineText || '';
      const adjFirst = Math.max(0, first.column - dedent);
      const lineLength = rawText.length - dedent;
      const win = computeVisibleWindow(lineLength, adjFirst, first.matchLength || 0, MAX_MATCH_LINE_DISPLAY);
      if (win) {
        for (let i = 1; i < matchGroup.length; i++) {
          const adjCol = Math.max(0, matchGroup[i].column - dedent);
          if (adjCol < win.start || adjCol + (matchGroup[i].matchLength || 0) > win.end) {
            clippedCount++;
          }
        }
      }
    }
  } else {
    // Plain-text fallback: highlight all match ranges on this line.
    const rawText = first.lineText || '';
    const lineText = rawText.slice(dedent);

    // Build sorted ranges adjusted for dedent
    const ranges = matchGroup.map(m => ({
      col: Math.max(0, (m.column || 0) - dedent),
      len: m.matchLength || 0,
    }));

    // Window centered on the first match
    const win = computeVisibleWindow(lineText.length, ranges[0].col, ranges[0].len, MAX_MATCH_LINE_DISPLAY);

    if (!win) {
      // Line fits — highlight all ranges
      let pos = 0;
      for (const r of ranges) {
        if (r.len > 0 && r.col + r.len <= lineText.length) {
          textEl.appendChild(document.createTextNode(lineText.slice(pos, r.col)));
          const hl = document.createElement('span');
          hl.className = 'match-highlight';
          hl.textContent = lineText.slice(r.col, r.col + r.len);
          textEl.appendChild(hl);
          pos = r.col + r.len;
        }
      }
      textEl.appendChild(document.createTextNode(lineText.slice(pos)));
    } else {
      // Truncated: highlight ranges within the visible window
      if (win.start > 0) { textEl.appendChild(document.createTextNode('\u2026')); }
      let pos = win.start;
      for (const r of ranges) {
        const rEnd = r.col + r.len;
        if (rEnd <= win.start || r.col >= win.end) {
          clippedCount++;
          continue;
        }
        if (r.len > 0) {
          textEl.appendChild(document.createTextNode(lineText.slice(pos, r.col)));
          const hl = document.createElement('span');
          hl.className = 'match-highlight';
          hl.textContent = lineText.slice(r.col, rEnd);
          textEl.appendChild(hl);
          pos = rEnd;
        }
      }
      textEl.appendChild(document.createTextNode(lineText.slice(pos, win.end)));
      if (win.end < lineText.length) { textEl.appendChild(document.createTextNode('\u2026')); }
    }
  }

  row.appendChild(textEl);

  // Append warning badge when some matches were clipped by the visible window
  if (clippedCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'match-clipped-badge';
    badge.innerHTML = SVG_WARNING + ' +' + clippedCount;
    badge.title = clippedCount + ' more match' + (clippedCount !== 1 ? 'es' : '') + ' on this line (not visible)';
    row.appendChild(badge);
  }

  li.appendChild(row);
  return li;
}

// Renders a single context line (surrounding code) beneath a file row in search-results mode.
// Context lines are dimmed relative to match lines and share the same click behaviour.
// dedent: number of leading characters to strip (computed per match group for relative indentation).
export function renderContextLine(ctx: RendererContext, file: FileNode, match: SearchMatch, depth: number, ancestors: IndentAncestor[], dedent: number = 0): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.nodePath = 'context:' + file.path + ':' + match.line;
  const row = document.createElement('div');
  row.className = 'match-context-row';
  row.dataset.action = 'openFileAtLine';
  row.dataset.path = file.path;
  row.dataset.line = String(match.line);
  row.appendChild(ctx.renderIndentGuides(depth, ancestors));

  const lineNumEl = document.createElement('span');
  lineNumEl.className = 'match-line-number';
  lineNumEl.textContent = String(match.line);
  row.appendChild(lineNumEl);

  const textEl = document.createElement('span');
  textEl.className = 'match-line-text';
  if (match.highlightedHtml) {
    textEl.innerHTML = match.highlightedHtml;
    stripLeadingChars(textEl, dedent);
  } else {
    textEl.textContent = (match.lineText || '').slice(dedent);
  }
  row.appendChild(textEl);
  li.appendChild(row);
  return li;
}

// Renders a clickable "N more matches" summary row when match lines exceed the truncation threshold.
// Uses the same dir-row truncated-row structure as file truncation rows for visual consistency.
export function renderMoreMatchesRow(ctx: RendererContext, count: number, depth: number, ancestors: IndentAncestor[], filePath: string): HTMLLIElement {
  const li = document.createElement('li');
  if (filePath) { li.dataset.nodePath = 'more:' + filePath; }
  const row = document.createElement('div');
  row.className = 'dir-row truncated-row match-more-row';
  // data-action + data-dir-path reuse the expandTruncated handler to expand match lines.
  row.dataset.action = 'expandTruncated';
  row.dataset.dirPath = filePath;
  row.appendChild(ctx.renderIndentGuides(depth, ancestors));
  const plusSlot = document.createElement('span');
  plusSlot.className = 'chevron';
  plusSlot.innerHTML = SVG_PLUS;
  row.appendChild(plusSlot);
  const label = document.createElement('span');
  label.className = 'dir-name';
  label.textContent = `${count} more match${count !== 1 ? 'es' : ''}`;
  row.appendChild(label);
  li.appendChild(row);
  return li;
}

// Renders inline match lines (and optional context lines) beneath a file row when content
// search is active. Respects matchesCollapsed state and uses truncateThreshold for truncation.
// Inserts a separator element between non-contiguous line groups (gaps in line numbers).
export function renderFileMatches(ctx: RendererContext, container: HTMLElement, file: FileNode, depth: number, ancestors: IndentAncestor[]): void {
  const { state } = ctx;
  if (!state.searchResults?.has(file.path)) { return; }
  const fileMatches = state.searchResults.get(file.path);
  if (!fileMatches || fileMatches.length === 0) { return; }

  // If the user has collapsed this file's matches, don't render any.
  if (state.matchesCollapsed.has(file.path)) { return; }

  // Sort by line number — entries arrive sorted from the backend but sorting here is
  // defensive against any reordering during streaming patches.
  const sorted = fileMatches.slice().sort((a, b) => a.line - b.line);

  // ── Phase 1: Build match groups ──────────────────────────────────────────
  // Each group: { matchGroup: Match[], matchLine: number, contextBefore: Context[], contextAfter: Context[] }
  // Context lines between two matches are split at the midpoint (nearest-match rule).

  interface MatchGroupEntry {
    matchGroup: SearchMatch[];
    matchLine: number;
    contextBefore: SearchMatch[];
    contextAfter: SearchMatch[];
    dedent: number;
  }

  const groups: MatchGroupEntry[] = [];
  let contextBuffer: SearchMatch[] = [];

  for (let i = 0; i < sorted.length; ) {
    const m = sorted[i];

    if (m.isContext) {
      contextBuffer.push(m);
      i++;
      continue;
    }

    // Group consecutive same-line non-context matches.
    const sameLineGroup: SearchMatch[] = [m];
    let j = i + 1;
    while (j < sorted.length && !sorted[j].isContext && sorted[j].line === m.line) {
      sameLineGroup.push(sorted[j]);
      j++;
    }

    // Split buffered context between previous group's contextAfter and this group's contextBefore.
    if (contextBuffer.length > 0) {
      if (groups.length === 0) {
        // All buffered context belongs to this group as contextBefore.
        groups.push({ matchGroup: sameLineGroup, matchLine: m.line, contextBefore: contextBuffer, contextAfter: [], dedent: 0 });
      } else {
        const mid = Math.ceil(contextBuffer.length / 2);
        groups[groups.length - 1].contextAfter = contextBuffer.slice(0, mid);
        groups.push({ matchGroup: sameLineGroup, matchLine: m.line, contextBefore: contextBuffer.slice(mid), contextAfter: [], dedent: 0 });
      }
      contextBuffer = [];
    } else {
      groups.push({ matchGroup: sameLineGroup, matchLine: m.line, contextBefore: [], contextAfter: [], dedent: 0 });
    }

    i = j;
  }

  // Trailing context goes to last group's contextAfter.
  if (contextBuffer.length > 0 && groups.length > 0) {
    groups[groups.length - 1].contextAfter = contextBuffer;
  }

  // Trim empty/whitespace-only context lines from the edges of each group.
  for (const g of groups) {
    while (g.contextBefore.length > 0 && g.contextBefore[0].lineText.trim() === '') { g.contextBefore.shift(); }
    while (g.contextAfter.length > 0 && g.contextAfter[g.contextAfter.length - 1].lineText.trim() === '') { g.contextAfter.pop(); }
  }

  // ── Phase 1.5: Compute per-group minimum indentation for dedent ────────
  // Strips the shared leading whitespace from all lines in a group so that
  // relative indentation is preserved while the display is left-aligned.
  for (const g of groups) {
    const allLines = [...g.contextBefore, ...g.matchGroup, ...g.contextAfter];
    let minIndent = Infinity;
    for (const m of allLines) {
      const text = m.lineText || '';
      if (text.trim() === '') { continue; } // skip blank lines
      const indent = text.length - text.trimStart().length;
      if (indent < minIndent) { minIndent = indent; }
    }
    g.dedent = minIndent === Infinity ? 0 : minIndent;
  }

  // ── Phase 2: Render groups ───────────────────────────────────────────────

  const threshold = state.truncateThreshold;
  const shouldTruncateMatches = threshold > 0 && groups.length > threshold && !state.truncationExpanded.has(file.path);

  let prevLastLine: number | null = null; // last line number of previous group (for separator detection)

  for (let gi = 0; gi < groups.length; gi++) {
    if (shouldTruncateMatches && gi >= threshold) { break; }

    const g = groups[gi];
    const firstLineInGroup = g.contextBefore.length > 0 ? g.contextBefore[0].line : g.matchLine;

    // Create wrapper <li> that carries click/context-menu for the match line.
    // Add gap-before class when there's a line discontinuity from the previous group.
    const hasGap = prevLastLine !== null && firstLineInGroup > prevLastLine + 1;
    const wrapper = document.createElement('li');
    wrapper.className = 'match-group' + (hasGap ? ' gap-before' : '');
    wrapper.dataset.nodePath = 'match:' + file.path + ':' + g.matchGroup[0].line;
    wrapper.dataset.action = 'openFileAtLine';
    wrapper.dataset.path = file.path;
    wrapper.dataset.line = String(g.matchGroup[0].line);
    wrapper.setAttribute('data-vscode-context', JSON.stringify({
      webviewSection: 'matchLine',
      path: file.path,
      lineText: g.matchGroup[0].lineText || '',
      preventDefaultContextMenuItems: true
    }));

    // Insert a spacer div with indent guides to bridge the gap between groups.
    if (hasGap) {
      const spacer = document.createElement('div');
      spacer.className = 'match-group-spacer';
      spacer.appendChild(ctx.renderIndentGuides(depth, ancestors));
      wrapper.appendChild(spacer);
    }

    // Append context-before divs (no data-action — clicks bubble to wrapper).
    for (const ctxMatch of g.contextBefore) {
      const ctxLi = renderContextLine(ctx, file, ctxMatch, depth, ancestors, g.dedent);
      const ctxDiv = ctxLi.firstElementChild as HTMLElement;
      delete ctxDiv.dataset.action;
      delete ctxDiv.dataset.path;
      delete ctxDiv.dataset.line;
      wrapper.appendChild(ctxDiv);
    }

    // Append match div.
    const matchLi = renderMatchLine(ctx, file, g.matchGroup, depth, ancestors, g.dedent);
    const matchDiv = matchLi.firstElementChild as HTMLElement;
    matchDiv.removeAttribute('data-vscode-context');
    wrapper.appendChild(matchDiv);

    // Append context-after divs.
    for (const ctxMatch of g.contextAfter) {
      const ctxLi = renderContextLine(ctx, file, ctxMatch, depth, ancestors, g.dedent);
      const ctxDiv = ctxLi.firstElementChild as HTMLElement;
      delete ctxDiv.dataset.action;
      delete ctxDiv.dataset.path;
      delete ctxDiv.dataset.line;
      wrapper.appendChild(ctxDiv);
    }

    container.appendChild(wrapper);

    const lastCtxAfter = g.contextAfter.length > 0 ? g.contextAfter[g.contextAfter.length - 1].line : g.matchLine;
    prevLastLine = lastCtxAfter;
  }

  if (shouldTruncateMatches) {
    container.appendChild(renderMoreMatchesRow(ctx, groups.length - threshold, depth, ancestors, file.path));
  }
}
