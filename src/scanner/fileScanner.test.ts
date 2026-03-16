import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

  const Uri = {
    joinPath: (base: { fsPath: string; scheme?: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
      scheme: base.scheme ?? 'file',
    }),
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  };

  return {
    FileType,
    Uri,
    workspace: {
      workspaceFolders: undefined as unknown,
      fs: {
        readDirectory: vi.fn(),
        stat: vi.fn().mockResolvedValue({ size: 0 }),
        readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      },
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      }),
    },
  };
});

vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ size: 0 }),
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  },
}));

import * as vscode from 'vscode';
import * as fs from 'fs';
import { scanWorkspace } from './fileScanner';

/** Create a mock Dirent-like object for fs.readdir({ withFileTypes: true }) */
function dirent(name: string, type: 'file' | 'dir' | 'symlink') {
  return {
    name,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isSymbolicLink: () => type === 'symlink',
  };
}

describe('scanWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.promises.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('ENOENT'));
    (fs.promises.stat as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ size: 100 });
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValue([]);
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>)
      .mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
  });

  it('returns empty result when no workspace folders', async () => {
    (vscode.workspace as { workspaceFolders: undefined }).workspaceFolders = undefined;
    const result = await scanWorkspace(false);
    expect(result.roots).toEqual([]);
    expect(result.totalFiles).toBe(0);
  });

  it('scans a simple flat directory', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'file' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValue([dirent('index.ts', 'file'), dirent('style.css', 'file')]);

    const result = await scanWorkspace(false);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].totalFiles).toBe(2);
    expect(result.roots[0].files.map(f => f.name).sort()).toEqual(['index.ts', 'style.css']);
    expect(result.totalFiles).toBe(2);
  });

  it('scans nested directories', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'file' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockImplementation((dirPath: string) => {
        if (dirPath === '/repo') {
          return Promise.resolve([dirent('src', 'dir'), dirent('README.md', 'file')]);
        }
        if (dirPath === '/repo/src') {
          return Promise.resolve([dirent('index.ts', 'file')]);
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
    const folderUri = { fsPath: '/repo', scheme: 'file' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockImplementation((dirPath: string) => {
        if (dirPath === '/repo') {
          return Promise.resolve([dirent('.git', 'dir'), dirent('app.ts', 'file')]);
        }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    const root = result.roots[0];
    expect(root.children.map((c: { name: string }) => c.name)).not.toContain('.git');
  });

  it('detects symlink cycles via visitedPaths', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'file' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockImplementation((dirPath: string) => {
        if (dirPath === '/repo') {
          return Promise.resolve([dirent('loop', 'symlink')]);
        }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    expect(result).toBeDefined();
  });

  it('aggregates stats from subdirectories', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'file' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockImplementation((dirPath: string) => {
        if (dirPath === '/repo') {
          return Promise.resolve([dirent('src', 'dir')]);
        }
        if (dirPath === '/repo/src') {
          return Promise.resolve([dirent('a.ts', 'file'), dirent('b.ts', 'file')]);
        }
        return Promise.resolve([]);
      });
    (fs.promises.stat as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ size: 500 });

    const result = await scanWorkspace(false);
    const root = result.roots[0];
    expect(root.totalFiles).toBe(2);
    expect(root.sizeBytes).toBe(1000);
    const tsStats = root.stats.find((s: { name: string }) => s.name === 'TypeScript');
    expect(tsStats).toBeDefined();
    expect(tsStats?.count).toBe(2);
  });

  it('returns without error when signal is pre-aborted', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'file' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValue([dirent('a.ts', 'file')]);

    const controller = new AbortController();
    controller.abort();
    const result = await scanWorkspace(false, controller.signal);
    expect(result).toBeDefined();
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].totalFiles).toBe(0);
  });

  it('scans multiple workspace folders in parallel', async () => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: { fsPath: '/folderA', scheme: 'file' }, name: 'A' },
      { uri: { fsPath: '/folderB', scheme: 'file' }, name: 'B' },
    ];
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockImplementation((dirPath: string) => {
        if (dirPath === '/folderA') { return Promise.resolve([dirent('a.ts', 'file')]); }
        if (dirPath === '/folderB') { return Promise.resolve([dirent('b.ts', 'file')]); }
        return Promise.resolve([]);
      });

    const result = await scanWorkspace(false);
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0].name).toBe('A');
    expect(result.roots[1].name).toBe('B');
    expect(result.totalFiles).toBe(2);
  });

  it('respects maxDepth setting', async () => {
    const folderUri = { fsPath: '/repo', scheme: 'file' };
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: folderUri, name: 'repo' },
    ];
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>)
      .mockReturnValue({ get: (key: string, def: unknown) => key === 'maxDepth' ? 1 : def });
    (fs.promises.readdir as ReturnType<typeof vi.fn>)
      .mockResolvedValue([dirent('src', 'dir'), dirent('app.ts', 'file')]);

    const result = await scanWorkspace(false);
    const root = result.roots[0];
    expect(root.children[0].children[0].totalFiles).toBe(0);
  });
});
