/**
 * Barrel src/generated/index.ts of a client lib, built from the entries.
 *
 * `export *` from several entries fails on duplicate names (TS2308), e.g. hey-api core:
 * client.gen.ts and client/index.ts both export `CreateClientConfig`. So the first entry wins; a later
 * entry with conflicts is re-exported explicitly (without the duplicates), types via `export type`.
 * The export names come from the TypeScript checker on the raw output.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ts = createRequire(import.meta.url)('typescript');

export function buildBarrel(rawDir, entries) {
  if (!entries.length) return 'export {};';
  const files = entries.map((entry) => join(rawDir, entry));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const seen = new Set();
  const lines = [];
  entries.forEach((entry, index) => {
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(files[index]));
    const exported = (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).filter(
      (symbol) => symbol.name !== 'default',
    );
    const specifier = `./${entry.replace(/\.ts$/, '')}`;
    const duplicates = exported.filter((symbol) => seen.has(symbol.name)).map((symbol) => symbol.name);
    if (!duplicates.length) {
      lines.push(`export * from '${specifier}';`);
    } else {
      const values = [];
      const types = [];
      for (const symbol of exported.filter((s) => !seen.has(s.name))) {
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        (target.flags & ts.SymbolFlags.Value ? values : types).push(symbol.name);
      }
      lines.push(`// without ${duplicates.sort().join(', ')}: already exported by an earlier entry`);
      if (values.length) lines.push(`export { ${values.sort().join(', ')} } from '${specifier}';`);
      if (types.length) lines.push(`export type { ${types.sort().join(', ')} } from '${specifier}';`);
    }
    exported.forEach((symbol) => seen.add(symbol.name));
  });
  return lines.join('\n');
}
