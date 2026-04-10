import { vi, describe, it, expect } from 'vitest';
import { createVscodeMock } from '../test-utils/vscode-mock';

const { FRONTEND_ROOT, BACKEND_ROOT } = vi.hoisted(() => ({
  FRONTEND_ROOT: '/Users/test/frontend',
  BACKEND_ROOT: '/Users/test/backend',
}));

vi.mock('vscode', () => createVscodeMock({
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: FRONTEND_ROOT }, name: 'frontend' },
      { uri: { fsPath: BACKEND_ROOT }, name: 'backend' },
    ],
  },
}));

import { resolveDirPath } from './resolveDirPath';

describe('resolveDirPath', () => {
  it('returns undefined when rootName matches no workspace folder', () => {
    expect(resolveDirPath('frontend', 'unknown')).toBeUndefined();
  });

  it('resolves a root-only prefixed path to the folder fsPath', () => {
    expect(resolveDirPath('frontend', 'frontend')).toBe(FRONTEND_ROOT);
    expect(resolveDirPath('backend', 'backend')).toBe(BACKEND_ROOT);
  });

  it('strips rootName prefix and joins remaining relative', () => {
    expect(resolveDirPath('frontend/src/utils', 'frontend')).toBe(`${FRONTEND_ROOT}/src/utils`);
    expect(resolveDirPath('backend/lib', 'backend')).toBe(`${BACKEND_ROOT}/lib`);
  });

  it('handles two roots with the same subdir name without collision', () => {
    expect(resolveDirPath('frontend/src', 'frontend')).toBe(`${FRONTEND_ROOT}/src`);
    expect(resolveDirPath('backend/src', 'backend')).toBe(`${BACKEND_ROOT}/src`);
  });

  it('handles legacy single-root form (path is not prefixed)', () => {
    // In single-root, the prefix transform is skipped, so path is bare relative.
    expect(resolveDirPath('src/utils', 'frontend')).toBe(`${FRONTEND_ROOT}/src/utils`);
  });

  it('handles empty relative path', () => {
    expect(resolveDirPath('', 'frontend')).toBe(FRONTEND_ROOT);
  });
});
