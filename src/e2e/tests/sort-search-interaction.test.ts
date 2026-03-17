// @vitest-environment jsdom
//
// E2E test: sort mode ↔ search interaction.

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

describe('sort mode ↔ search interaction', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sort mode change preserves search results', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    await h.search('concord');

    expect(h.state.searchResults).not.toBeNull();
    const resultsBefore = h.state.searchResults!.size;
    expect(resultsBefore).toBeGreaterThan(0);

    // Change sort mode and rerender.
    h.state.currentSortMode = 'name';
    h.rerender();

    // Search results should be preserved.
    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBe(resultsBefore);

    h.dispose();
  }, 60000);

  it('sort by name produces different order than sort by files', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Default sort is 'files' (by file count descending).
    const dirsByFiles = h.getVisibleDirs();
    expect(dirsByFiles.length).toBeGreaterThan(1);

    // Switch to name sort.
    h.state.currentSortMode = 'name';
    h.rerender();

    const dirsByName = h.getVisibleDirs();
    expect(dirsByName.length).toBe(dirsByFiles.length);

    // The order should differ (file count order ≠ alphabetical order).
    // Note: displayed names may differ from sort keys due to folder compaction
    // (e.g., '.mvn' sorts by its original name but displays as 'wrapper').
    expect(dirsByName).not.toEqual(dirsByFiles);

    h.dispose();
  }, 60000);
});
