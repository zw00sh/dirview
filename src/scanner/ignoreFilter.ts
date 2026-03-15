import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';
import { Minimatch } from 'minimatch';
import { isVcsDir } from './constants';

export class IgnoreFilter {
  private rootIgnore: Ignore;
  private filesExcludePatterns: Minimatch[];
  private showIgnored: boolean;
  private rootUri: vscode.Uri;
  private dirIgnoreCache = new Map<string, Ignore>();

  constructor(rootUri: vscode.Uri, showIgnored: boolean) {
    this.rootUri = rootUri;
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
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dirUri, '.gitignore'));
      ig.add(Buffer.from(bytes).toString('utf-8'));
    } catch {
      // No .gitignore — that's fine
    }
    return ig;
  }

  private async getLocalIgnore(parentUri: vscode.Uri): Promise<Ignore> {
    const key = parentUri.fsPath;
    if (!this.dirIgnoreCache.has(key)) {
      this.dirIgnoreCache.set(key, await this.loadGitignore(parentUri));
    }
    return this.dirIgnoreCache.get(key)!;
  }

  private isFilesExcluded(relPath: string): boolean {
    return this.filesExcludePatterns.some(m => m.match(relPath));
  }

  async shouldExcludeDir(name: string, relPath: string, parentUri: vscode.Uri): Promise<boolean> {
    if (isVcsDir(name)) { return true; }
    if (this.showIgnored) { return false; }

    if (this.isFilesExcluded(relPath + '/')) { return true; }
    if (this.rootIgnore.ignores(relPath + '/') || this.rootIgnore.ignores(relPath)) { return true; }

    const localIg = await this.getLocalIgnore(parentUri);
    return localIg.ignores(name + '/') || localIg.ignores(name);
  }

  async shouldExcludeFile(name: string, relPath: string, parentUri: vscode.Uri): Promise<boolean> {
    if (this.showIgnored) { return false; }

    if (this.isFilesExcluded(relPath)) { return true; }
    if (this.rootIgnore.ignores(relPath)) { return true; }

    const localIg = await this.getLocalIgnore(parentUri);
    return localIg.ignores(name);
  }
}
