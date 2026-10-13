/**
 * tsc rewrites relative `.ts` imports to `.js` in emitted JS (rewriteRelativeImportExtensions), but not in
 * declarations. Consumers without allowImportingTsExtensions would fail on them: rewrite `./x.ts` → `./x.js`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
for (const file of readdirSync(dist, { recursive: true }).filter((name) => String(name).endsWith('.d.ts'))) {
  const path = join(dist, String(file));
  const content = readFileSync(path, 'utf-8');
  const fixed = content.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3');
  if (fixed !== content) writeFileSync(path, fixed);
}
