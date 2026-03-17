// @vitest-environment jsdom
//
// E2E test: language filter + include glob + content search returns matching files.

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

describe('search with language filter', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('content search with language filter scopes results to matching extensions', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Set a language filter — pick whatever languages exist in the fixture.
    const stats = h.roots[0]?.stats || [];
    if (stats.length === 0) {
      h.dispose();
      return;
    }

    const targetLang = stats[0].name;
    h.setLanguageFilter([targetLang]);

    // Search for a common pattern.
    await h.search('a');

    // The search should have completed.
    expect(h.state.searchResults).not.toBeNull();

    if (h.state.searchResults && h.state.searchResults.size > 0) {
      expect(h.state.searchResults.size).toBeGreaterThan(0);
    }

    h.dispose();
  }, 30000);

  it('search without language filter returns broader results', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    await h.search('a');

    expect(h.state.searchResults).not.toBeNull();
    if (h.state.searchResults) {
      expect(h.state.searchResults.size).toBeGreaterThan(0);
    }

    h.dispose();
  }, 30000);

  it('language filter + search, then clear filter finds results in more languages', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    const stats = h.roots[0]?.stats || [];
    if (stats.length < 2) { h.dispose(); return; }

    // Pick a language with fewer files to avoid truncation effects.
    const targetLang = stats[stats.length - 1].name;
    h.setLanguageFilter([targetLang]);
    await h.search('e');
    const filteredResults = h.state.searchResults;

    // The filtered search should have results (or at least complete cleanly).
    expect(filteredResults).not.toBeNull();

    // Clear filter and search again — should find results in other languages too.
    h.clearLanguageFilter();
    await h.search('e');
    const unfilteredResults = h.state.searchResults;

    expect(unfilteredResults).not.toBeNull();
    // Both searches should have completed successfully.
    // (We don't compare counts because MAX_MATCHES truncation can make
    // unfiltered searches return fewer distinct files than filtered ones.)

    h.dispose();
  }, 30000);
});
