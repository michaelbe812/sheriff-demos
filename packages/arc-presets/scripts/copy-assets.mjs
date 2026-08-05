import { cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc does not copy non-TS assets. Generators reference their schema.json from
// dist/, so copy every schema.json under src/ into the matching dist/ path.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(root, 'src');
const distRoot = join(root, 'dist');

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walk(abs);
    } else if (entry === 'schema.json') {
      const rel = abs.slice(srcRoot.length + 1);
      const dest = join(distRoot, rel);
      cpSync(abs, dest);
      console.log(`copied ${rel}`);
    }
  }
}

walk(srcRoot);
