import { vi, describe, it, expect, beforeEach } from 'vitest';
import ignore from 'ignore';

// Mock fs so no real filesystem access occurs
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  },
}));

import { IgnoreFilterBase } from './ignoreFilterBase';
import * as fs from 'fs';

describe('IgnoreFilterBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.promises.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('ENOENT'));
  });

  describe('shouldExcludeDirSync — VCS directories', () => {
    it('excludes .git', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('.git', '.git', localIg)).toBe(true);
    });

    it('excludes .hg', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('.hg', '.hg', localIg)).toBe(true);
    });

    it('excludes .svn', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('.svn', '.svn', localIg)).toBe(true);
    });

    it('excludes .bzr', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('.bzr', '.bzr', localIg)).toBe(true);
    });

    it('excludes _darcs', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('_darcs', '_darcs', localIg)).toBe(true);
    });

    it('excludes VCS dirs case-insensitively (.GIT, .Git)', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('.GIT', '.GIT', localIg)).toBe(true);
      expect(filter.shouldExcludeDirSync('.Git', '.Git', localIg)).toBe(true);
      expect(filter.shouldExcludeDirSync('.SVN', '.SVN', localIg)).toBe(true);
    });

    it('excludes VCS dirs even when showIgnored is true', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', true, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('.git', '.git', localIg)).toBe(true);
      expect(filter.shouldExcludeDirSync('.hg', '.hg', localIg)).toBe(true);
    });
  });

  describe('shouldExcludeFileSync — showIgnored=true', () => {
    it('does not exclude any file when showIgnored is true', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', true, ['**/*.log']);
      const localIg = ignore();
      localIg.add('*.secret');
      expect(filter.shouldExcludeFileSync('app.log', 'app.log', localIg)).toBe(false);
      expect(filter.shouldExcludeFileSync('key.secret', 'key.secret', localIg)).toBe(false);
      expect(filter.shouldExcludeFileSync('index.ts', 'index.ts', localIg)).toBe(false);
    });
  });

  describe('shouldExcludeDirSync — showIgnored=true', () => {
    it('does not exclude regular dirs when showIgnored is true', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', true, ['node_modules/**']);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('node_modules', 'node_modules', localIg)).toBe(false);
    });
  });

  describe('isFilesExcluded — minimatch patterns', () => {
    it('excludes files matching an enabled pattern', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, ['out/**', '**/.DS_Store']);
      const localIg = ignore();
      expect(filter.shouldExcludeFileSync('build.js', 'out/build.js', localIg)).toBe(true);
      expect(filter.shouldExcludeFileSync('.DS_Store', 'src/.DS_Store', localIg)).toBe(true);
    });

    it('does not exclude files that do not match any pattern', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, ['out/**']);
      const localIg = ignore();
      expect(filter.shouldExcludeFileSync('index.ts', 'src/index.ts', localIg)).toBe(false);
    });

    it('does not load filesExclude patterns when showIgnored is true', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', true, ['out/**']);
      const localIg = ignore();
      expect(filter.shouldExcludeFileSync('build.js', 'out/build.js', localIg)).toBe(false);
    });

    it('excludes directories matching a pattern with trailing slash', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, ['dist/**']);
      const localIg = ignore();
      // shouldExcludeDirSync appends '/' to relPath for filesExclude check
      expect(filter.shouldExcludeDirSync('dist', 'dist', localIg)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty exclude patterns array', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeFileSync('index.ts', 'index.ts', localIg)).toBe(false);
      expect(filter.shouldExcludeDirSync('src', 'src', localIg)).toBe(false);
    });

    it('does not exclude a plain file with no matching patterns', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      // A regular file with no ignore rules should pass through
      expect(filter.shouldExcludeFileSync('readme.txt', 'readme.txt', localIg)).toBe(false);
      expect(filter.shouldExcludeDirSync('src', 'src', localIg)).toBe(false);
    });

    it('gitignore patterns from root .gitignore are applied', async () => {
      (fs.promises.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValue('node_modules/\n*.log\n');
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      expect(filter.shouldExcludeDirSync('node_modules', 'node_modules', localIg)).toBe(true);
      expect(filter.shouldExcludeFileSync('error.log', 'error.log', localIg)).toBe(true);
      expect(filter.shouldExcludeFileSync('index.ts', 'index.ts', localIg)).toBe(false);
    });

    it('local ignore patterns are applied via localIg parameter', async () => {
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      const localIg = ignore();
      localIg.add('*.tmp');
      expect(filter.shouldExcludeFileSync('cache.tmp', 'src/cache.tmp', localIg)).toBe(true);
      expect(filter.shouldExcludeFileSync('app.ts', 'src/app.ts', localIg)).toBe(false);
    });

    it('loadLocalIgnoreByPath caches results', async () => {
      (fs.promises.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValue('*.tmp\n');
      const filter = new IgnoreFilterBase();
      await filter.initFromPatterns('/repo', false, []);
      await filter.loadLocalIgnoreByPath('/repo/src');
      await filter.loadLocalIgnoreByPath('/repo/src');
      const calls = (fs.promises.readFile as ReturnType<typeof vi.fn>).mock.calls;
      // Root .gitignore read + one read for /repo/src (second call cached)
      const srcCalls = calls.filter((c: unknown[]) =>
        (c[0] as string).includes('/repo/src')
      );
      expect(srcCalls.length).toBe(1);
    });
  });
});
