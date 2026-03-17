// @vitest-environment jsdom
//
// E2E test: legend ↔ filter ↔ search interaction.

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

describe('legend ↔ filter ↔ search', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('legend stats present during active search', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    const initialStats = h.getLegendStats();
    expect(initialStats.length).toBeGreaterThan(0);

    // Search for a pattern that matches a subset of files.
    await h.search('concord');

    const searchStats = h.getLegendStats();
    expect(searchStats.length).toBeGreaterThan(0);

    // The legend is re-rendered from tree stats (computed from full roots),
    // so individual language counts remain stable. But visible files change.
    // Verify search produced results and legend still has entries.
    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBeGreaterThan(0);

    h.dispose();
  }, 60000);

  it('legend stats revert after clearing search', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    const initialStats = h.getLegendStats();
    const initialNames = initialStats.map(s => s.name);

    await h.search('concord');
    await h.clearSearch();

    const afterClearStats = h.getLegendStats();
    const afterNames = afterClearStats.map(s => s.name);

    // Same languages should appear in the legend.
    expect(afterNames).toEqual(initialNames);

    h.dispose();
  }, 60000);

  it('multiple language filters restrict visible files', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Filter to Java + XML.
    h.setLanguageFilter(['Java', 'XML']);

    const files = h.getVisibleFiles();
    expect(files.length).toBeGreaterThan(0);

    // All visible files should have .java or .xml extensions.
    for (const file of files) {
      const ext = file.toLowerCase();
      expect(ext).toMatch(/\.(java|xml)$/);
    }

    h.dispose();
  }, 30000);
});
