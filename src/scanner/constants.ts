// Lowercase for case-insensitive matching on macOS/Windows file systems.
export const VCS_DIRS = new Set(['.git', '.hg', '.svn', '.bzr', '_darcs']);

export function isVcsDir(name: string): boolean {
  return VCS_DIRS.has(name.toLowerCase());
}
