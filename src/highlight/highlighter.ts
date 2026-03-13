import { createHighlighter, createCssVariablesTheme, bundledLanguages, type Highlighter, type ThemedToken } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki';

// Map from linguist language names (used in languageMap.ts) to Shiki bundled language IDs.
// Languages absent from this map fall back to plain-text rendering.
const LANG_TO_SHIKI: Record<string, string> = {
  'TypeScript': 'typescript',
  'JavaScript': 'javascript',
  'TSX': 'tsx',
  'Python': 'python',
  'Rust': 'rust',
  'Go': 'go',
  'Java': 'java',
  'C': 'c',
  'C++': 'cpp',
  'C#': 'csharp',
  'Ruby': 'ruby',
  'PHP': 'php',
  'Swift': 'swift',
  'Kotlin': 'kotlin',
  'HTML': 'html',
  'CSS': 'css',
  'SCSS': 'scss',
  'Less': 'less',
  'JSON': 'json',
  'YAML': 'yaml',
  'TOML': 'toml',
  'Markdown': 'markdown',
  'Shell': 'bash',
  'Bash': 'bash',
  'PowerShell': 'powershell',
  'SQL': 'sql',
  'GraphQL': 'graphql',
  'Dockerfile': 'dockerfile',
  'XML': 'xml',
  'Lua': 'lua',
  'Perl': 'perl',
  'Scala': 'scala',
  'Elixir': 'elixir',
  'Erlang': 'erlang',
  'Haskell': 'haskell',
  'OCaml': 'ocaml',
  'F#': 'fsharp',
  'Clojure': 'clojure',
  'Dart': 'dart',
  'Vue': 'vue',
  'Svelte': 'svelte',
  'R': 'r',
  'Makefile': 'makefile',
  'Zig': 'zig',
  'Nix': 'nix',
};

// Only keep langs that are actually in Shiki's bundled set
const BUNDLED_LANG_IDS = new Set(Object.keys(bundledLanguages));
const VALID_LANGS = Object.entries(LANG_TO_SHIKI)
  .filter(([, shikiId]) => BUNDLED_LANG_IDS.has(shikiId))
  .map(([, shikiId]) => shikiId as keyof typeof bundledLanguages);
const VALID_LANG_SET = new Set(VALID_LANGS);

// Build a corrected map containing only langs we can actually load
const resolvedLangMap: Record<string, string> = {};
for (const [linguist, shikiId] of Object.entries(LANG_TO_SHIKI)) {
  if (VALID_LANG_SET.has(shikiId as keyof typeof bundledLanguages)) {
    resolvedLangMap[linguist] = shikiId;
  }
}

const THEME = createCssVariablesTheme();
const THEME_NAME = THEME.name;

// Max line length to syntax-highlight; longer lines are truncated to context around the match
const MAX_LINE = 120;

// Lazy singleton — created on first call to highlightLine()
let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: VALID_LANGS.map((id) => bundledLanguages[id as keyof typeof bundledLanguages]),
      themes: [THEME],
      engine: createJavaScriptRegexEngine(),
    }).catch((err) => {
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
  return color && color !== 'var(--shiki-foreground)'
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
  const shikiLang = resolvedLangMap[langName];
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
      theme: THEME_NAME,
      includeExplanation: false,
    });
    const lineTokens = tokens[0] ?? [];
    return buildHighlightedHtml(lineTokens, adjustedCol, len);
  } catch {
    return undefined;
  }
}
