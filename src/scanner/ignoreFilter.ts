import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { Minimatch } from 'minimatch';
import { VCS_DIRS } from './constants';

export class IgnoreFilter {
  private rootIgnore: Ignore;
  private filesExcludePatterns: Minimatch[];
  private showIgnored: boolean;
  private rootUri: vscode.Uri;
  private isLocal: boolean;
  private dirIgnoreCache = new Map<string, Ignore>();

  constructor(rootUri: vscode.Uri, showIgnored: boolean) {
    this.rootUri = rootUri;
    this.isLocal = rootUri.scheme === 'file';
    this.showIgnored = showIgnored;
    this.rootIgnore = ignore();
    this.filesExcludePatterns = [];
  }

  async init(): Promise<void> {
    this.rootIgnore = await this.loadGitignore(this.rootUri);

    if (!this.showIgnored) {
      const config = vscode.workspace.getConfiguration('files', this.rootUri);
      const exclude = config.get<Record<string, boolean>>('exclude') ?? {};
      this.filesExcludePatterns = Object.entries(exclude)
        .filter(([, enabled]) => enabled)
        .map(([pattern]) => new Minimatch(pattern, { dot: true, matchBase: true }));
    }
  }

  private async loadGitignore(dirUri: vscode.Uri): Promise<Ignore> {
    const ig = ignore();
    try {
      if (this.isLocal) {
        const content = await fs.promises.readFile(path.join(dirUri.fsPath, '.gitignore'), 'utf-8');
        ig.add(content);
      } else {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dirUri, '.gitignore'));
        ig.add(Buffer.from(bytes).toString('utf-8'));
      }
    } catch {
      // No .gitignore — that's fine
    }
    return ig;
  }

  /** Load the local .gitignore for a directory. One async call per unique directory. */
  async loadLocalIgnore(dirUri: vscode.Uri): Promise<Ignore> {
    const key = dirUri.fsPath;
    if (!this.dirIgnoreCache.has(key)) {
      this.dirIgnoreCache.set(key, await this.loadGitignore(dirUri));
    }
    return this.dirIgnoreCache.get(key)!;
  }

  /** Load local .gitignore by filesystem path (avoids Uri allocation for local scans). */
  async loadLocalIgnoreByPath(dirPath: string): Promise<Ignore> {
    if (!this.dirIgnoreCache.has(dirPath)) {
      const ig = ignore();
      try {
        const content = await fs.promises.readFile(path.join(dirPath, '.gitignore'), 'utf-8');
        ig.add(content);
      } catch {
        // No .gitignore — that's fine
      }
      this.dirIgnoreCache.set(dirPath, ig);
    }
    return this.dirIgnoreCache.get(dirPath)!;
  }

  private isFilesExcluded(relPath: string): boolean {
    return this.filesExcludePatterns.some(m => m.match(relPath));
  }

  /** Synchronous exclude check — requires localIg to be pre-loaded via loadLocalIgnore(). */
  shouldExcludeDirSync(name: string, relPath: string, localIg: Ignore): boolean {
    if (VCS_DIRS.has(name)) { return true; }
    if (this.showIgnored) { return false; }

    if (this.isFilesExcluded(relPath + '/')) { return true; }
    if (this.rootIgnore.ignores(relPath + '/') || this.rootIgnore.ignores(relPath)) { return true; }

    return localIg.ignores(name + '/') || localIg.ignores(name);
  }

  /** Synchronous exclude check — requires localIg to be pre-loaded via loadLocalIgnore(). */
  shouldExcludeFileSync(name: string, relPath: string, localIg: Ignore): boolean {
    if (this.showIgnored) { return false; }

    if (this.isFilesExcluded(relPath)) { return true; }
    if (this.rootIgnore.ignores(relPath)) { return true; }

    return localIg.ignores(name);
  }
}
