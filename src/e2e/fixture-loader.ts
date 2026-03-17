// DirNode fixture loading for E2E tests.
// Reads pre-generated JSON fixtures from bench/fixtures/*.json.

import * as fs from 'fs';
import * as path from 'path';
import type { DirNode } from '../scanner/types';

export interface FixtureData {
  roots: DirNode[];
  workspaceFolderName: string;
}

/**
 * Loads a DirNode fixture from a JSON file.
 *
 * @param fixturePath - Absolute path to the JSON fixture file.
 *   If a relative path is given, it's resolved from the project root.
 */
export function loadFixture(fixturePath: string): FixtureData {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const absPath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.resolve(projectRoot, fixturePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(
      `Fixture not found: ${absPath}\n` +
      `Generate it with: node bench/generate-fixture.mjs <workspace-dir>`
    );
  }

  const json = JSON.parse(fs.readFileSync(absPath, 'utf-8'));

  // The fixture is a DirNode tree. The top-level is an array of roots (workspace folders).
  // generate-fixture.mjs produces a single root node; wrap in array if needed.
  const roots: DirNode[] = Array.isArray(json) ? json : [json];

  // Derive workspace folder name from the first root.
  const workspaceFolderName = roots.length > 0 ? roots[0].name : '';

  return { roots, workspaceFolderName };
}

/**
 * Resolves a fixture path from a workspace directory name.
 * Looks in bench/fixtures/<name>.json.
 */
export function fixturePathForWorkspace(workspace: string): string {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const name = path.basename(workspace);
  return path.resolve(projectRoot, 'bench', 'fixtures', `${name}.json`);
}
