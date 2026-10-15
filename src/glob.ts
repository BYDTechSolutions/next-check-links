/**
 * A small glob matcher, enough for file and path patterns:
 * `**` matches across `/`, `*` and `?` stay inside one segment, `{a,b}` is a choice.
 * Everything else is literal. Node 20 has no built-in glob, and this keeps the
 * package to one runtime dependency.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more whole segments; a bare `**` matches anything.
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (c === '?') {
      source += '[^/]';
    } else if (c === '{') {
      braces++;
      source += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      source += ')';
    } else if (c === ',' && braces > 0) {
      source += '|';
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** Builds one test for a list of globs: true when any of them matches. */
export function globMatcher(patterns: readonly string[]): (value: string) => boolean {
  const regexes = patterns.map(globToRegExp);
  return (value) => regexes.some((r) => r.test(value));
}
