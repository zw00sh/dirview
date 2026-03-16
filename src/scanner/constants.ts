const VCS_DIRS = new Set(['.git', '.hg', '.svn', '.bzr', '_darcs']);

/** Case-insensitive check — handles .GIT on case-insensitive filesystems. */
export function isVcsDir(name: string): boolean {
  return VCS_DIRS.has(name.toLowerCase());
}
