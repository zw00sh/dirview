import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';
import { IgnoreFilterBase } from './ignoreFilterBase';

/**
 * VSCode-aware ignore filter for remote scans.
 * Extends the pure IgnoreFilterBase with vscode.workspace.fs support.
 */
export class IgnoreFilter extends IgnoreFilterBase {
  private rootUri: vscode.Uri;

  constructor(rootUri: vscode.Uri, showIgnored: boolean) {
    super();
    this.rootUri = rootUri;
    this.showIgnored = showIgnored;
  }

  /** Initialize by reading vscode config and root .gitignore. */
  async init(): Promise<void> {
    // Read files.exclude from vscode config
    const excludePatterns: string[] = [];
    if (!this.showIgnored) {
      const config = vscode.workspace.getConfiguration('files', this.rootUri);
      const exclude = config.get<Record<string, boolean>>('exclude') ?? {};
      for (const [pattern, enabled] of Object.entries(exclude)) {
        if (enabled) { excludePatterns.push(pattern); }
      }
    }

    if (this.rootUri.scheme === 'file') {
      // Local: use fast fs-based init
      await this.initFromPatterns(this.rootUri.fsPath, this.showIgnored, excludePatterns);
    } else {
      // Remote: use vscode.workspace.fs for root .gitignore
      await this.initFromPatterns('', this.showIgnored, excludePatterns);
      // Override rootIgnore with one loaded via vscode API
      this.rootIgnore = await this.loadGitignoreVscode(this.rootUri);
    }
  }

  private async loadGitignoreVscode(dirUri: vscode.Uri): Promise<Ignore> {
    const ig = ignore();
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dirUri, '.gitignore'));
      ig.add(Buffer.from(bytes).toString('utf-8'));
    } catch {
      // No .gitignore — that's fine
    }
    return ig;
  }

  /** Load local .gitignore via vscode API (for remote scans). */
  async loadLocalIgnore(dirUri: vscode.Uri): Promise<Ignore> {
    const key = dirUri.fsPath;
    if (!this.dirIgnoreCache.has(key)) {
      if (this.rootUri.scheme === 'file') {
        this.dirIgnoreCache.set(key, await this.loadGitignoreFromPath(dirUri.fsPath));
      } else {
        this.dirIgnoreCache.set(key, await this.loadGitignoreVscode(dirUri));
      }
    }
    return this.dirIgnoreCache.get(key)!;
  }
}
