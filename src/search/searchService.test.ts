import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import { SearchService, ripgrepCandidates } from './searchService';

// We can't directly test normalizeGlob and commonRgFlags since they're not exported,
// but we can verify their effects by inspecting the spawn arguments.

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const proc = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    };
    return proc;
  }),
}));

describe('normalizeGlob — bare * and ** are skipped', () => {
  let service: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SearchService();
    (service as any).hasRipgrep = true;
    (service as any).rgPath = 'rg';
  });

  it('searchFiles with bare * does not pass --iglob *', () => {
    service.searchFiles('*', ['/ws']);
    const spawnCall = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnCall[1];
    // Should NOT contain --iglob followed by * or **
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--iglob') {
        expect(args[i + 1]).not.toBe('*');
        expect(args[i + 1]).not.toBe('**');
      }
    }
  });

  it('searchFiles with bare ** does not pass --iglob **', () => {
    service.searchFiles('**', ['/ws']);
    const spawnCall = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnCall[1];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--iglob') {
        expect(args[i + 1]).not.toBe('*');
        expect(args[i + 1]).not.toBe('**');
      }
    }
  });

  it('searchFiles with "*.ts" passes --iglob *.ts', () => {
    service.searchFiles('*.ts', ['/ws']);
    const spawnCall = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnCall[1];
    const iglobIdx = args.indexOf('--iglob');
    expect(iglobIdx).toBeGreaterThan(-1);
    expect(args[iglobIdx + 1]).toBe('*.ts');
  });

  it('searchWorkspace with bare * in include does not pass --iglob *', () => {
    service.searchWorkspace('test', ['/ws'], { include: '*' });
    const spawnCall = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnCall[1];
    // The only --iglob entries should NOT be bare * or **
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--iglob') {
        expect(args[i + 1]).not.toBe('*');
        expect(args[i + 1]).not.toBe('**');
      }
    }
  });

  it('searchWorkspace with comma-separated globs including bare * skips only bare *', () => {
    service.searchWorkspace('test', ['/ws'], { include: '*, *.ts' });
    const spawnCall = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnCall[1];
    const iglobs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--iglob') { iglobs.push(args[i + 1]); }
    }
    // Only *.ts should be present, not bare *
    expect(iglobs).toContain('*.ts');
    expect(iglobs).not.toContain('*');
  });

  it('searchWorkspace with bare ** in exclude does not pass --iglob !**', () => {
    service.searchWorkspace('test', ['/ws'], { exclude: '**' });
    const spawnCall = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnCall[1];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--iglob') {
        expect(args[i + 1]).not.toBe('!**');
        expect(args[i + 1]).not.toBe('!*');
      }
    }
  });
});

describe('commonRgFlags — ripgrep flag construction', () => {
  let service: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SearchService();
    (service as any).hasRipgrep = true;
    (service as any).rgPath = 'rg';
  });

  it('always includes --hidden flag', () => {
    service.searchFiles('*.ts', ['/ws']);
    const args: string[] = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args).toContain('--hidden');
  });

  it('includes --no-ignore when showIgnored is true', () => {
    service.searchFiles('*.ts', ['/ws'], undefined, { showIgnored: true });
    const args: string[] = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args).toContain('--no-ignore');
  });

  it('does not include --no-ignore when showIgnored is false', () => {
    service.searchFiles('*.ts', ['/ws'], undefined, { showIgnored: false });
    const args: string[] = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args).not.toContain('--no-ignore');
  });

  it('does not include --no-ignore when showIgnored is undefined', () => {
    service.searchFiles('*.ts', ['/ws']);
    const args: string[] = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args).not.toContain('--no-ignore');
  });

  it('adds --glob !pattern for each filesExclude entry', () => {
    service.searchFiles('*.ts', ['/ws'], undefined, {
      filesExclude: ['node_modules', '*.log'],
    });
    const args: string[] = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // Find all --glob pairs
    const globPairs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--glob') { globPairs.push(args[i + 1]); }
    }
    expect(globPairs).toContain('!node_modules');
    expect(globPairs).toContain('!*.log');
  });

  it('searchWorkspace passes showIgnored and filesExclude to commonRgFlags', () => {
    service.searchWorkspace('pattern', ['/ws'], {
      showIgnored: true,
      filesExclude: ['dist'],
    });
    const args: string[] = (child_process.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args).toContain('--no-ignore');
    const globPairs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--glob') { globPairs.push(args[i + 1]); }
    }
    expect(globPairs).toContain('!dist');
  });
});

describe('ripgrepCandidates — bundled binary resolution', () => {
  const APPROOT = '/fake/vscode/resources/app';
  const platArch = `${process.platform}-${process.arch}`;
  const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';

  it('includes the modern @vscode/ripgrep-universal unpacked platform path', () => {
    const candidates = ripgrepCandidates(APPROOT);
    // Modern VSCode: node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/<plat>-<arch>/rg
    const expected = `${APPROOT}/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/${platArch}/${exe}`;
    expect(candidates).toContain(expected);
  });

  it('includes the legacy @vscode/ripgrep flat path for older VSCode', () => {
    const candidates = ripgrepCandidates(APPROOT);
    expect(candidates).toContain(`${APPROOT}/node_modules/@vscode/ripgrep/bin/${exe}`);
  });

  it('prefers the unpacked location over the plain node_modules path', () => {
    const candidates = ripgrepCandidates(APPROOT);
    const unpacked = candidates.findIndex(c => c.includes('node_modules.asar.unpacked'));
    const plain = candidates.findIndex(c => c.includes('/node_modules/@vscode/ripgrep-universal'));
    expect(unpacked).toBeGreaterThan(-1);
    expect(plain).toBeGreaterThan(unpacked);
  });

  it('always ends with the bare PATH fallback, and only once', () => {
    const candidates = ripgrepCandidates(APPROOT);
    expect(candidates[candidates.length - 1]).toBe(exe);
    expect(candidates.filter(c => c === exe).length).toBe(1);
  });

  it('still yields a PATH fallback when no appRoot is given', () => {
    const candidates = ripgrepCandidates(undefined);
    expect(candidates[candidates.length - 1]).toBe(exe);
  });
});

describe('SearchService.probe — picks the first working candidate', () => {
  const APPROOT = '/fake/vscode/resources/app';

  beforeEach(() => { vi.clearAllMocks(); });

  /** Make spawn(cmd, ['--version']) exit 0 only for `workingPath`, else exit 1. */
  function mockRgAt(workingPath: string | null) {
    (child_process.spawn as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') { cb(cmd === workingPath ? 0 : 1); }
      },
    }));
  }

  it('resolves true and selects the bundled path when it runs', async () => {
    const candidates = ripgrepCandidates(APPROOT);
    const universal = candidates.find(c => c.includes('ripgrep-universal'))!;
    mockRgAt(universal);
    const svc = new SearchService(APPROOT);
    const ok = await svc.probe();
    expect(ok).toBe(true);
    expect(svc.hasRipgrep).toBe(true);
    expect((svc as any).rgPath).toBe(universal);
  });

  it('falls through to the next candidate when earlier ones fail', async () => {
    const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
    mockRgAt(exe); // only the bare PATH fallback works
    const svc = new SearchService(APPROOT);
    const ok = await svc.probe();
    expect(ok).toBe(true);
    expect((svc as any).rgPath).toBe(exe);
  });

  it('resolves false and sets hasRipgrep=false when nothing runs', async () => {
    mockRgAt(null);
    const svc = new SearchService(APPROOT);
    const ok = await svc.probe();
    expect(ok).toBe(false);
    expect(svc.hasRipgrep).toBe(false);
  });

  it('treats a spawn error (missing binary) as a failed candidate', async () => {
    (child_process.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      on: (event: string, cb: (arg?: unknown) => void) => {
        if (event === 'error') { cb(new Error('ENOENT')); }
      },
    }));
    const svc = new SearchService(APPROOT);
    const ok = await svc.probe();
    expect(ok).toBe(false);
  });
});

