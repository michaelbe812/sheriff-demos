import { createRequire } from 'node:module';

/** Name and version of this package (same relative path from src/ and dist/). */
const packageJson = createRequire(import.meta.url)('../package.json') as { name: string; version: string };

export const TOOL = `${packageJson.name}@${packageJson.version}`;
