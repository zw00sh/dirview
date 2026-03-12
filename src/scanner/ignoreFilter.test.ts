import { vi, describe, it, expect, beforeEach } from 'vitest';
import { IgnoreFilter } from './ignoreFilter';

vi.mock('vscode', () => {
  const Uri = {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
    file: (path: string) => ({ fsPath: path }),
  };

  return {
    workspace: {
      fs: {
        readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      },
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({}),
      }),
    },
    Uri,
  };
});

import * as vscode from 'vscode';

const rootUri = { fsPath: '/repo' } as unknown as vscode.Uri;
const parentUri = rootUri;

describe('IgnoreFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no .gitignore found
    (vscode.workspace.fs.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('ENOENT'));
    // Default: no files.exclude
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>)
      .mockReturnValue({ get: vi.fn().mockReturnValue({}) });
  });

  describe('VCS dir exclusion', () => {
    it('always excludes .git regardless of showIgnored', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      expect(await filter.shouldExcludeDir('.git', '.git', parentUri)).toBe(true);
    });

    it('always excludes .hg regardless of showIgnored', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      expect(await filter.shouldExcludeDir('.hg', '.hg', parentUri)).toBe(true);
    });

    it('always excludes .svn regardless of showIgnored', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      expect(await filter.shouldExcludeDir('.svn', '.svn', parentUri)).toBe(true);
    });
  });

  describe('showIgnored=true', () => {
    it('does not exclude regular dirs when showIgnored is true', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      expect(await filter.shouldExcludeDir('node_modules', 'node_modules', parentUri)).toBe(false);
    });

    it('does not exclude files when showIgnored is true', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      expect(await filter.shouldExcludeFile('secret.env', 'secret.env', parentUri)).toBe(false);
    });
  });

  describe('gitignore patterns', () => {
    beforeEach(() => {
      (vscode.workspace.fs.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValue(Buffer.from('node_modules/\n*.log\n'));
    });

    it('excludes dirs matching root .gitignore', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      expect(await filter.shouldExcludeDir('node_modules', 'node_modules', parentUri)).toBe(true);
    });

    it('excludes files matching root .gitignore', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      expect(await filter.shouldExcludeFile('app.log', 'app.log', parentUri)).toBe(true);
    });

    it('does not exclude files that do not match .gitignore', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      expect(await filter.shouldExcludeFile('index.ts', 'index.ts', parentUri)).toBe(false);
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
      expect(await filter.shouldExcludeFile('build.js', 'out/build.js', parentUri)).toBe(true);
    });

    it('does not exclude files matching disabled files.exclude pattern', async () => {
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      expect(await filter.shouldExcludeFile('foo.ts', 'ignored/foo.ts', parentUri)).toBe(false);
    });

    it('skips files.exclude when showIgnored is true', async () => {
      const filter = new IgnoreFilter(rootUri, true);
      await filter.init();
      expect(await filter.shouldExcludeFile('build.js', 'out/build.js', parentUri)).toBe(false);
    });
  });

  describe('per-directory gitignore cache', () => {
    it('caches per-directory .gitignore results', async () => {
      // Root has no .gitignore; only the subdir has one
      (vscode.workspace.fs.readFile as ReturnType<typeof vi.fn>)
        .mockImplementation(({ fsPath }: { fsPath: string }) => {
          if (fsPath.includes('/repo/src')) {
            return Promise.resolve(Buffer.from('*.tmp\n'));
          }
          return Promise.reject(new Error('ENOENT'));
        });
      const filter = new IgnoreFilter(rootUri, false);
      await filter.init();
      const subUri = { fsPath: '/repo/src' } as unknown as vscode.Uri;
      // Call twice with same parentUri — second call should use cache
      await filter.shouldExcludeFile('temp.tmp', 'not-matching', subUri);
      await filter.shouldExcludeFile('other.tmp', 'not-matching', subUri);
      const calls = (vscode.workspace.fs.readFile as ReturnType<typeof vi.fn>).mock.calls;
      const subCalls = calls.filter((c: unknown[]) =>
        (c[0] as { fsPath: string }).fsPath.includes('/repo/src')
      );
      // Should have been called exactly once (cached on second invocation)
      expect(subCalls.length).toBe(1);
    });
  });
});
