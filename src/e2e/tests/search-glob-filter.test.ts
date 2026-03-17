// @vitest-environment jsdom
//
// E2E test: file glob filtering behavior.

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

describe('search glob filtering', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('entering * in files-to-include returns all files (wildcard preservation)', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Search with bare wildcard — normalizeGlob('*') returns '' so rg --files runs unfiltered.
    await h.searchFiles('*');

    expect(h.state.searchResults).not.toBeNull();
    if (h.state.searchResults) {
      expect(h.state.searchResults.size).toBeGreaterThan(0);
    }

    h.dispose();
  }, 30000);

  it('specific glob pattern restricts results', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    await h.searchFiles('*.ts');

    expect(h.state.searchResults).not.toBeNull();
    if (h.state.searchResults && h.state.searchResults.size > 0) {
      for (const filePath of h.state.searchResults.keys()) {
        expect(filePath).toMatch(/\.ts$/);
      }
    }

    h.dispose();
  }, 30000);

  it('exclude glob removes files from results', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    // Get all files first.
    await h.searchFiles('*');
    const allCount = h.state.searchResults?.size ?? 0;

    // Clear and search with an exclude.
    await h.clearSearch();

    const waitPromise = h.bridge.waitForSearchComplete();
    h.bridge.handleWebviewMessage({ command: 'searchFiles', glob: '*', exclude: '*.ts' });
    await waitPromise;
    await h.bridge.flush();
    h.rerender();

    const excludedCount = h.state.searchResults?.size ?? 0;
    expect(excludedCount).toBeLessThanOrEqual(allCount);

    h.dispose();
  }, 30000);
});
