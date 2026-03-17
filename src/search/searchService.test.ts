import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import { SearchService } from './searchService';

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

