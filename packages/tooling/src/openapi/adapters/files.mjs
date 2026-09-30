import { readdirSync } from 'node:fs';

/** All .ts files below dir, relative + posix, sorted (deterministic). */
export function listTsFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map((file) => String(file).split('\\').join('/'))
    .filter((file) => file.endsWith('.ts'))
    .sort();
}
