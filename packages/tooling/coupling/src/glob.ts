/**
 * Minimal globs (no dependency, deterministic): `**` = any depth, `*` = one segment part,
 * `{slice}` = one segment captured as slice name. Paths are repo-relative with `/`.
 */
const SLICE_PLACEHOLDER = '{slice}';

function toRegExpSource(glob: string): string {
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    if (glob.startsWith(SLICE_PLACEHOLDER, index)) {
      source += '([^/]+)';
      index += SLICE_PLACEHOLDER.length - 1;
    } else if (glob.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (glob[index] === '*') {
      source += '[^/]*';
    } else {
      source += glob[index].replace(/[.+?^$()|[\]\\]/g, '\\$&');
    }
  }
  return source;
}

export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${toRegExpSource(glob)}$`);
}

export function matchesAny(path: string, globs: RegExp[]): boolean {
  return globs.some((glob) => glob.test(path));
}

/** Slice pattern match: slice name and folder prefix (`libs/booking/`) of the path, if it matches. */
export function matchSlicePattern(path: string, pattern: string): { slice: string; folder: string } | undefined {
  const at = pattern.indexOf(SLICE_PLACEHOLDER);
  if (at < 0) throw new Error(`slice pattern "${pattern}" needs a ${SLICE_PLACEHOLDER} segment`);
  // prefix up to and including the slice segment, captured as a whole to get the folder
  const prefix = new RegExp(`^(${toRegExpSource(pattern.slice(0, at + SLICE_PLACEHOLDER.length))})/`);
  const full = globToRegExp(pattern);
  const prefixMatch = prefix.exec(path);
  if (!prefixMatch || !full.test(path)) return undefined;
  return { slice: prefixMatch[2], folder: `${prefixMatch[1]}/` };
}
