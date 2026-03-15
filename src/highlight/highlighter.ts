import { createHighlighter, bundledLanguages, bundledThemes, type Highlighter, type ThemedToken } from 'shiki';
import { createOnigurumaEngine } from 'shiki';
import onigurumaWasm from '@shikijs/engine-oniguruma/wasm-inlined';
import { groupMap } from '../language/languageMap';

const BUNDLED_LANG_IDS = new Set(Object.keys(bundledLanguages));

/** Resolve a linguist language name to a Shiki grammar ID, or undefined if unsupported. */
export function resolveShikiLang(langName: string): string | undefined {
  const lower = langName.toLowerCase();
  if (BUNDLED_LANG_IDS.has(lower)) { return lower; }
  // Fallback: check linguist group (e.g., "Maven POM" → "XML" → "xml")
  const group = groupMap.get(langName);
  if (group) {
    const groupLower = group.toLowerCase();
    if (BUNDLED_LANG_IDS.has(groupLower)) { return groupLower; }
  }
  return undefined;
}

// Track current theme based on VSCode's active color theme kind.
// ColorThemeKind: 1=Light, 2=Dark, 3=HighContrast, 4=HighContrastLight
let currentThemeName: string = 'dark-plus';

/**
 * Updates the Shiki theme to match the active VSCode color theme kind.
 * Lazily re-creates the highlighter on the next highlight call if the theme changed.
 */
export function updateTheme(kind: number): void {
  const name = (kind === 1 || kind === 4) ? 'light-plus' : 'dark-plus';
  if (name === currentThemeName && highlighterPromise) { return; }
  currentThemeName = name;
  highlighterPromise = undefined; // lazy re-create on next highlight call
  loadedLangs = new Map(); // grammars must be reloaded with the new highlighter
}

// Max visible characters in the rendered match line
const MAX_DISPLAY = 120;
// Lines longer than this are skipped entirely (too expensive to tokenize)
const MAX_HIGHLIGHT = 256;

// Lazy singleton — created on first call to highlightLine()
let highlighterPromise: Promise<Highlighter> | undefined;
// Tracks which grammars have been loaded. Values are loading promises to prevent
// concurrent duplicate loads of the same language.
let loadedLangs = new Map<string, Promise<void>>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // Oniguruma (WASM) engine handles all TextMate grammar regex patterns natively,
    // unlike the JS engine which fails on grammars requiring the `v` (unicode sets)
    // flag unsupported in VSCode's embedded Node.js runtime.
    // Starts with zero grammars — languages are loaded on demand in highlightLine().
    highlighterPromise = createOnigurumaEngine(onigurumaWasm).then((engine) =>
      createHighlighter({
        langs: [],
        themes: [bundledThemes[currentThemeName as keyof typeof bundledThemes]],
        engine,
      })
    ).catch((err) => {
      highlighterPromise = undefined; // allow retry on next call
      throw err;
    });
  }
  return highlighterPromise;
}

/** Loads a Shiki grammar on demand if not already loaded. */
async function ensureLangLoaded(h: Highlighter, shikiLang: string): Promise<void> {
  if (loadedLangs.has(shikiLang)) {
    return loadedLangs.get(shikiLang);
  }
  const langDef = bundledLanguages[shikiLang as keyof typeof bundledLanguages];
  if (!langDef) { return; }
  const p = h.loadLanguage(langDef).then(() => { /* loaded */ });
  loadedLangs.set(shikiLang, p);
  return p;
}

/** Trims leading whitespace from a raw line and adjusts the match column accordingly. */
export function trimLeadingWhitespace(rawText: string, col: number): { lineText: string; adjustedCol: number } {
  const trimmedStart = rawText.length - rawText.trimStart().length;
  return { lineText: rawText.trimStart(), adjustedCol: Math.max(0, col - trimmedStart) };
}

/**
 * Returns a visible window `{ start, end }` when `lineLength > maxDisplay`, centered on the match,
 * or null if the line fits within `maxDisplay` characters and no windowing is needed.
 * Must stay in sync with computeVisibleWindow in shared-renderer.js.
 */
export function computeVisibleWindow(
  lineLength: number, col: number, matchLen: number, maxDisplay: number
): { start: number; end: number } | null {
  if (lineLength <= maxDisplay) { return null; }
  const half = Math.floor((maxDisplay - matchLen) / 2);
  return { start: Math.max(0, col - half), end: Math.min(lineLength, col + matchLen + half) };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSpan(content: string, color: string | undefined): string {
  if (!content) { return ''; }
  const escaped = escapeHtml(content);
  return color
    ? `<span style="color:${color}">${escaped}</span>`
    : escaped;
}

/**
 * Builds a flat HTML string from Shiki tokens with one or more match highlights injected.
 * Each range in `ranges` is highlighted with `<span class="match-highlight">`.
 * Ranges must be non-overlapping and sorted by `col` (ascending).
 *
 * When `visibleStart`/`visibleEnd` are provided, only the characters within
 * [visibleStart, visibleEnd) are emitted, with `…` ellipsis at the boundaries.
 * The full token stream is still iterated so that syntax colors are correct.
 */
export function buildHighlightedHtml(
  tokens: ThemedToken[], col: number, len: number,
  visibleStart?: number, visibleEnd?: number,
  ranges?: Array<{ col: number; len: number }>
): string {
  // Normalise to a sorted ranges array
  const matchRanges = ranges ?? (len > 0 ? [{ col, len }] : []);
  const hasWindow = visibleStart !== undefined && visibleEnd !== undefined;
  let pos = 0;
  let html = '';
  let inMatch = false;
  let rangeIdx = 0; // index into matchRanges

  if (hasWindow && visibleStart! > 0) { html += '\u2026'; } // leading ellipsis

  for (const token of tokens) {
    const tokenLen = token.content.length;
    const tokenEnd = pos + tokenLen;

    // Skip tokens entirely outside the visible window
    if (hasWindow && tokenEnd <= visibleStart!) { pos = tokenEnd; continue; }
    if (hasWindow && pos >= visibleEnd!) { pos = tokenEnd; continue; }

    // Determine the slice of this token that falls within the visible window
    let sliceStart = 0;
    let sliceEnd = tokenLen;
    if (hasWindow) {
      if (pos < visibleStart!) { sliceStart = visibleStart! - pos; }
      if (tokenEnd > visibleEnd!) { sliceEnd = visibleEnd! - pos; }
    }

    // Walk through the visible slice, splitting at match range boundaries
    let offset = sliceStart;
    while (offset < sliceEnd) {
      const absPos = pos + offset;

      // Close current match-highlight if we've passed its end
      if (inMatch) {
        const curEnd = matchRanges[rangeIdx].col + matchRanges[rangeIdx].len;
        if (absPos >= curEnd) {
          html += '</span>';
          inMatch = false;
          rangeIdx++;
        }
      }

      // Skip past any ranges that end before the current position
      while (rangeIdx < matchRanges.length && matchRanges[rangeIdx].col + matchRanges[rangeIdx].len <= absPos) {
        rangeIdx++;
      }

      if (rangeIdx >= matchRanges.length) {
        // No more match ranges — emit the rest of the token slice
        html += renderSpan(token.content.slice(offset, sliceEnd), token.color);
        offset = sliceEnd;
        break;
      }

      const range = matchRanges[rangeIdx];
      const rangeEnd = range.col + range.len;

      if (absPos < range.col) {
        // Before the next range — emit text up to the range start or slice end
        const take = Math.min(range.col - pos, sliceEnd);
        html += renderSpan(token.content.slice(offset, take), token.color);
        offset = take;
      } else if (absPos < rangeEnd) {
        // Inside a range
        if (!inMatch) { html += '<span class="match-highlight">'; inMatch = true; }
        const take = Math.min(rangeEnd - pos, sliceEnd);
        html += renderSpan(token.content.slice(offset, take), token.color);
        offset = take;
      }
    }

    pos = tokenEnd;
  }

  if (inMatch) { html += '</span>'; }
  if (hasWindow && visibleEnd! < totalLength(tokens)) { html += '\u2026'; } // trailing ellipsis
  return html;
}

function totalLength(tokens: ThemedToken[]): number {
  let n = 0;
  for (const t of tokens) { n += t.content.length; }
  return n;
}

/**
 * Syntax-highlights a line with multiple match ranges highlighted.
 * Ranges must be non-overlapping and sorted by column (ascending).
 * Returns `undefined` if the language is unsupported (fall back to plain text).
 */
export async function highlightLineMulti(
  rawText: string,
  ranges: Array<{ col: number; len: number }>,
  langName: string
): Promise<string | undefined> {
  const shikiLang = resolveShikiLang(langName);
  if (!shikiLang) { return undefined; }

  // Trim leading whitespace once, adjusting all columns
  const trimmedStart = rawText.length - rawText.trimStart().length;
  const lineText = rawText.trimStart();

  if (lineText.length > MAX_HIGHLIGHT) { return undefined; }

  const adjustedRanges = ranges.map(r => ({
    col: Math.max(0, r.col - trimmedStart),
    len: r.len,
  }));

  // Compute visible window centered on the first match (option 1 from plan)
  const firstRange = adjustedRanges[0];
  const win = firstRange
    ? computeVisibleWindow(lineText.length, firstRange.col, firstRange.len, MAX_DISPLAY)
    : null;

  try {
    const h = await getHighlighter();
    await ensureLangLoaded(h, shikiLang);
    const { tokens } = h.codeToTokens(lineText, {
      lang: shikiLang,
      theme: currentThemeName,
      includeExplanation: false,
    });
    const lineTokens = tokens[0] ?? [];

    return buildHighlightedHtml(lineTokens, 0, 0, win?.start, win?.end, adjustedRanges);
  } catch {
    return undefined;
  }
}

/**
 * Syntax-highlights a single match line and injects a match-highlight span.
 * Returns `undefined` if the language is unsupported (fall back to plain text).
 */
export async function highlightLine(
  rawText: string,
  col: number,
  len: number,
  langName: string
): Promise<string | undefined> {
  return highlightLineMulti(rawText, [{ col, len }], langName);
}
