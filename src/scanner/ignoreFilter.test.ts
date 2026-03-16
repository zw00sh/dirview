import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createVscodeMock } from '../test-utils/vscode-mock';
import { IgnoreFilter } from './ignoreFilter';

vi.mock('vscode', () => createVscodeMock({
  workspace: {
    fs: {
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    },
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({}),
    }),
  },
}));

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  },
}));

import * as vscode from 'vscode';
import * as fs from 'fs';

const rootUri = { fsPath: '/repo', scheme: 'file' } as unknown as vscode.Uri;
const parentUri = rootUri;

describe('IgnoreFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no .gitignore found
    (fs.promises.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('ENOENT'));
    // Default: no files.exclude
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>)
      .mockReturnValue({ get: vi.fn().mockReturnValue({}) });
  });

  describe('VCS dir exclusion', () => {
    it('always excludes .git regardless of showIgnored', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeDirSync('.git', '.git', localIg)).toBe(true);
    });

    it('always excludes .hg regardless of showIgnored', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeDirSync('.hg', '.hg', localIg)).toBe(true);
    });

    it('always excludes .svn regardless of showIgnored', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeDirSync('.svn', '.svn', localIg)).toBe(true);
    });
  });

  describe('showIgnored=true', () => {
    it('does not exclude regular dirs when showIgnored is true', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeDirSync('node_modules', 'node_modules', localIg)).toBe(false);
    });

    it('does not exclude files when showIgnored is true', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeFileSync('secret.env', 'secret.env', localIg)).toBe(false);
    });
  });

  describe('gitignore patterns', () => {
    beforeEach(() => {
      (fs.promises.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValue('node_modules/\n*.log\n');
    });

    it('excludes dirs matching root .gitignore', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeDirSync('node_modules', 'node_modules', localIg)).toBe(true);
    });

    it('excludes files matching root .gitignore', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeFileSync('app.log', 'app.log', localIg)).toBe(true);
    });

    it('does not exclude files that do not match .gitignore', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeFileSync('index.ts', 'index.ts', localIg)).toBe(false);
    });
  });

  describe('files.exclude patterns', () => {
    beforeEach(() => {
      (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>)
        .mockReturnValue({
          get: vi.fn().mockReturnValue({ 'out/**': true, '**/.DS_Store': true, 'ignored/**': false }),
        });
    });

    it('excludes files matching enabled files.exclude pattern', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeFileSync('build.js', 'out/build.js', localIg)).toBe(true);
    });

    it('does not exclude files matching disabled files.exclude pattern', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeFileSync('foo.ts', 'ignored/foo.ts', localIg)).toBe(false);
    });

    it('skips files.exclude when showIgnored is true', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      const localIg = await filter.loadLocalIgnore(parentUri);
      expect(filter.shouldExcludeFileSync('build.js', 'out/build.js', localIg)).toBe(false);
    });
  });

  describe('per-directory gitignore cache', () => {
    it('caches per-directory .gitignore results', async () => {
      (fs.promises.readFile as ReturnType<typeof vi.fn>)
        .mockImplementation((filePath: string) => {
          if (filePath.includes('/repo/src')) {
            return Promise.resolve('*.tmp\n');
          }
          return Promise.reject(new Error('ENOENT'));
        });
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const subUri = { fsPath: '/repo/src' } as unknown as vscode.Uri;
      // Call twice with same parentUri — second call should use cache
      await filter.loadLocalIgnore(subUri);
      await filter.loadLocalIgnore(subUri);
      const calls = (fs.promises.readFile as ReturnType<typeof vi.fn>).mock.calls;
      const subCalls = calls.filter((c: unknown[]) =>
        (c[0] as string).includes('/repo/src')
      );
      // Should have been called exactly once (cached on second invocation)
      expect(subCalls.length).toBe(1);
    });
  });
});
