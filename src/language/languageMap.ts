// eslint-disable-next-line @typescript-eslint/no-var-requires
const languages = require('linguist-languages') as Record<string, {
  color?: string;
  extensions?: string[];
  filenames?: string[];
  group?: string;
}>;

export interface LangInfo {
  name: string;
  color: string;
}

const OTHER: LangInfo = { name: 'Other', color: '#8b8b8b' };

// Preferred language for ambiguous extensions (linguist-languages has many-to-one mappings)
const PREFERRED = new Map<string, string>([
  ['.md', 'Markdown'],
  ['.yml', 'YAML'],
  ['.yaml', 'YAML'],
  ['.html', 'HTML'],
  ['.rs', 'Rust'],
  ['.sql', 'SQL'],
  ['.php', 'PHP'],
  ['.txt', 'Text'],
  ['.m', 'Objective-C'],
  ['.v', 'Verilog'],
  ['.cfg', 'Config'],
  ['.pro', 'Prolog'],
  ['.cls', 'TeX'],
  ['.f', 'Fortran'],
  // High-priority: very common extensions with ambiguous linguist mappings
  ['.h', 'C'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'TSX'],
  ['.json', 'JSON'],
  ['.cs', 'C#'],
  // Medium-priority: reasonably common languages
  ['.pl', 'Perl'],
  ['.r', 'R'],
  ['.ex', 'Elixir'],
  ['.ml', 'OCaml'],
  ['.sc', 'Scala'],
  ['.d', 'D'],
  ['.sol', 'Solidity'],
  ['.gd', 'GDScript'],
  ['.typ', 'Typst'],
  ['.lean', 'Lean 4'],
  ['.nu', 'Nushell'],
  ['.hh', 'C++'],
  ['.re', 'Reason'],
]);

// Build lookup maps at module load time
const byExtension = new Map<string, LangInfo>();
const byFilename = new Map<string, LangInfo>();
// Maps linguist language names to their group parent (e.g. 'Maven POM' → 'XML')
export const groupMap = new Map<string, string>();

for (const [langName, lang] of Object.entries(languages)) {
  const color = lang.color ?? '#8b8b8b';
  const info: LangInfo = { name: langName, color };

  if (lang.extensions) {
    for (const ext of lang.extensions) {
      // ext is like ".ts" — normalize to lowercase
      const key = ext.toLowerCase();
      if (!byExtension.has(key) || PREFERRED.get(key) === langName) {
        byExtension.set(key, info);
      }
    }
  }

  if (lang.group) { groupMap.set(langName, lang.group); }

  if (lang.filenames) {
    for (const fn of lang.filenames) {
      const key = fn.toLowerCase();
      if (!byFilename.has(key)) {
        byFilename.set(key, info);
      }
    }
  }
}

export function getLangInfo(filename: string): LangInfo {
  const lower = filename.toLowerCase();

  // Try exact filename first (Makefile, Dockerfile, etc.)
  const byName = byFilename.get(lower);
  if (byName) {
    return byName;
  }

  // Try extension
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lower.slice(dotIdx); // includes the dot
    const byExt = byExtension.get(ext);
    if (byExt) {
      return byExt;
    }
  }

  return OTHER;
}
