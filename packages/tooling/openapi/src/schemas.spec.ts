import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(__dirname, '..');

const readJson = (path: string) => JSON.parse(readFileSync(join(PACKAGE_ROOT, path), 'utf8'));

const generators: Record<string, { schema: string }> = readJson('generators.json').generators;

/** Nx drops unknown options silently unless the schema forbids them: every generator is strict. */
describe('generator schemas', () => {
  it.each(Object.entries(generators))(
    '%s: unknown options are rejected (additionalProperties: false)',
    (_, { schema }) => {
      expect(readJson(schema).additionalProperties).toBe(false);
    },
  );
});
