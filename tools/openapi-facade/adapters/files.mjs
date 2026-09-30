import { readdirSync } from 'node:fs';

/** Alle .ts-Dateien unter dir, relativ + posix, sortiert (deterministisch). */
export function listTsFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map((file) => String(file).split('\\').join('/'))
    .filter((file) => file.endsWith('.ts'))
    .sort();
}
