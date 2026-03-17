import { describe, it, expect, vi } from 'vitest';
import { scanDirCore, type ScanAdapter, type DirEntry } from './scanDirCore';
import { IgnoreFilterBase } from './ignoreFilterBase';

// Mock languageMap since it's imported by scanDirCore
vi.mock('../language/languageMap', () => ({
  getLangInfo: (name: string) => {
    if (name.endsWith('.ts')) return { name: 'TypeScript', color: '#3178c6' };
    if (name.endsWith('.js')) return { name: 'JavaScript', color: '#f1e05a' };
    return { name: 'Other', color: '#999' };
  },
}));

/** Creates a minimal mock adapter for testing scanDirCore. */
function createMockAdapter(
  entries: Record<string, DirEntry[]>,
): ScanAdapter<string> {
  return {
    readDir: async (dirPath: string) => entries[dirPath] ?? null,
    joinPath: (parent: string, child: string) => `${parent}/${child}`,
    pathKey: (dirPath: string) => dirPath,
    loadLocalIgnore: async () => ({ ignores: () => false, add: () => ({}) } as any),
    isAborted: () => false,
    getFileSizes: async (files) => files.map(() => 100),
  };
}

describe('scanDirCore — symlink handling', () => {
  it('does not count entries where isFile=false and isDir=false (bare symlinks)', async () => {
    const adapter = createMockAdapter({
      '/root': [
        { name: 'real.ts', isDir: false, isFile: true },
        { name: 'symlink.ts', isDir: false, isFile: false },  // symlink — neither file nor dir
        { name: 'another-link', isDir: false, isFile: false },
      ],
    });
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);
    const visited = new Set<string>();

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, visited, 0, 0);
    expect(result.totalFiles).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('real.ts');
  });

  it('counts entries where isFile=true regardless of symlink status', async () => {
    const adapter = createMockAdapter({
      '/root': [
        { name: 'a.ts', isDir: false, isFile: true },
        { name: 'b.ts', isDir: false, isFile: true },  // could be a symlink to a file, adapter says isFile=true
      ],
    });
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);
    const visited = new Set<string>();

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, visited, 0, 0);
    expect(result.totalFiles).toBe(2);
    expect(result.files).toHaveLength(2);
  });

  it('recurses into entries where isDir=true but ignores non-dir non-file entries', async () => {
    const adapter = createMockAdapter({
      '/root': [
        { name: 'src', isDir: true, isFile: false },
        { name: 'link-to-dir', isDir: false, isFile: false },  // symlink to dir — not followed
      ],
      '/root/src': [
        { name: 'index.ts', isDir: false, isFile: true },
      ],
    });
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);
    const visited = new Set<string>();

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, visited, 0, 0);
    expect(result.totalFiles).toBe(1);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe('src');
  });
});
