#!/usr/bin/env node
/**
 * Typecheck ONE lib against the shared libs/tsconfig.json — no per-lib tsconfig needed.
 * `tsc -p` cannot narrow `include` from the CLI (and TS 6 rejects file lists
 * next to a tsconfig), so the config is narrowed in memory via the TS API.
 * Same semantics as the former `tsc -p <lib>/tsconfig.json`: the lib's
 * src/**\/*.ts are root files, imported libs are checked through the paths.
 *
 * Usage: node packages/tooling/scripts/typecheck-lib.mjs <projectRoot>
 */
import { existsSync } from 'node:fs';
import { createRequire, enableCompileCache } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

// like bin/tsc: V8 compile cache + plain require (an ESM import of the 9 MB CJS bundle is ~0.3 s slower)
enableCompileCache?.();
const ts = createRequire(import.meta.url)('typescript');

const workspaceRoot = join(import.meta.dirname, '../../..');
const projectRoot = process.argv[2];
if (!projectRoot) throw new Error('usage: typecheck-lib.mjs <projectRoot>');
// escape hatch: a lib that needs other compiler options (e.g. stricter) may still ship its own tsconfig.json
const libConfigPath = resolve(workspaceRoot, projectRoot, 'tsconfig.json');
const configPath = existsSync(libConfigPath) ? libConfigPath : join(workspaceRoot, 'libs/tsconfig.json');

const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
if (error) exitWith([error]);

const configDir = dirname(configPath);
const libSources = relative(configDir, resolve(workspaceRoot, projectRoot, 'src'));
const parsed = ts.parseJsonConfigFileContent(
  { ...config, include: [`${libSources}/**/*.ts`], files: undefined },
  ts.sys,
  configDir,
  undefined,
  configPath,
);
if (parsed.fileNames.length === 0) exitWith([], `no sources below ${projectRoot}/src`);

const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
exitWith([...parsed.errors, ...ts.getPreEmitDiagnostics(program)]);

function exitWith(diagnostics, message) {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => workspaceRoot,
    getNewLine: () => '\n',
  };
  if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  if (message) console.error(message);
  process.exit(diagnostics.length || message ? 1 : 0);
}
