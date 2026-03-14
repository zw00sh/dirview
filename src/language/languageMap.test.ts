import { describe, it, expect } from 'vitest';
import { getLangInfo, groupMap } from './languageMap';

describe('getLangInfo', () => {
  it('returns correct info for .ts extension', () => {
    const info = getLangInfo('index.ts');
    expect(info.name).toBe('TypeScript');
    expect(info.color).toBeTruthy();
  });

  it('returns correct info for .js extension', () => {
    const info = getLangInfo('app.js');
    expect(info.name).toBe('JavaScript');
  });

  it('returns correct info for .py extension', () => {
    const info = getLangInfo('main.py');
    expect(info.name).toBe('Python');
  });

  it('uses PREFERRED map for .md (Markdown over others)', () => {
    const info = getLangInfo('README.md');
    expect(info.name).toBe('Markdown');
  });

  it('uses PREFERRED map for .yml (YAML)', () => {
    const info = getLangInfo('config.yml');
    expect(info.name).toBe('YAML');
  });

  it('uses PREFERRED map for .yaml (YAML)', () => {
    const info = getLangInfo('config.yaml');
    expect(info.name).toBe('YAML');
  });

  it('uses PREFERRED map for .html (HTML)', () => {
    const info = getLangInfo('index.html');
    expect(info.name).toBe('HTML');
  });

  it('uses PREFERRED map for .rs (Rust)', () => {
    const info = getLangInfo('main.rs');
    expect(info.name).toBe('Rust');
  });

  it('matches by exact filename (Makefile)', () => {
    const info = getLangInfo('Makefile');
    expect(info.name).toBe('Makefile');
  });

  it('matches by exact filename case-insensitively (makefile)', () => {
    const info = getLangInfo('makefile');
    expect(info.name).toBe('Makefile');
  });

  it('matches Dockerfile by filename', () => {
    const info = getLangInfo('Dockerfile');
    expect(info.name).toBe('Dockerfile');
  });

  it('returns Other for unknown extension', () => {
    const info = getLangInfo('file.xyzunknown123');
    expect(info.name).toBe('Other');
    expect(info.color).toBe('#8b8b8b');
  });

  it('returns Other for file with no extension', () => {
    const info = getLangInfo('somefile');
    expect(info.name).toBe('Other');
  });

  it('handles uppercase extensions case-insensitively', () => {
    const info = getLangInfo('MAIN.TS');
    expect(info.name).toBe('TypeScript');
  });
});

describe('groupMap', () => {
  it('maps variant languages to their group parent', () => {
    expect(groupMap.get('Maven POM')).toBe('XML');
    expect(groupMap.get('JSON with Comments')).toBe('JSON');
  });

  it('does not include languages that are their own group', () => {
    expect(groupMap.get('TypeScript')).toBeUndefined();
    expect(groupMap.get('XML')).toBeUndefined();
  });
});
