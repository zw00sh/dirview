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
}

// Max line length to syntax-highlight; longer lines are truncated to context around the match
const MAX_LINE = 120;

// Lazy singleton — created on first call to highlightLine()
let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // Oniguruma (WASM) engine handles all TextMate grammar regex patterns natively,
    // unlike the JS engine which fails on grammars requiring the `v` (unicode sets)
    // flag unsupported in VSCode's embedded Node.js runtime.
    highlighterPromise = createOnigurumaEngine(onigurumaWasm).then((engine) =>
      createHighlighter({
        langs: Object.values(bundledLanguages),
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
 * Builds a flat HTML string from Shiki tokens with a match highlight injected.
 * The match highlight spans character range [col, col+len). Syntax-color spans
 * are nested inside `<span class="match-highlight">` where they overlap.
 */
export function buildHighlightedHtml(tokens: ThemedToken[], col: number, len: number): string {
  const matchEnd = col + len;
  let pos = 0;
  let html = '';
  let inMatch = false;

  for (const token of tokens) {
    const tokenLen = token.content.length;
    const tokenEnd = pos + tokenLen;

    // Fast path: token entirely before or after match range
    if (tokenEnd <= col || pos >= matchEnd) {
      if (inMatch) { html += '</span>'; inMatch = false; }
      html += renderSpan(token.content, token.color);
      pos = tokenEnd;
      continue;
    }

    // Token overlaps with match range — split at boundaries
    let offset = 0; // position within token.content

    // Part before match start
    if (pos < col) {
      const take = col - pos;
      html += renderSpan(token.content.slice(0, take), token.color);
      offset = take;
    }

    // Open match-highlight if not already open
    if (!inMatch) { html += '<span class="match-highlight">'; inMatch = true; }

    // Part inside match range
    const insideEnd = Math.min(tokenLen, matchEnd - pos);
    html += renderSpan(token.content.slice(offset, insideEnd), token.color);

    // Close match-highlight if token extends past match end
    if (tokenEnd > matchEnd) {
      html += '</span>';
      inMatch = false;
      html += renderSpan(token.content.slice(insideEnd), token.color);
    }

    pos = tokenEnd;
  }

  if (inMatch) { html += '</span>'; }
  return html;
}

/**
 * Syntax-highlights a single match line and injects a match-highlight span.
 * Returns `undefined` if the language is unsupported (fall back to plain text).
 *
 * @param rawText   The raw line text from ripgrep (may have leading whitespace)
 * @param col       0-based match start column in rawText
 * @param len       Match length in characters
 * @param langName  Linguist language name (e.g. 'TypeScript')
 */
export async function highlightLine(
  rawText: string,
  col: number,
  len: number,
  langName: string
): Promise<string | undefined> {
  const shikiLang = resolveShikiLang(langName);
  if (!shikiLang) { return undefined; }

  // Trim leading whitespace; adjust column to stay in sync
  const trimmedStart = rawText.length - rawText.trimStart().length;
  const lineText = rawText.trimStart();
  let adjustedCol = Math.max(0, col - trimmedStart);

  // Truncate to context window centered around the match (mirrors renderMatchLine logic)
  let text = lineText;
  if (lineText.length > MAX_LINE) {
    const half = Math.floor((MAX_LINE - len) / 2);
    const start = Math.max(0, adjustedCol - half);
    const end = Math.min(lineText.length, adjustedCol + len + half);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < lineText.length ? '…' : '';
    text = prefix + lineText.slice(start, end) + suffix;
    // '…' is one JS character
    adjustedCol = adjustedCol - start + prefix.length;
  }

  try {
    const h = await getHighlighter();
    const { tokens } = h.codeToTokens(text, {
      lang: shikiLang,
      theme: currentThemeName,
      includeExplanation: false,
    });
    const lineTokens = tokens[0] ?? [];
    return buildHighlightedHtml(lineTokens, adjustedCol, len);
  } catch {
    return undefined;
  }
}
