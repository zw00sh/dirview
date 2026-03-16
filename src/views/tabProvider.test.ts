import { vi, describe, it, expect } from 'vitest';
import { createVscodeMock } from '../test-utils/vscode-mock';

const { WORKSPACE_ROOT } = vi.hoisted(() => ({ WORKSPACE_ROOT: '/Users/test/myproject' }));

vi.mock('vscode', () => createVscodeMock({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: WORKSPACE_ROOT } }],
  },
}));

vi.mock('./buildWebviewHtml', () => ({ buildWebviewHtml: vi.fn(() => '') }));
vi.mock('./providerUtils', () => ({ handleSearchMessage: vi.fn(() => false), handleCommonMessage: vi.fn(() => false) }));
vi.mock('../search/searchService', () => ({ SearchService: class {} }));

import { TabProvider } from './tabProvider';

describe('TabProvider.getRootPaths', () => {
  it('returns absolute workspace folder paths for root tab (dirPath="")', () => {
    const provider = new TabProvider({} as any, {} as any);
    const paths = (provider as any).getRootPaths('');
    expect(paths).toEqual([WORKSPACE_ROOT]);
  });

  it('returns an absolute path for a subdirectory tab', () => {
    const provider = new TabProvider({} as any, {} as any);
    const paths = (provider as any).getRootPaths('src/scanner');
    expect(paths).toEqual([`${WORKSPACE_ROOT}/src/scanner`]);
  });

  it('returns an absolute path for a deeply nested subdirectory', () => {
    const provider = new TabProvider({} as any, {} as any);
    const paths = (provider as any).getRootPaths('source/policy-engine');
    expect(paths).toEqual([`${WORKSPACE_ROOT}/source/policy-engine`]);
  });
});
