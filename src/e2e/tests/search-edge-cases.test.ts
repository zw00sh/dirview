// @vitest-environment jsdom
//
// E2E test: search transitions + zero results + edge cases.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVscodeMock } from '../../test-utils/vscode-mock';

vi.mock('vscode', () => createVscodeMock());
vi.mock('../../highlight/highlighter', () => ({
  highlightGroup: vi.fn(() => Promise.resolve([])),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

import { createHarness } from '../harness';
import { handleSearchMessage, handleCommonMessage } from '../../views/providerUtils';

const handlers = { handleSearchMessage, handleCommonMessage };

describe('search edge cases', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('content search with include glob scopes to matching files', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    const waitPromise = h.bridge.waitForSearchComplete();
    h.bridge.handleWebviewMessage({
      command: 'search',
      pattern: 'import',
      useRegex: false,
      include: '*.java',
    });
    await waitPromise;
    await h.bridge.flush();
    h.rerender();

    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBeGreaterThan(0);

    // All result files should be .java.
    for (const filePath of h.state.searchResults!.keys()) {
      expect(filePath).toMatch(/\.java$/);
    }

    h.dispose();
  }, 60000);

  it('search with no matches produces empty Map, not null', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Search for a pattern that shouldn't match anything.
    await h.search('zzz_nonexistent_pattern_xyz_12345');

    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults).toBeInstanceOf(Map);
    expect(h.state.searchResults!.size).toBe(0);

    h.dispose();
  }, 60000);

  it('searchFiles → content search transition replaces results', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // First: file listing search for XML files.
    await h.searchFiles('*.xml');

    expect(h.state.searchResults).not.toBeNull();
    const xmlResults = new Set(h.state.searchResults!.keys());
    expect(xmlResults.size).toBeGreaterThan(0);

    // All results should be XML.
    for (const p of xmlResults) {
      expect(p).toMatch(/\.xml$/);
    }

    // Second: content search (replaces the file listing).
    await h.search('import');

    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBeGreaterThan(0);

    // Content search should include non-XML files (Java files have 'import').
    const contentPaths = [...h.state.searchResults!.keys()];
    const nonXml = contentPaths.filter(p => !p.endsWith('.xml'));
    expect(nonXml.length).toBeGreaterThan(0);

    h.dispose();
  }, 60000);
});
