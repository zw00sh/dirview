import { describe, it, expect } from 'vitest';
import { globToRegex } from './globMatch';

describe('globToRegex', () => {
  function matches(pattern: string, target: string): boolean {
    return globToRegex(pattern).regex.test(target);
  }

  it('matches simple extension globs', () => {
    expect(matches('*.ts', 'foo.ts')).toBe(true);
    expect(matches('*.ts', 'foo.js')).toBe(false);
    expect(matches('*.ts', 'dir/foo.ts')).toBe(false); // * does not match /
  });

  it('is case-insensitive', () => {
    expect(matches('*.TS', 'foo.ts')).toBe(true);
    expect(matches('*.ts', 'FOO.TS')).toBe(true);
  });

  it('matches ** for any path', () => {
    expect(matches('**/*.ts', 'src/foo.ts')).toBe(true);
    expect(matches('**/*.ts', 'a/b/c/foo.ts')).toBe(true);
    expect(matches('**/*.ts', 'foo.ts')).toBe(true); // **/ matches zero segments
  });

  it('matches ? for single character', () => {
    expect(matches('?.ts', 'a.ts')).toBe(true);
    expect(matches('?.ts', 'ab.ts')).toBe(false);
    expect(matches('?.ts', '/.ts')).toBe(false); // ? does not match /
  });

  it('handles brace expansion', () => {
    expect(matches('*.{ts,tsx}', 'foo.ts')).toBe(true);
    expect(matches('*.{ts,tsx}', 'foo.tsx')).toBe(true);
    expect(matches('*.{ts,tsx}', 'foo.js')).toBe(false);
  });

  it('handles path patterns with /', () => {
    const result = globToRegex('src/**/*.ts');
    expect(result.hasSlash).toBe(true);
    expect(result.regex.test('src/foo.ts')).toBe(true);
    expect(result.regex.test('src/a/b/foo.ts')).toBe(true);
    expect(result.regex.test('lib/foo.ts')).toBe(false);
  });

  it('sets hasSlash correctly', () => {
    expect(globToRegex('*.ts').hasSlash).toBe(false);
    expect(globToRegex('src/*.ts').hasSlash).toBe(true);
  });

  it('escapes regex special characters in patterns', () => {
    expect(matches('file.test.ts', 'file.test.ts')).toBe(true);
    expect(matches('file.test.ts', 'filextest.ts')).toBe(false); // . is literal
  });

  it('strips leading ./', () => {
    const result = globToRegex('./*.ts');
    expect(result.hasSlash).toBe(false); // ./ stripped, no slash remains
    expect(result.regex.test('foo.ts')).toBe(true);
  });

  it('handles unclosed brace as literal', () => {
    expect(matches('{unclosed', '{unclosed')).toBe(true);
  });

  it('handles ** without trailing /', () => {
    expect(matches('src/**', 'src/foo/bar.ts')).toBe(true);
    expect(matches('src/**', 'src/foo.ts')).toBe(true);
  });
});
