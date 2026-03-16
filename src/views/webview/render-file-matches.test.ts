// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createState } from './index';
import { makeDir, makeRenderer } from './test-helpers';

// --- renderFileMatches ---

describe('renderFileMatches', () => {
  function makeFile(path: string) {
    return { path, name: path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  function makeMatch(line: number, col = 0, len = 3) {
    return { line, column: col, matchLength: len, lineText: 'abc def ghi' };
  }

  it('appends nothing when searchResults is null', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.children.length).toBe(0);
  });

  it('appends nothing when file has no matches', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', []]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.children.length).toBe(0);
  });

  it('appends up to truncateThreshold match-line rows', () => {
    const state = createState();
    state.truncateThreshold = 4; // default
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    const file = makeFile('/ws/a.ts');
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(1), makeMatch(2), makeMatch(3), makeMatch(4),
    ]]]);
    renderer.renderFileMatches(container, file, 1, []);
    // 4 match-line rows, no "more matches" row
    expect(container.querySelectorAll('.match-line-row').length).toBe(4);
    expect(container.querySelectorAll('.match-more-row').length).toBe(0);
  });

  it('appends a "more matches" row when there are more than truncateThreshold matches', () => {
    const state = createState();
    state.truncateThreshold = 4; // default
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    const file = makeFile('/ws/a.ts');
    // Use non-contiguous lines so groups don't merge
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(10), makeMatch(30), makeMatch(50), makeMatch(70), makeMatch(90), makeMatch(110), makeMatch(130),
    ]]]);
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.querySelectorAll('.match-line-row').length).toBe(4);
    const moreRow = container.querySelector('.truncated-row');
    expect(moreRow).not.toBeNull();
    expect(moreRow.textContent).toContain('3 more match');
  });

  it('appends nothing when file path is not in searchResults', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/other.ts', [makeMatch(1)]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);
    expect(container.children.length).toBe(0);
  });
});

// --- renderFileMatches: context grouping ---

describe('renderFileMatches — context grouping', () => {
  function makeFile(path: string) {
    return { path, name: path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  function makeMatch(line: number, col = 0, len = 3) {
    return { line, column: col, matchLength: len, lineText: 'abc def ghi' };
  }

  function makeContext(line: number) {
    return { line, column: 0, matchLength: 0, lineText: 'context line', isContext: true };
  }

  it('wraps match + context in a match-group wrapper', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [
      makeContext(4), makeMatch(5), makeContext(6),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(1);

    const group = groups[0];
    // Wrapper carries match click attributes
    expect(group.dataset.action).toBe('openFileAtLine');
    expect(group.dataset.path).toBe('/ws/a.ts');
    expect(group.dataset.line).toBe('5');
    expect(group.getAttribute('data-vscode-context')).toContain('matchLine');

    // Contains context-before, match, context-after
    const children = group.children;
    expect(children.length).toBe(3);
    expect(children[0].classList.contains('match-context-row')).toBe(true);
    expect(children[1].classList.contains('match-line-row')).toBe(true);
    expect(children[2].classList.contains('match-context-row')).toBe(true);
  });

  it('context divs inside group have no data-action (clicks bubble to wrapper)', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [
      makeContext(4), makeMatch(5), makeContext(6),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const group = container.querySelector('.match-group');
    const contextDivs = group.querySelectorAll('.match-context-row');
    for (const div of contextDivs) {
      expect(div.dataset.action).toBeUndefined();
      expect(div.dataset.path).toBeUndefined();
      expect(div.dataset.line).toBeUndefined();
    }
  });

  it('merges contiguous matches into one group with inter-match context', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // Match at line 3, context lines 4-7, match at line 8 — contiguous, should merge
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(3),
      makeContext(4), makeContext(5), makeContext(6), makeContext(7),
      makeMatch(8),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    // Contiguous → merged into one group
    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(1);

    const g = groups[0];
    expect(g.dataset.line).toBe('3');
    expect(g.querySelectorAll('.match-line-row').length).toBe(2);
    // All 4 context lines appear as inter-match context
    expect(g.querySelectorAll('.match-context-row').length).toBe(4);
  });

  it('splits shared context between two non-contiguous matches at midpoint', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // Match at line 3, context 4-5, gap, context 18-19, match at line 20
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(3),
      makeContext(4), makeContext(5),
      makeContext(18), makeContext(19),
      makeMatch(20),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(2);

    const g1 = groups[0];
    expect(g1.dataset.line).toBe('3');
    expect(g1.querySelectorAll('.match-context-row').length).toBe(2);

    const g2 = groups[1];
    expect(g2.dataset.line).toBe('20');
    expect(g2.querySelectorAll('.match-context-row').length).toBe(2);
  });

  it('adds gap-before class between non-contiguous groups', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // Match at line 3, gap, match at line 10
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(3), makeMatch(10),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(2);
    expect(groups[0].classList.contains('gap-before')).toBe(false);
    expect(groups[1].classList.contains('gap-before')).toBe(true);
  });

  it('contiguous matches merge into one group (no gap-before)', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // Match at 3, context at 4, match at 5 — contiguous, merges into one group
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatch(3), makeContext(4), makeMatch(5),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(1);
    expect(groups[0].querySelectorAll('.match-line-row').length).toBe(2);
    expect(groups[0].querySelectorAll('.match-context-row').length).toBe(1);
    expect(container.querySelectorAll('.match-group.gap-before').length).toBe(0);
  });

  it('truncation counts match groups, not context lines', () => {
    const state = createState();
    state.truncateThreshold = 2;
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // Use non-contiguous matches (large gaps) so they don't merge
    state.searchResults = new Map([['/ws/a.ts', [
      makeContext(9), makeMatch(10), makeContext(11),
      makeContext(29), makeMatch(30), makeContext(31),
      makeContext(49), makeMatch(50), makeContext(51),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    // 2 groups rendered (threshold=2), 3rd group truncated
    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(2);

    // "1 more match" row
    const moreRow = container.querySelector('.truncated-row');
    expect(moreRow).not.toBeNull();
    expect(moreRow.textContent).toContain('1 more match');
  });

  it('three consecutive matches all merge into one group', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [
      { line: 5, column: 0, matchLength: 3, lineText: 'match1' },
      { line: 6, column: 0, matchLength: 0, lineText: 'ctx6', isContext: true },
      { line: 7, column: 0, matchLength: 3, lineText: 'match2' },
      { line: 8, column: 0, matchLength: 0, lineText: 'ctx8', isContext: true },
      { line: 9, column: 0, matchLength: 3, lineText: 'match3' },
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(1);
    expect(groups[0].querySelectorAll('.match-line-row').length).toBe(3);
    expect(groups[0].querySelectorAll('.match-context-row').length).toBe(2);
  });

  it('copy text includes match lines and inter-match context, excludes leading/trailing context', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [
      { line: 3, column: 0, matchLength: 0, lineText: 'leading-ctx', isContext: true },
      { line: 4, column: 0, matchLength: 3, lineText: 'match1-text' },
      { line: 5, column: 0, matchLength: 0, lineText: 'inter-ctx', isContext: true },
      { line: 6, column: 0, matchLength: 3, lineText: 'match2-text' },
      { line: 7, column: 0, matchLength: 0, lineText: 'trailing-ctx', isContext: true },
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const group = container.querySelector('.match-group');
    const ctx = JSON.parse(group.getAttribute('data-vscode-context'));
    // Should include match lines and inter-match context, but NOT leading-ctx or trailing-ctx
    expect(ctx.lineText).toBe('match1-text\ninter-ctx\nmatch2-text');
  });

  it('recomputes dedent across merged group', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [
      { line: 5, column: 4, matchLength: 3, lineText: '    match1' },
      { line: 6, column: 2, matchLength: 3, lineText: '  match2' },
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(1);
    // With dedent=2: "    match1" → "  match1", "  match2" → "match2"
    const matchTexts = groups[0].querySelectorAll('.match-line-text');
    expect(matchTexts[0].textContent).toBe('  match1');
    expect(matchTexts[1].textContent).toBe('match2');
  });

  it('match without context produces a group with only the match div', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [makeMatch(5)]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const groups = container.querySelectorAll('.match-group');
    expect(groups.length).toBe(1);
    expect(groups[0].children.length).toBe(1);
    expect(groups[0].querySelector('.match-line-row')).not.toBeNull();
  });
});

// --- renderFileMatches: dedent ---

describe('renderFileMatches — dedent', () => {
  function makeFile(path: string) {
    return { path, name: path.split('/').pop(), langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
  }

  function makeMatchWithText(line: number, text: string, col = 0, len = 3) {
    return { line, column: col, matchLength: len, lineText: text };
  }

  function makeContextWithText(line: number, text: string) {
    return { line, column: 0, matchLength: 0, lineText: text, isContext: true };
  }

  it('strips shared leading indentation from all lines in a group', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // All lines indented by at least 4 spaces; inner line has 8
    state.searchResults = new Map([['/ws/a.ts', [
      makeContextWithText(1, '    outer line'),
      makeMatchWithText(2, '        inner line', 8, 5),
      makeContextWithText(3, '    outer line'),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const group = container.querySelector('.match-group');
    const rows = group.querySelectorAll('.match-context-row, .match-line-row');
    // Context rows should have 0 leading spaces (4 stripped)
    expect(rows[0].querySelector('.match-line-text').textContent).toBe('outer line');
    // Match row should have 4 leading spaces (8 - 4 = 4 relative)
    expect(rows[1].querySelector('.match-line-text').textContent).toBe('    inner line');
    expect(rows[2].querySelector('.match-line-text').textContent).toBe('outer line');
  });

  it('blank lines do not affect dedent calculation', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [
      makeContextWithText(1, '    indented'),
      makeContextWithText(2, ''),
      makeMatchWithText(3, '    match here', 4, 5),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const group = container.querySelector('.match-group');
    const rows = group.querySelectorAll('.match-context-row, .match-line-row');
    // Dedent should be 4 (blank line ignored), so "indented" has no leading spaces
    expect(rows[0].querySelector('.match-line-text').textContent).toBe('indented');
    // Blank line should be empty
    expect(rows[1].querySelector('.match-line-text').textContent).toBe('');
    // Match should have no leading spaces (4 - 4 = 0)
    expect(rows[2].querySelector('.match-line-text').textContent).toBe('match here');
  });

  it('no dedent when first line has no indentation', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatchWithText(1, 'no indent', 0, 2),
      makeContextWithText(2, '    indented'),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const group = container.querySelector('.match-group');
    const rows = group.querySelectorAll('.match-line-row, .match-context-row');
    expect(rows[0].querySelector('.match-line-text').textContent).toBe('no indent');
    expect(rows[1].querySelector('.match-line-text').textContent).toBe('    indented');
  });

  it('dedent works with highlightedHtml (strips from DOM text nodes)', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // Simulate highlighted HTML with leading whitespace in a text node
    state.searchResults = new Map([['/ws/a.ts', [
      {
        line: 1, column: 4, matchLength: 3, lineText: '    abc def',
        highlightedHtml: '    <span style="color:#569cd6">abc</span> def',
      },
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const group = container.querySelector('.match-group');
    const textEl = group.querySelector('.match-line-text');
    // Dedent=4, so the 4 leading spaces should be stripped from the text node
    expect(textEl.textContent).toBe('abc def');
  });

  it('dedent adjusts match highlight position in plain-text path', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    const container = document.createElement('ul');
    renderer._rootEl.appendChild(container);
    // Match at column 8 with 4-space dedent -> should highlight at column 4
    state.searchResults = new Map([['/ws/a.ts', [
      makeMatchWithText(1, '    foo bar baz', 8, 3),
    ]]]);
    const file = makeFile('/ws/a.ts');
    renderer.renderFileMatches(container, file, 1, []);

    const group = container.querySelector('.match-group');
    const highlight = group.querySelector('.match-highlight');
    expect(highlight).not.toBeNull();
    expect(highlight.textContent).toBe('bar');
  });
});

// --- stripLeadingCharsHtml (dedent) ---

describe('HTML dedent via renderContextLine', () => {
  it('strips leading chars from highlighted context HTML', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = {
      line: 1, column: 0, matchLength: 0, lineText: '    context line', isContext: true,
      highlightedHtml: '    <span style="color:#569cd6">context</span> line',
    };
    const li = renderer.renderContextLine(file, match, 1, [], 4);
    const textEl = li.querySelector('.match-line-text');
    // 4 leading spaces should be stripped from the first text node
    expect(textEl.textContent).toBe('context line');
  });

  it('strips chars across multiple text nodes', () => {
    const state = createState();
    const renderer = makeRenderer(state);
    renderer.beforeRender();
    const file = { path: '/a/foo.ts', name: 'foo.ts', langName: 'TypeScript', langColor: '#3178c6', sizeBytes: 0 };
    const match = {
      line: 1, column: 0, matchLength: 0, lineText: '      deep indent', isContext: true,
      // HTML: 3 chars in first span, 3 in second text node, then content
      highlightedHtml: '<span style="color:#888">   </span>   <span style="color:#569cd6">deep</span> indent',
    };
    const li = renderer.renderContextLine(file, match, 1, [], 6);
    const textEl = li.querySelector('.match-line-text');
    // 6 leading whitespace chars (3 in span + 3 bare) should be stripped
    expect(textEl.textContent).toBe('deep indent');
  });
});
