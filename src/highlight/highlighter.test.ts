import { describe, it, expect } from 'vitest';
import { buildHighlightedHtml } from './highlighter';
import type { ThemedToken } from 'shiki';

function tok(content: string, color?: string): ThemedToken {
  return { content, offset: 0, color, fontStyle: 0 } as ThemedToken;
}

describe('buildHighlightedHtml', () => {
  it('wraps match range in match-highlight span', () => {
    // "hello world" — highlight "world" (col=6, len=5)
    const tokens = [tok('hello ', 'var(--shiki-foreground)'), tok('world', 'var(--shiki-token-keyword)')];
    const html = buildHighlightedHtml(tokens, 6, 5);
    expect(html).toContain('<span class="match-highlight">');
    expect(html).toContain('world');
    // "hello " should appear before the highlight
    expect(html.indexOf('hello')).toBeLessThan(html.indexOf('match-highlight'));
  });

  it('splits a token that straddles the match start', () => {
    // Token "foobar" col=0..6, match starts at col=3 (len=3 = "bar")
    const tokens = [tok('foobar', 'var(--shiki-token-keyword)')];
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
    const tokens = [tok('before'), tok('tok1', 'var(--shiki-token-keyword)'), tok('tok2', 'var(--shiki-token-string)'), tok('after')];
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
    const tokens = [tok('some code', 'var(--shiki-token-keyword)')];
    const html = buildHighlightedHtml(tokens, 0, 0);
    expect(html).not.toContain('match-highlight');
    expect(html).toContain('some code');
  });

  it('escapes HTML entities in token content', () => {
    // &, <, > must be escaped; " is safe in HTML text content and left as-is
    const tokens = [tok('<div>&', 'var(--shiki-token-keyword)'), tok('"text"')];
    const html = buildHighlightedHtml(tokens, 0, 0);
    expect(html).toContain('&lt;div&gt;&amp;');
    expect(html).toContain('"text"');
    expect(html).not.toContain('<div>');
  });

  it('omits style attribute for --shiki-foreground color', () => {
    // Tokens colored with the foreground variable should render as plain text (no span)
    const tokens = [tok('plain', 'var(--shiki-foreground)')];
    const html = buildHighlightedHtml(tokens, 0, 0);
    expect(html).toBe('plain');
    expect(html).not.toContain('<span');
  });

  it('handles match at start of line', () => {
    const tokens = [tok('const', 'var(--shiki-token-keyword)'), tok(' x = 1')];
    const html = buildHighlightedHtml(tokens, 0, 5);
    expect(html).toMatch(/^<span class="match-highlight">/);
    expect(html).toContain('const');
  });

  it('handles match at end of line', () => {
    const tokens = [tok('x = '), tok('true', 'var(--shiki-token-constant)')];
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
});
