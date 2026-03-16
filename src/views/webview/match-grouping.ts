// Shared match group assembly logic — used by both the non-virtual renderer
// (matches.ts) and the virtual scroll flattener (flatten.ts).

import type { SearchMatch } from './types';

/** A merged group of one or more match-line clusters with surrounding context. */
export interface MatchGroupEntry {
  /** One or more match-line clusters, each with their match entries and inter-match context. */
  matches: Array<{
    matchGroup: SearchMatch[];     // Same-line matches
    matchLine: number;             // Line number
    contextBefore: SearchMatch[];  // Context lines before this match (inter-match context for non-first)
  }>;
  contextAfter: SearchMatch[];     // Trailing context after the last match
  dedent: number;
}

/** Intermediate single-match group used before merging. */
interface SingleMatchGroup {
  matchGroup: SearchMatch[];
  matchLine: number;
  contextBefore: SearchMatch[];
  contextAfter: SearchMatch[];
}

/**
 * Assembles sorted search matches into merged match groups with computed dedent.
 *
 * Phase 1: Build single match groups — groups consecutive same-line matches,
 *   splits context between adjacent groups at the midpoint.
 * Phase 1.5: Merge contiguous groups — when there's no gap between groups,
 *   merge them and turn the context into inter-match context.
 * Phase 1.75: Compute per-group minimum indentation for dedent.
 */
export function assembleMatchGroups(sorted: SearchMatch[]): MatchGroupEntry[] {
  // ── Phase 1: Build single match groups ────────────────────────────────
  const singleGroups: SingleMatchGroup[] = [];
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
      if (singleGroups.length === 0) {
        // All buffered context belongs to this group as contextBefore.
        singleGroups.push({ matchGroup: sameLineGroup, matchLine: m.line, contextBefore: contextBuffer, contextAfter: [] });
      } else {
        const mid = Math.ceil(contextBuffer.length / 2);
        singleGroups[singleGroups.length - 1].contextAfter = contextBuffer.slice(0, mid);
        singleGroups.push({ matchGroup: sameLineGroup, matchLine: m.line, contextBefore: contextBuffer.slice(mid), contextAfter: [] });
      }
      contextBuffer = [];
    } else {
      singleGroups.push({ matchGroup: sameLineGroup, matchLine: m.line, contextBefore: [], contextAfter: [] });
    }

    i = j;
  }

  // Trailing context goes to last group's contextAfter.
  if (contextBuffer.length > 0 && singleGroups.length > 0) {
    singleGroups[singleGroups.length - 1].contextAfter = contextBuffer;
  }

  // Trim empty/whitespace-only context lines from the edges of each group.
  for (const g of singleGroups) {
    while (g.contextBefore.length > 0 && g.contextBefore[0].lineText.trim() === '') { g.contextBefore.shift(); }
    while (g.contextAfter.length > 0 && g.contextAfter[g.contextAfter.length - 1].lineText.trim() === '') { g.contextAfter.pop(); }
  }

  // ── Phase 1.5: Merge contiguous groups ────────────────────────────────
  const groups: MatchGroupEntry[] = [];
  for (const sg of singleGroups) {
    const firstLine = sg.contextBefore.length > 0 ? sg.contextBefore[0].line : sg.matchLine;
    if (groups.length > 0) {
      const prev = groups[groups.length - 1];
      const prevLastMatch = prev.matches[prev.matches.length - 1];
      const prevLastLine = prev.contextAfter.length > 0
        ? prev.contextAfter[prev.contextAfter.length - 1].line
        : prevLastMatch.matchLine;
      if (firstLine <= prevLastLine + 1) {
        // Contiguous — merge: prev's contextAfter + sg's contextBefore become inter-match context
        const interContext = [...prev.contextAfter, ...sg.contextBefore];
        prev.contextAfter = sg.contextAfter;
        prev.matches.push({
          matchGroup: sg.matchGroup,
          matchLine: sg.matchLine,
          contextBefore: interContext,
        });
        continue;
      }
    }
    // Not contiguous or first group — start a new merged group
    groups.push({
      matches: [{
        matchGroup: sg.matchGroup,
        matchLine: sg.matchLine,
        contextBefore: sg.contextBefore,
      }],
      contextAfter: sg.contextAfter,
      dedent: 0,
    });
  }

  // ── Phase 1.75: Compute per-group minimum indentation for dedent ──────
  for (const g of groups) {
    const allLines: SearchMatch[] = [];
    for (const m of g.matches) {
      allLines.push(...m.contextBefore, ...m.matchGroup);
    }
    allLines.push(...g.contextAfter);
    let minIndent = Infinity;
    for (const m of allLines) {
      const text = m.lineText || '';
      if (text.trim() === '') { continue; } // skip blank lines
      const indent = text.length - text.trimStart().length;
      if (indent < minIndent) { minIndent = indent; }
    }
    g.dedent = minIndent === Infinity ? 0 : minIndent;
  }

  return groups;
}
