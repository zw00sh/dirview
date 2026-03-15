import { describe, it, expect } from 'vitest';
import { VCS_DIRS, isVcsDir } from './constants';

describe('VCS_DIRS', () => {
  it('contains .git', () => {
    expect(VCS_DIRS.has('.git')).toBe(true);
  });

  it('contains .hg', () => {
    expect(VCS_DIRS.has('.hg')).toBe(true);
  });

  it('contains .svn', () => {
    expect(VCS_DIRS.has('.svn')).toBe(true);
  });

  it('contains .bzr', () => {
    expect(VCS_DIRS.has('.bzr')).toBe(true);
  });

  it('contains _darcs', () => {
    expect(VCS_DIRS.has('_darcs')).toBe(true);
  });

  it('does not contain arbitrary directories', () => {
    expect(VCS_DIRS.has('node_modules')).toBe(false);
    expect(VCS_DIRS.has('.github')).toBe(false);
    expect(VCS_DIRS.has('src')).toBe(false);
  });
});

describe('isVcsDir', () => {
  it('matches case-insensitively', () => {
    expect(isVcsDir('.GIT')).toBe(true);
    expect(isVcsDir('.Git')).toBe(true);
    expect(isVcsDir('.Hg')).toBe(true);
    expect(isVcsDir('.SVN')).toBe(true);
  });

  it('rejects non-VCS directories', () => {
    expect(isVcsDir('node_modules')).toBe(false);
    expect(isVcsDir('.github')).toBe(false);
  });
});
