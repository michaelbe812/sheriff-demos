import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/** One resolved import statement between two analyzed files (repo-relative). */
export interface ImportEdge {
  source: string;
  target: string;
}

function compilerOptions(repo: string, candidates: string[]): ts.CompilerOptions {
  const file = candidates.map((name) => join(repo, name)).find((path) => existsSync(path));
  const fallback: ts.CompilerOptions = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
  if (!file) return fallback;
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) return fallback;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repo, undefined, file);
  const options = { ...parsed.options, allowJs: true };
  // classic/node10 resolution misses `exports` maps and extension-less ESM; bundler resolves both
  const resolution = options.moduleResolution;
  if (resolution === undefined || resolution === ts.ModuleResolutionKind.Classic || resolution === ts.ModuleResolutionKind.Node10) {
    options.moduleResolution = ts.ModuleResolutionKind.Bundler;
    options.module = ts.ModuleKind.ESNext;
  }
  return options;
}

const toPosix = (path: string): string => path.split(sep).join('/');

/**
 * Static imports, re-exports, `require` and dynamic `import()` of every analyzed file, resolved like the
 * compiler does (tsconfig `paths`, `baseUrl`, package `exports`). Imports leaving the analyzed set
 * (node_modules, excluded files) are dropped. Edges are sorted.
 */
export function buildImportGraph(repo: string, files: string[], tsconfigCandidates: string[]): ImportEdge[] {
  const options = compilerOptions(repo, tsconfigCandidates);
  const host: ts.ModuleResolutionHost = ts.sys;
  const cache = ts.createModuleResolutionCache(repo, (name) => name, options);
  const analyzed = new Set(files);
  const edges: ImportEdge[] = [];
  for (const source of files) {
    const absolute = join(repo, source);
    const content = readFileSync(absolute, 'utf-8');
    const { importedFiles } = ts.preProcessFile(content, true, true);
    for (const { fileName: specifier } of importedFiles) {
      const resolved = ts.resolveModuleName(specifier, absolute, options, host, cache).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const target = toPosix(relative(repo, resolved.resolvedFileName));
      if (target !== source && analyzed.has(target)) edges.push({ source, target });
    }
  }
  return edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
}
