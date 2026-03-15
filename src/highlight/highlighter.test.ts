import { describe, it, expect } from 'vitest';
import { buildHighlightedHtml, resolveShikiLang, trimLeadingWhitespace, computeVisibleWindow, highlightGroup } from './highlighter';
import type { ThemedToken } from 'shiki';

function tok(content: string, color?: string): ThemedToken {
  return { content, offset: 0, color, fontStyle: 0 } as ThemedToken;
}

describe('buildHighlightedHtml', () => {
  it('wraps match range in match-highlight span', () => {
    // "hello world" — highlight "world" (col=6, len=5)
    const tokens = [tok('hello '), tok('world', '#569cd6')];
    const html = buildHighlightedHtml(tokens, 6, 5);
    expect(html).toContain('<span class="match-highlight">');
    expect(html).toContain('world');
    // "hello " should appear before the highlight
    expect(html.indexOf('hello')).toBeLessThan(html.indexOf('match-highlight'));
  });

  it('splits a token that straddles the match start', () => {
    // Token "foobar" col=0..6, match starts at col=3 (len=3 = "bar")
    const tokens = [tok('foobar', '#569cd6')];
    const html = buildHighlightedHtml(tokens, 3, 3);
    // "foo" before highlight, "bar" inside highlight
    expect(html).toMatch(/foo.*match-highlight.*bar/s);
    expect(html).not.toMatch(/match-highlight.*foo/s);
  });

  it('splits a token that straddles the match end', () => {
    // Tokens: "ab" + "cdef", match col=1..3 = "bc" (spans boundary)
    const tokens = [tok('ab'), tok('cdef')];
    const html = buildHighlightedHtml(tokens, 1, 2);
    expect(html).toContain('<span class="match-highlight">');
    // "a" before, "bc" inside, "def" after
    expect(html.indexOf('a')).toBeLessThan(html.indexOf('match-highlight'));
    expect(html.indexOf('def')).toBeGreaterThan(html.lastIndexOf('</span>'));
  });

  it('match spans multiple tokens entirely', () => {
    const tokens = [tok('before'), tok('tok1', '#569cd6'), tok('tok2', '#ce9178'), tok('after')];
    // match covers tok1+tok2 exactly: col 6, len 8 (before=6 chars, tok1+tok2=4+4=8 chars)
    const html = buildHighlightedHtml(tokens, 6, 8);
    const hlOpen = html.indexOf('<span class="match-highlight">');
    expect(hlOpen).toBeGreaterThan(-1);
    // both tok1 and tok2 should appear after the opening match-highlight tag
    expect(html.indexOf('tok1')).toBeGreaterThan(hlOpen);
    expect(html.indexOf('tok2')).toBeGreaterThan(hlOpen);
    // "after" and "before" should be outside the match-highlight span
    expect(html.indexOf('before')).toBeLessThan(hlOpen);
    // Find the match-highlight closing tag that appears after tok2
    const tok2End = html.indexOf('tok2') + 4;
    const closingAfterTok2 = html.indexOf('</span>', tok2End);
    expect(html.indexOf('after')).toBeGreaterThan(closingAfterTok2);
  });

  it('returns plain text (no highlight) when len=0', () => {
    const tokens = [tok('some code', '#569cd6')];
    const html = buildHighlightedHtml(tokens, 0, 0);
    expect(html).not.toContain('match-highlight');
    expect(html).toContain('some code');
  });

  it('escapes HTML entities in token content', () => {
    // &, <, > must be escaped; " is safe in HTML text content and left as-is
    const tokens = [tok('<div>&', '#569cd6'), tok('"text"')];
    const html = buildHighlightedHtml(tokens, 0, 0);
    expect(html).toContain('&lt;div&gt;&amp;');
    expect(html).toContain('"text"');
    expect(html).not.toContain('<div>');
  });

  it('omits style attribute for foreground color (undefined)', () => {
    // Tokens with no color (foreground) should render as plain text (no span)
    const tokens = [tok('plain')];
    const html = buildHighlightedHtml(tokens, 0, 0);
    expect(html).toBe('plain');
    expect(html).not.toContain('<span');
  });

  it('handles match at start of line', () => {
    const tokens = [tok('const', '#569cd6'), tok(' x = 1')];
    const html = buildHighlightedHtml(tokens, 0, 5);
    expect(html).toMatch(/^<span class="match-highlight">/);
    expect(html).toContain('const');
  });

  it('handles match at end of line', () => {
    const tokens = [tok('x = '), tok('true', '#4fc1ff')];
    const html = buildHighlightedHtml(tokens, 4, 4);
    expect(html).toContain('x = ');
    expect(html).toMatch(/<span class="match-highlight">.*true.*<\/span>$/s);
  });

  it('handles empty token list', () => {
    expect(buildHighlightedHtml([], 0, 5)).toBe('');
  });

  it('match col beyond token range — no highlight injected', () => {
    const tokens = [tok('short')];
    const html = buildHighlightedHtml(tokens, 100, 5);
    expect(html).not.toContain('match-highlight');
    expect(html).toContain('short');
  });

  it('visible window truncates tokens before and after', () => {
    // "abcdefghij" — show only chars 3..7 ("defgh")
    const tokens = [tok('abcde', '#569cd6'), tok('fghij', '#ce9178')];
    const html = buildHighlightedHtml(tokens, 0, 0, 3, 7);
    expect(html).toContain('\u2026'); // leading ellipsis
    expect(html).toContain('de');
    expect(html).toContain('fg');
    expect(html).not.toContain('abc');
    expect(html).not.toContain('hij');
  });

  it('visible window preserves match highlight', () => {
    // "hello world test" — match "world" (col=6, len=5), window [3, 14)
    const tokens = [tok('hello ', '#569cd6'), tok('world', '#ce9178'), tok(' test')];
    const html = buildHighlightedHtml(tokens, 6, 5, 3, 14);
    expect(html).toContain('match-highlight');
    expect(html).toContain('world');
    // leading ellipsis (window starts at 3, not 0)
    expect(html.startsWith('\u2026')).toBe(true);
    // trailing ellipsis (window ends at 14, total is 16)
    expect(html.endsWith('\u2026')).toBe(true);
  });

  it('no ellipsis when window covers entire line', () => {
    const tokens = [tok('short')];
    const html = buildHighlightedHtml(tokens, 0, 5, 0, 5);
    expect(html).not.toContain('\u2026');
  });

  it('no window params renders full line (backward compat)', () => {
    const tokens = [tok('full line', '#569cd6')];
    const html = buildHighlightedHtml(tokens, 0, 4);
    expect(html).toContain('full');
    expect(html).toContain(' line');
    expect(html).not.toContain('\u2026');
  });
  it('highlights two non-overlapping ranges on the same line', () => {
    // "foo bar foo" — highlight both "foo" (col=0,len=3 and col=8,len=3)
    const tokens = [tok('foo bar foo', '#569cd6')];
    const ranges = [{ col: 0, len: 3 }, { col: 8, len: 3 }];
    const html = buildHighlightedHtml(tokens, 0, 0, undefined, undefined, ranges);
    // Both "foo" should be wrapped in match-highlight
    const highlights = html.match(/<span class="match-highlight">/g);
    expect(highlights).not.toBeNull();
    expect(highlights!.length).toBe(2);
    // " bar " should be between the two highlights (not inside either)
    expect(html).toContain(' bar ');
  });

  it('highlights ranges spanning multiple tokens', () => {
    // Tokens: "ab" + "cd" + "ef", ranges at col=1..3 ("bc") and col=4..6 ("ef")
    const tokens = [tok('ab', '#569cd6'), tok('cd', '#ce9178'), tok('ef')];
    const ranges = [{ col: 1, len: 2 }, { col: 4, len: 2 }];
    const html = buildHighlightedHtml(tokens, 0, 0, undefined, undefined, ranges);
    const highlights = html.match(/<span class="match-highlight">/g);
    expect(highlights).not.toBeNull();
    expect(highlights!.length).toBe(2);
  });

  it('multi-range with visible window clips ranges outside window', () => {
    // Long line, two ranges far apart. Window should only show the first.
    const text = 'a'.repeat(50) + 'MATCH1' + 'b'.repeat(100) + 'MATCH2' + 'c'.repeat(50);
    const tokens = [tok(text)];
    // First match at col 50, second at col 156
    const ranges = [{ col: 50, len: 6 }, { col: 156, len: 6 }];
    const html = buildHighlightedHtml(tokens, 50, 6, 0, 120, ranges);
    // First match should be highlighted
    expect(html).toContain('MATCH1');
    // Second match is beyond window end (120), should not appear
    expect(html).not.toContain('MATCH2');
  });

  it('empty ranges array produces no highlights', () => {
    const tokens = [tok('hello world')];
    const html = buildHighlightedHtml(tokens, 0, 0, undefined, undefined, []);
    expect(html).not.toContain('match-highlight');
    expect(html).toContain('hello world');
  });
});

describe('resolveShikiLang', () => {
  it('resolves direct lowercase match', () => {
    expect(resolveShikiLang('TypeScript')).toBe('typescript');
    expect(resolveShikiLang('Python')).toBe('python');
    expect(resolveShikiLang('HTML')).toBe('html');
  });

  it('resolves via linguist group fallback', () => {
    expect(resolveShikiLang('Maven POM')).toBe('xml');
    expect(resolveShikiLang('JSON with Comments')).toBe('json');
  });

  it('returns undefined for unknown language', () => {
    expect(resolveShikiLang('Other')).toBeUndefined();
    expect(resolveShikiLang('NonexistentLang')).toBeUndefined();
  });

  it('handles languages that are already lowercase', () => {
    expect(resolveShikiLang('css')).toBe('css');
  });
});

describe('trimLeadingWhitespace', () => {
  it('returns unchanged text and col when there is no leading whitespace', () => {
    const { lineText, adjustedCol } = trimLeadingWhitespace('hello', 2);
    expect(lineText).toBe('hello');
    expect(adjustedCol).toBe(2);
  });

  it('trims leading spaces and adjusts column', () => {
    const { lineText, adjustedCol } = trimLeadingWhitespace('   hello', 5);
    expect(lineText).toBe('hello');
    expect(adjustedCol).toBe(2); // 5 - 3 trimmed = 2
  });

  it('clamps adjustedCol to 0 when match falls entirely within trimmed whitespace', () => {
    const { lineText, adjustedCol } = trimLeadingWhitespace('   hello', 1);
    expect(lineText).toBe('hello');
    expect(adjustedCol).toBe(0); // 1 - 3 = -2, clamped to 0
  });

  it('handles tabs as whitespace', () => {
    const { lineText, adjustedCol } = trimLeadingWhitespace('\thello', 3);
    expect(lineText).toBe('hello');
    expect(adjustedCol).toBe(2); // 3 - 1 tab = 2
  });

  it('returns empty string for all-whitespace input', () => {
    const { lineText, adjustedCol } = trimLeadingWhitespace('   ', 0);
    expect(lineText).toBe('');
    expect(adjustedCol).toBe(0);
  });
});

describe('computeVisibleWindow', () => {
  it('returns null when line fits within maxDisplay', () => {
    expect(computeVisibleWindow(80, 10, 5, 120)).toBeNull();
    expect(computeVisibleWindow(120, 10, 5, 120)).toBeNull(); // exactly at limit
  });

  it('returns a window when line exceeds maxDisplay', () => {
    const win = computeVisibleWindow(200, 100, 5, 120);
    expect(win).not.toBeNull();
    expect(win!.start).toBeGreaterThanOrEqual(0);
    expect(win!.end).toBeLessThanOrEqual(200);
    expect(win!.end - win!.start).toBeLessThanOrEqual(120 + 5); // roughly bounded
  });

  it('clamps start to 0 when match is near the beginning', () => {
    const win = computeVisibleWindow(200, 2, 5, 120);
    expect(win!.start).toBe(0);
  });

  it('clamps end to lineLength when match is near the end', () => {
    const win = computeVisibleWindow(200, 198, 5, 120);
    expect(win!.end).toBe(200); // clamped, not 203
  });

  it('centers window around the match', () => {
    const win = computeVisibleWindow(300, 150, 10, 120);
    // half = floor((120 - 10) / 2) = 55; start = max(0, 150 - 55) = 95; end = min(300, 160 + 55) = 215
    expect(win!.start).toBe(95);
    expect(win!.end).toBe(215);
  });
});

describe('highlightGroup', () => {
  it('returns one HTML string per input line', async () => {
    const lines = [
      { rawText: 'const x = 1;', ranges: [{ col: 6, len: 1 }] },
      { rawText: 'const y = 2;', ranges: [{ col: 6, len: 1 }] },
    ];
    const results = await highlightGroup(lines, 'TypeScript');
    expect(results.length).toBe(2);
    // Both lines should produce defined HTML (TypeScript is a supported language)
    expect(results[0]).toBeDefined();
    expect(results[1]).toBeDefined();
    // Each result should contain match-highlight spans
    expect(results[0]).toContain('match-highlight');
    expect(results[1]).toContain('match-highlight');
  });

  it('returns all undefined for unsupported language', async () => {
    const lines = [
      { rawText: 'some text', ranges: [{ col: 0, len: 4 }] },
    ];
    const results = await highlightGroup(lines, 'NonexistentLang');
    expect(results).toEqual([undefined]);
  });

  it('returns all undefined when any line exceeds MAX_HIGHLIGHT (256)', async () => {
    const longLine = 'x'.repeat(300);
    const lines = [
      { rawText: 'short', ranges: [{ col: 0, len: 5 }] },
      { rawText: longLine, ranges: [{ col: 0, len: 3 }] },
    ];
    const results = await highlightGroup(lines, 'TypeScript');
    expect(results).toEqual([undefined, undefined]);
  });

  it('handles context lines with empty ranges', async () => {
    const lines = [
      { rawText: '// context line', ranges: [] },
      { rawText: 'const match = true;', ranges: [{ col: 6, len: 5 }] },
      { rawText: '// more context', ranges: [] },
    ];
    const results = await highlightGroup(lines, 'TypeScript');
    expect(results.length).toBe(3);
    // All lines should produce HTML (no match highlight needed for context)
    for (const r of results) {
      expect(r).toBeDefined();
    }
    // Only the match line should have a match-highlight span
    expect(results[0]).not.toContain('match-highlight');
    expect(results[1]).toContain('match-highlight');
    expect(results[2]).not.toContain('match-highlight');
  });

  it('produces correct grammar state across lines (multi-line block comment)', async () => {
    // Block comment spanning lines — single-line highlighting would miss the
    // comment continuation on lines 2 and 3.
    const lines = [
      { rawText: '/* start of comment', ranges: [] },
      { rawText: '   middle of comment', ranges: [{ col: 3, len: 6 }] },
      { rawText: '   end of comment */', ranges: [] },
    ];
    const results = await highlightGroup(lines, 'TypeScript');
    expect(results.length).toBe(3);
    // All lines should be tokenized (multi-line grammar state)
    for (const r of results) {
      expect(r).toBeDefined();
    }
    // The middle line should have a match-highlight
    expect(results[1]).toContain('match-highlight');
  });

  it('preserves untrimmed text (no leading whitespace removal)', async () => {
    const lines = [
      { rawText: '    indented code', ranges: [{ col: 4, len: 8 }] },
    ];
    const results = await highlightGroup(lines, 'TypeScript');
    expect(results.length).toBe(1);
    expect(results[0]).toBeDefined();
    // The HTML should contain the leading spaces (not trimmed)
    // The actual content of the HTML includes the full indented text
    expect(results[0]!).toContain('indented');
  });
});
