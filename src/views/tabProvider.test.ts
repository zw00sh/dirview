import { vi, describe, it, expect } from 'vitest';
import { createVscodeMock } from '../test-utils/vscode-mock';

const { WORKSPACE_ROOT, FRONTEND_ROOT, BACKEND_ROOT } = vi.hoisted(() => ({
  WORKSPACE_ROOT: '/Users/test/myproject',
  FRONTEND_ROOT: '/Users/test/frontend',
  BACKEND_ROOT: '/Users/test/backend',
}));

vi.mock('vscode', () => createVscodeMock({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: WORKSPACE_ROOT }, name: 'myproject' }],
  },
}));

vi.mock('./buildWebviewHtml', () => ({ buildWebviewHtml: vi.fn(() => '') }));
vi.mock('./providerUtils', () => ({ handleSearchMessage: vi.fn(() => false), handleCommonMessage: vi.fn(() => false) }));
vi.mock('../search/searchService', () => ({ SearchService: class {} }));

import * as vscode from 'vscode';
import { TabProvider } from './tabProvider';

describe('TabProvider.getRootPaths (single-root)', () => {
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

describe('TabProvider.getRootPaths (multi-root, prefixed paths)', () => {
  function setupMultiRoot() {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: FRONTEND_ROOT }, name: 'frontend' },
      { uri: { fsPath: BACKEND_ROOT }, name: 'backend' },
    ];
  }

  function teardown() {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: WORKSPACE_ROOT }, name: 'myproject' }];
  }

  it('returns all workspace folder paths for the all-roots view (dirPath="")', () => {
    setupMultiRoot();
    try {
      const provider = new TabProvider({} as any, {} as any);
      const paths = (provider as any).getRootPaths('');
      expect(paths).toEqual([FRONTEND_ROOT, BACKEND_ROOT]);
    } finally { teardown(); }
  });

  it('resolves a prefixed root-only path to that folder fsPath', () => {
    setupMultiRoot();
    try {
      const provider = new TabProvider({} as any, {} as any);
      expect((provider as any).getRootPaths('frontend')).toEqual([FRONTEND_ROOT]);
      expect((provider as any).getRootPaths('backend')).toEqual([BACKEND_ROOT]);
    } finally { teardown(); }
  });

  it('resolves a prefixed subdirectory path to the correct folder + relative', () => {
    setupMultiRoot();
    try {
      const provider = new TabProvider({} as any, {} as any);
      expect((provider as any).getRootPaths('frontend/src/utils')).toEqual([`${FRONTEND_ROOT}/src/utils`]);
      expect((provider as any).getRootPaths('backend/lib')).toEqual([`${BACKEND_ROOT}/lib`]);
    } finally { teardown(); }
  });

  it('two roots with identically-named subdirs resolve to distinct paths', () => {
    setupMultiRoot();
    try {
      const provider = new TabProvider({} as any, {} as any);
      const fe = (provider as any).getRootPaths('frontend/src');
      const be = (provider as any).getRootPaths('backend/src');
      expect(fe).toEqual([`${FRONTEND_ROOT}/src`]);
      expect(be).toEqual([`${BACKEND_ROOT}/src`]);
      expect(fe[0]).not.toBe(be[0]);
    } finally { teardown(); }
  });
});
