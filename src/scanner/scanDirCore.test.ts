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
  fileMetrics?: Record<string, { sizeBytes: number; lineCount: number }>,
): ScanAdapter<string> {
  return {
    readDir: async (dirPath: string) => entries[dirPath] ?? null,
    joinPath: (parent: string, child: string) => `${parent}/${child}`,
    pathKey: (dirPath: string) => dirPath,
    loadLocalIgnore: async () => ({ ignores: () => false, add: () => ({}) } as any),
    isAborted: () => false,
    getFileMetrics: async (files) => files.map((f: any) => fileMetrics?.[f.path] ?? { sizeBytes: 100, lineCount: 10 }),
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

describe('scanDirCore — line count aggregation', () => {
  it('sets lineCount on each FileNode from adapter metrics', async () => {
    const adapter = createMockAdapter(
      { '/root': [{ name: 'a.ts', isDir: false, isFile: true }] },
      { '/root/a.ts': { sizeBytes: 500, lineCount: 42 } },
    );
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, new Set(), 0, 0);
    expect(result.files[0].lineCount).toBe(42);
    expect(result.files[0].sizeBytes).toBe(500);
  });

  it('accumulates totalLines from direct files', async () => {
    const adapter = createMockAdapter(
      {
        '/root': [
          { name: 'a.ts', isDir: false, isFile: true },
          { name: 'b.ts', isDir: false, isFile: true },
        ],
      },
      {
        '/root/a.ts': { sizeBytes: 100, lineCount: 30 },
        '/root/b.ts': { sizeBytes: 200, lineCount: 70 },
      },
    );
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, new Set(), 0, 0);
    expect(result.totalLines).toBe(100);
  });

  it('accumulates totalLines from child directories', async () => {
    const adapter = createMockAdapter(
      {
        '/root': [{ name: 'src', isDir: true, isFile: false }],
        '/root/src': [
          { name: 'a.ts', isDir: false, isFile: true },
          { name: 'b.js', isDir: false, isFile: true },
        ],
      },
      {
        '/root/src/a.ts': { sizeBytes: 100, lineCount: 50 },
        '/root/src/b.js': { sizeBytes: 100, lineCount: 25 },
      },
    );
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, new Set(), 0, 0);
    expect(result.totalLines).toBe(75);
    expect(result.children[0].totalLines).toBe(75);
  });

  it('includes lineCount and sizeBytes in FileTypeStats', async () => {
    const adapter = createMockAdapter(
      {
        '/root': [
          { name: 'a.ts', isDir: false, isFile: true },
          { name: 'b.ts', isDir: false, isFile: true },
          { name: 'c.js', isDir: false, isFile: true },
        ],
      },
      {
        '/root/a.ts': { sizeBytes: 100, lineCount: 20 },
        '/root/b.ts': { sizeBytes: 200, lineCount: 30 },
        '/root/c.js': { sizeBytes: 150, lineCount: 15 },
      },
    );
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, new Set(), 0, 0);
    const tsStats = result.stats.find(s => s.name === 'TypeScript');
    expect(tsStats).toBeDefined();
    expect(tsStats!.count).toBe(2);
    expect(tsStats!.sizeBytes).toBe(300);
    expect(tsStats!.lineCount).toBe(50);

    const jsStats = result.stats.find(s => s.name === 'JavaScript');
    expect(jsStats).toBeDefined();
    expect(jsStats!.count).toBe(1);
    expect(jsStats!.sizeBytes).toBe(150);
    expect(jsStats!.lineCount).toBe(15);
  });

  it('aggregates stats lineCount and sizeBytes from child dirs', async () => {
    const adapter = createMockAdapter(
      {
        '/root': [
          { name: 'src', isDir: true, isFile: false },
          { name: 'index.ts', isDir: false, isFile: true },
        ],
        '/root/src': [
          { name: 'app.ts', isDir: false, isFile: true },
        ],
      },
      {
        '/root/index.ts': { sizeBytes: 100, lineCount: 10 },
        '/root/src/app.ts': { sizeBytes: 200, lineCount: 40 },
      },
    );
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, new Set(), 0, 0);
    const tsStats = result.stats.find(s => s.name === 'TypeScript');
    expect(tsStats!.count).toBe(2);
    expect(tsStats!.sizeBytes).toBe(300);
    expect(tsStats!.lineCount).toBe(50);
    expect(result.totalLines).toBe(50);
  });

  it('marks files as binary when adapter returns isBinary', async () => {
    const adapter = createMockAdapter(
      {
        '/root': [
          { name: 'image.png', isDir: false, isFile: true },
          { name: 'code.ts', isDir: false, isFile: true },
        ],
      },
      {
        '/root/image.png': { sizeBytes: 4096, lineCount: 0, isBinary: true },
        '/root/code.ts': { sizeBytes: 200, lineCount: 30 },
      },
    );
    const filter = new IgnoreFilterBase();
    await filter.initFromPatterns('/root', true, []);

    const result = await scanDirCore(adapter, '/root', 'root', '', filter, new Set(), 0, 0);
    const png = result.files.find(f => f.name === 'image.png');
    const ts = result.files.find(f => f.name === 'code.ts');
    expect(png!.isBinary).toBe(true);
    expect(png!.lineCount).toBe(0);
    expect(ts!.isBinary).toBeUndefined();
    expect(ts!.lineCount).toBe(30);
    expect(result.totalLines).toBe(30);
  });
});
