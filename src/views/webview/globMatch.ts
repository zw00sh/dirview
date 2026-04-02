// Glob pattern → RegExp converter for client-side file filtering.
// Supports: * (non-slash), ** (any), ? (single non-slash), {a,b} brace expansion.
// Case-insensitive to match ripgrep --iglob behavior.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globToRegex(pattern: string): { regex: RegExp; hasSlash: boolean } {
  // Trim leading ./ if present (common user habit).
  if (pattern.startsWith('./')) { pattern = pattern.slice(2); }

  const hasSlash = pattern.includes('/');
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // **/ matches zero or more directory segments
          re += '(?:.+/)?';
          i += 3;
        } else {
          // ** at end or before non-slash — match anything
          re += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '{') {
      const close = pattern.indexOf('}', i);
      if (close !== -1) {
        const alts = pattern.slice(i + 1, close).split(',').map(escapeRegex).join('|');
        re += '(?:' + alts + ')';
        i = close + 1;
      } else {
        re += escapeRegex(c);
        i++;
      }
    } else if ('.[+^$|()\\]'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return { regex: new RegExp('^' + re + '$', 'i'), hasSlash };
}
