// @vitest-environment jsdom
//
// E2E test: search lifecycle — re-scan survival, count consistency.

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

describe('search lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('search results survive a tree re-scan', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    await h.search('concord');

    expect(h.state.searchResults).not.toBeNull();
    const resultSize = h.state.searchResults!.size;
    expect(resultSize).toBeGreaterThan(0);

    // Simulate a re-scan by dispatching a new update message.
    h.bridge.dispatchToWebview({
      type: 'update',
      roots: h.roots as any,
      autoRescanEnabled: true,
      sortMode: 'files',
      truncateThreshold: 0,
      stickyHeadersEnabled: false,
      showIgnored: false,
      isLocal: true,
      dirPath: '',
      workspaceFolderName: 'source',
      hasRipgrep: true,
    });

    // Search results should still be present after re-scan.
    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBe(resultSize);

    h.dispose();
  }, 60000);

  it('searchFileCount matches searchResults.size', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });

    await h.search('concord');

    expect(h.state.searchResults).not.toBeNull();
    expect(h.state.searchResults!.size).toBeGreaterThan(0);
    expect(h.state.searchFileCount).toBe(h.state.searchResults!.size);
    expect(h.state.searchMatchCount).toBeGreaterThan(0);

    h.dispose();
  }, 60000);
});
