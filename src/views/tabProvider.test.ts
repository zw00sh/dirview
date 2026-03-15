import { vi, describe, it, expect } from 'vitest';

const { WORKSPACE_ROOT } = vi.hoisted(() => ({ WORKSPACE_ROOT: '/Users/test/myproject' }));

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
    file: (p: string) => ({ fsPath: p }),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: WORKSPACE_ROOT } }],
  },
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: { html: '', onDidReceiveMessage: vi.fn(), postMessage: vi.fn(), asWebviewUri: vi.fn() },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  ViewColumn: { One: 1 },
}));

vi.mock('./buildWebviewHtml', () => ({ buildWebviewHtml: vi.fn(() => ''), SHARED_SCRIPTS: [] }));
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
