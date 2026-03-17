// @vitest-environment jsdom
//
// E2E test: filter ↔ expand state interaction.

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

describe('filter ↔ expand state interaction', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('language filter activation auto-expands dirs to show filtered files', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    const initialFiles = h.getVisibleFiles();

    // Pick a language from fixture stats.
    const stats = h.roots[0]?.stats || [];
    expect(stats.length).toBeGreaterThan(0);
    const targetLang = stats[0].name;

    // Activating a language filter clears expanded state → dirs auto-expand.
    h.setLanguageFilter([targetLang]);

    const filteredFiles = h.getVisibleFiles();
    expect(filteredFiles.length).toBeGreaterThan(0);

    // The expanded map should have been cleared by setLanguageFilter.
    expect(h.state.expanded.size).toBe(0);

    h.dispose();
  }, 30000);

  it('clearing language filter restores full tree', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    const initialFiles = h.getVisibleFiles();
    const initialDirs = h.getVisibleDirs();

    // Filter to one language.
    const stats = h.roots[0]?.stats || [];
    expect(stats.length).toBeGreaterThan(0);
    h.setLanguageFilter([stats[0].name]);

    const filteredFiles = h.getVisibleFiles();

    // Clear filter — should restore the full tree.
    h.clearLanguageFilter();

    expect(h.state.activeFilters.size).toBe(0);
    const restoredFiles = h.getVisibleFiles();
    // Restored file count should match initial (same expand state baseline).
    expect(restoredFiles.length).toBe(initialFiles.length);

    h.dispose();
  }, 30000);

  it('clearSearch resets all search state', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Perform a search.
    await h.search('concord');

    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBeGreaterThan(0);

    // Clear the search.
    await h.clearSearch();

    // Core search state should be fully cleared.
    expect(h.state.searchResults).toBeNull();
    expect(h.state.searchAncestorPaths).toBeNull();
    expect(h.state.fileFilterActive).toBe(false);

    // Tree should still render (visible files > 0).
    // Note: search auto-expands dirs, and those stay expanded after clear,
    // so file count may differ from pre-search count.
    const afterClearFiles = h.getVisibleFiles();
    expect(afterClearFiles.length).toBeGreaterThan(0);

    h.dispose();
  }, 60000);
});
