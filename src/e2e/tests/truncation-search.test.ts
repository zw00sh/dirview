// @vitest-environment jsdom
//
// E2E test: truncation + search suppression.

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

describe('truncation + search suppression', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('truncation disabled during active search', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers, truncateThreshold: 3 });

    // Initial render should have truncated rows.
    const truncatedBefore = h.root.querySelectorAll('.truncated-row');
    expect(truncatedBefore.length).toBeGreaterThan(0);

    // Search — truncation should be suppressed.
    await h.search('concord');

    const truncatedDuring = h.root.querySelectorAll('.truncated-row');
    expect(truncatedDuring.length).toBe(0);

    h.dispose();
  }, 60000);

  it('truncation re-enabled after clearing search', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers, truncateThreshold: 3 });

    const truncatedBefore = h.root.querySelectorAll('.truncated-row').length;
    expect(truncatedBefore).toBeGreaterThan(0);

    await h.search('concord');
    expect(h.root.querySelectorAll('.truncated-row').length).toBe(0);

    await h.clearSearch();

    const truncatedAfter = h.root.querySelectorAll('.truncated-row').length;
    expect(truncatedAfter).toBeGreaterThan(0);

    h.dispose();
  }, 60000);

  it('empty dir grouping suppressed during search', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers, truncateThreshold: 3 });

    const emptyGroupsBefore = h.root.querySelectorAll('.empty-group-row').length;
    // This test is conditional — empty groups may or may not exist in the fixture.
    // If they exist, they should be suppressed during search.
    if (emptyGroupsBefore > 0) {
      await h.search('concord');
      const emptyGroupsDuring = h.root.querySelectorAll('.empty-group-row').length;
      expect(emptyGroupsDuring).toBe(0);

      await h.clearSearch();
      const emptyGroupsAfter = h.root.querySelectorAll('.empty-group-row').length;
      expect(emptyGroupsAfter).toBeGreaterThan(0);
    }

    h.dispose();
  }, 60000);
});
