// @vitest-environment jsdom
//
// E2E test: folder compaction ↔ filter interaction.

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

describe('folder compaction ↔ filter interaction', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('compacted intermediate dirs are skipped in rendered tree', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // The fixture has .mvn/wrapper — a single-child chain that gets compacted.
    // After compaction, '.mvn' should NOT appear as a visible dir name;
    // only the leaf 'wrapper' should be visible.
    const dirs = h.getVisibleDirs();
    expect(dirs).not.toContain('.mvn');
    expect(dirs).toContain('wrapper');

    h.dispose();
  }, 60000);

  it('search does not crash with compacted dirs', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Content search auto-expands all dirs including compacted ones.
    await h.search('concord');

    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBeGreaterThan(0);

    const dirs = h.getVisibleDirs();
    expect(dirs.length).toBeGreaterThan(0);

    // Compacted intermediate dirs should still be skipped.
    expect(dirs).not.toContain('.mvn');

    h.dispose();
  }, 60000);

  it('language filter pruning does not crash and produces valid tree', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Pick a minority language to maximally prune the tree.
    const stats = h.roots[0]?.stats || [];
    expect(stats.length).toBeGreaterThan(1);

    // Sort by count ascending, pick the smallest.
    const sorted = [...stats].sort((a, b) => a.count - b.count);
    const minorityLang = sorted[0].name;

    // This should not crash even if pruning creates new compaction opportunities.
    h.setLanguageFilter([minorityLang]);

    const dirs = h.getVisibleDirs();
    const files = h.getVisibleFiles();
    // Should have at least some files for the filtered language.
    expect(files.length).toBeGreaterThan(0);

    h.dispose();
  }, 60000);
});
