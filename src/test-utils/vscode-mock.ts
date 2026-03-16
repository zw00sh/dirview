import { vi } from 'vitest';

/**
 * Creates a comprehensive vscode mock object with sensible defaults.
 * Individual test files can override specific parts via the `overrides` parameter
 * or by mutating the returned object before passing it to vi.mock().
 *
 * Usage in test files:
 *   vi.mock('vscode', () => createVscodeMock());
 *   vi.mock('vscode', () => createVscodeMock({ workspace: { workspaceFolders: [...] } }));
 */
export function createVscodeMock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

  const Uri = {
    joinPath: (base: { fsPath: string; scheme?: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
      scheme: base.scheme ?? 'file',
    }),
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  };

  const workspace = {
    workspaceFolders: undefined as unknown,
    fs: {
      readDirectory: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    },
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
    ...(overrides.workspace as Record<string, unknown> ?? {}),
  };

  const window = {
    showTextDocument: vi.fn(),
    createWebviewPanel: vi.fn(() => ({
      webview: { html: '', onDidReceiveMessage: vi.fn(), postMessage: vi.fn(), asWebviewUri: vi.fn() },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
    ...(overrides.window as Record<string, unknown> ?? {}),
  };

  const commands = {
    registerCommand: vi.fn((name: string, cb: (...args: unknown[]) => unknown) => {
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn(),
    ...(overrides.commands as Record<string, unknown> ?? {}),
  };

  const Position = class {
    constructor(public line: number, public char: number) {}
  };

  const Range = class {
    constructor(public start: any, public end: any) {}
  };

  const ViewColumn = { One: 1, Two: 2, Three: 3 };

  const env = {
    clipboard: { writeText: vi.fn() },
    ...(overrides.env as Record<string, unknown> ?? {}),
  };

  const { workspace: _ws, window: _win, commands: _cmd, env: _env, ...rest } = overrides;

  return {
    FileType,
    Uri,
    workspace,
    window,
    commands,
    Position,
    Range,
    ViewColumn,
    env,
    ...rest,
  };
}
