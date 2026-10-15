import { describe, expect, it } from 'vitest';
import { globMatcher, globToRegExp } from '../src/glob.js';

describe('glob', () => {
  it('matches *, **, ? and {a,b}', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/c.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/c.ts')).toBe(false);
    expect(globToRegExp('**/*.{test,spec}.*').test('lib/x.spec.tsx')).toBe(true);
    expect(globToRegExp('/api/**').test('/api/v1/users')).toBe(true);
    expect(globToRegExp('/api/**').test('/apis')).toBe(false);
    expect(globToRegExp('/work/*').test('/work/${slug}')).toBe(true);
    expect(globToRegExp('/p?ge').test('/page')).toBe(true);
    expect(globToRegExp('file.(x)+').test('file.(x)+')).toBe(true);
  });

  it('combines patterns', () => {
    const m = globMatcher(['/a', '/b/**']);
    expect(m('/a')).toBe(true);
    expect(m('/b/c')).toBe(true);
    expect(m('/c')).toBe(false);
    expect(globMatcher([])('/a')).toBe(false);
  });
});
