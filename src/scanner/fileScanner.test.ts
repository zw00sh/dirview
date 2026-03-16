import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createVscodeMock } from '../test-utils/vscode-mock';

vi.mock('vscode', () => createVscodeMock());

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  },
}));

import * as vscode from 'vscode';
import { scanWorkspace } from './fileScanner';

describe('scanWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace.fs.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('ENOENT'));
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockResolvedValue([]);
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>)
      .mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
  });

  // Tests exercise the remote scan path (no workerClient passed).
  // The local worker path is tested separately via the worker integration.

  it('returns empty result when no workspace folders', async () => {
    (vscode.workspace as { workspaceFolders: undefined }).workspaceFolders = undefined;
    const result = await scanWorkspace(false);
    expect(result.roots).toEqual([]);
    expect(result.totalFiles).toBe(0);
  });

  it('scans a simple flat directory', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'remote' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockResolvedValue([
        ['index.ts', vscode.FileType.File],
        ['style.css', vscode.FileType.File],
      ]);

    const result = await scanWorkspace(false);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].totalFiles).toBe(2);
    expect(result.roots[0].files.map(f => f.name).sort()).toEqual(['index.ts', 'style.css']);
    expect(result.totalFiles).toBe(2);
  });

  it('scans nested directories', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'remote' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockImplementation(({ fsPath }: { fsPath: string }) => {
        if (fsPath === '/repo') {
          return Promise.resolve([
            ['src', vscode.FileType.Directory],
            ['README.md', vscode.FileType.File],
          ]);
        }
        if (fsPath === '/repo/src') {
          return Promise.resolve([
            ['index.ts', vscode.FileType.File],
          ]);
        }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    const root = result.roots[0];
    expect(root.totalFiles).toBe(2);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].name).toBe('src');
    expect(root.children[0].totalFiles).toBe(1);
  });

  it('excludes VCS directories', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'remote' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockImplementation(({ fsPath }: { fsPath: string }) => {
        if (fsPath === '/repo') {
          return Promise.resolve([
            ['.git', vscode.FileType.Directory],
            ['app.ts', vscode.FileType.File],
          ]);
        }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    const root = result.roots[0];
    expect(root.children.map((c: { name: string }) => c.name)).not.toContain('.git');
  });

  it('detects symlink cycles via visitedPaths', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'remote' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockImplementation(({ fsPath }: { fsPath: string }) => {
        if (fsPath === '/repo') {
          return Promise.resolve([
            ['loop', vscode.FileType.Directory | vscode.FileType.SymbolicLink],
          ]);
        }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    expect(result).toBeDefined();
  });

  it('aggregates stats from subdirectories (remote — no sizeBytes)', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'remote' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockImplementation(({ fsPath }: { fsPath: string }) => {
        if (fsPath === '/repo') {
          return Promise.resolve([['src', vscode.FileType.Directory]]);
        }
        if (fsPath === '/repo/src') {
          return Promise.resolve([
            ['a.ts', vscode.FileType.File],
            ['b.ts', vscode.FileType.File],
          ]);
        }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    const root = result.roots[0];
    expect(root.totalFiles).toBe(2);
    // Remote path skips stat — sizeBytes is 0
    expect(root.sizeBytes).toBe(0);
    const tsStats = root.stats.find((s: { name: string }) => s.name === 'TypeScript');
    expect(tsStats).toBeDefined();
    expect(tsStats?.count).toBe(2);
  });

  it('returns without error when signal is pre-aborted', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'remote' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockResolvedValue([['a.ts', vscode.FileType.File]]);

    const controller = new AbortController();
    controller.abort();
    const result = await scanWorkspace(false, controller.signal);
    expect(result).toBeDefined();
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].totalFiles).toBe(0);
  });

  it('scans multiple workspace folders in parallel', async () => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: { fsPath: '/folderA', scheme: 'remote' }, name: 'A' },
      { uri: { fsPath: '/folderB', scheme: 'remote' }, name: 'B' },
    ];
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockImplementation(({ fsPath }: { fsPath: string }) => {
        if (fsPath === '/folderA') { return Promise.resolve([['a.ts', vscode.FileType.File]]); }
        if (fsPath === '/folderB') { return Promise.resolve([['b.ts', vscode.FileType.File]]); }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0].name).toBe('A');
    expect(result.roots[1].name).toBe('B');
    expect(result.totalFiles).toBe(2);
  });

  it('respects maxDepth setting', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'remote' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>)
      .mockReturnValue({ get: (key: string, def: unknown) => key === 'maxDepth' ? 1 : def });
    (vscode.workspace.fs.readDirectory as ReturnType<typeof vi.fn>)
      .mockResolvedValue([
        ['src', vscode.FileType.Directory],
        ['app.ts', vscode.FileType.File],
      ]);

    const result = await scanWorkspace(false);
    const root = result.roots[0];
    expect(root.children[0].children[0].totalFiles).toBe(0);
  });
});
