import { describe, it, expect } from 'vitest';
import { isVcsDir } from './constants';

describe('isVcsDir', () => {
  it('recognises standard VCS directories', () => {
    expect(isVcsDir('.git')).toBe(true);
    expect(isVcsDir('.hg')).toBe(true);
    expect(isVcsDir('.svn')).toBe(true);
    expect(isVcsDir('.bzr')).toBe(true);
    expect(isVcsDir('_darcs')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isVcsDir('.GIT')).toBe(true);
    expect(isVcsDir('.Git')).toBe(true);
    expect(isVcsDir('.SVN')).toBe(true);
    expect(isVcsDir('.Hg')).toBe(true);
    expect(isVcsDir('_DARCS')).toBe(true);
  });

  it('rejects non-VCS directories', () => {
    expect(isVcsDir('node_modules')).toBe(false);
    expect(isVcsDir('.github')).toBe(false);
    expect(isVcsDir('src')).toBe(false);
  });
});
