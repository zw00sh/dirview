import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { Minimatch } from 'minimatch';
import { VCS_DIRS } from './constants';

/**
 * Pure JS ignore filter — no vscode dependency.
 * Used by both the worker thread (local scans) and main thread (via IgnoreFilter wrapper for remote).
 */
export class IgnoreFilterBase {
  protected rootIgnore: Ignore;
  protected filesExcludePatterns: Minimatch[];
  protected showIgnored: boolean;
  protected dirIgnoreCache = new Map<string, Ignore>();

  constructor() {
    this.rootIgnore = ignore();
    this.filesExcludePatterns = [];
    this.showIgnored = false;
  }

  /** Initialize from pre-resolved config (no vscode APIs needed). */
  async initFromPatterns(rootPath: string, showIgnored: boolean, excludePatterns: string[]): Promise<void> {
    this.showIgnored = showIgnored;
    this.rootIgnore = await this.loadGitignoreFromPath(rootPath);

    if (!showIgnored) {
      this.filesExcludePatterns = excludePatterns
        .map(pattern => new Minimatch(pattern, { dot: true, matchBase: true }));
    }
  }

  protected async loadGitignoreFromPath(dirPath: string): Promise<Ignore> {
    const ig = ignore();
    try {
      const content = await fs.promises.readFile(path.join(dirPath, '.gitignore'), 'utf-8');
      ig.add(content);
    } catch {
      // No .gitignore — that's fine
    }
    return ig;
  }

  /** Load local .gitignore by filesystem path. Cached per directory. */
  async loadLocalIgnoreByPath(dirPath: string): Promise<Ignore> {
    if (!this.dirIgnoreCache.has(dirPath)) {
      this.dirIgnoreCache.set(dirPath, await this.loadGitignoreFromPath(dirPath));
    }
    return this.dirIgnoreCache.get(dirPath)!;
  }

  protected isFilesExcluded(relPath: string): boolean {
    return this.filesExcludePatterns.some(m => m.match(relPath));
  }

  /** Synchronous exclude check — requires localIg to be pre-loaded. */
  shouldExcludeDirSync(name: string, relPath: string, localIg: Ignore): boolean {
    if (VCS_DIRS.has(name)) { return true; }
    if (this.showIgnored) { return false; }

    if (this.isFilesExcluded(relPath + '/')) { return true; }
    if (this.rootIgnore.ignores(relPath + '/') || this.rootIgnore.ignores(relPath)) { return true; }

    return localIg.ignores(name + '/') || localIg.ignores(name);
  }

  /** Synchronous exclude check — requires localIg to be pre-loaded. */
  shouldExcludeFileSync(name: string, relPath: string, localIg: Ignore): boolean {
    if (this.showIgnored) { return false; }

    if (this.isFilesExcluded(relPath)) { return true; }
    if (this.rootIgnore.ignores(relPath)) { return true; }

    return localIg.ignores(name);
  }
}
