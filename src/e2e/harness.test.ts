// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVscodeMock } from '../test-utils/vscode-mock';

// Mock vscode before any imports that transitively depend on it.
vi.mock('vscode', () => createVscodeMock());

// Mock the highlighter to avoid Shiki dependency in tests.
vi.mock('../highlight/highlighter', () => ({
  highlightGroup: vi.fn(() => Promise.resolve([])),
}));

// Polyfill ResizeObserver for jsdom.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// Import after mocks are set up.
import { createHarness } from './harness';
import { handleSearchMessage, handleCommonMessage } from '../views/providerUtils';

const handlers = { handleSearchMessage, handleCommonMessage };

describe('E2E harness self-tests', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('initializes with fixture data', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });
    expect(h.state.lastRoots).toBeDefined();
    expect(h.state.lastRoots!.length).toBeGreaterThan(0);
    h.dispose();
  });

  it('renders files into the DOM', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });
    // The tree should contain at least some rendered content.
    const treeList = h.root.querySelector('.tree-list');
    expect(treeList).not.toBeNull();
    // Should have at least one dir or file row.
    const rows = h.root.querySelectorAll('.dir-row, .file-row');
    expect(rows.length).toBeGreaterThan(0);
    h.dispose();
  });

  it('reports correct root name from fixture', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });
    expect(h.roots.length).toBeGreaterThan(0);
    expect(h.roots[0].name).toBe('source');
    h.dispose();
  });

  it('state tracks sort mode', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });
    expect(h.state.currentSortMode).toBe('files');
    h.dispose();
  });

  it('totalFiles from fixture is positive', async () => {
    const h = await createHarness({ workspace: 'test-repos/source', handlers });
    const totalFiles = h.roots.reduce((sum, r) => sum + r.totalFiles, 0);
    expect(totalFiles).toBeGreaterThan(0);
    h.dispose();
  });
});
