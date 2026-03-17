// Minimal vscode stub for vite module resolution.
// This module is referenced by the vite alias in vitest.config.ts so that
// imports of 'vscode' resolve during module transformation.
// Tests that need real vscode APIs must call vi.mock('vscode', ...) to override.

export const Uri = {
  joinPath: (...args: any[]) => ({ fsPath: args.join('/'), scheme: 'file' }),
  file: (p: string) => ({ fsPath: p, scheme: 'file' }),
};
export const workspace = { workspaceFolders: undefined, fs: {}, getConfiguration: () => ({ get: () => undefined }) };
export const window = { showTextDocument: () => {}, createWebviewPanel: () => ({}) };
export const commands = { registerCommand: () => ({ dispose: () => {} }), executeCommand: () => {} };
export const Position = class { constructor(public line: number, public char: number) {} };
export const Range = class { constructor(public start: any, public end: any) {} };
export const ViewColumn = { One: 1, Two: 2, Three: 3 };
export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
export const env = { clipboard: { writeText: () => {} } };
