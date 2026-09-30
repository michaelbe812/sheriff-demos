/**
 * Barrel src/generated/index.ts einer Teil-Lib aus den Entries.
 *
 * `export *` aus mehreren Entries scheitert an doppelten Namen (TS2308), z.B. hey-api core:
 * client.gen.ts und client/index.ts exportieren beide `CreateClientConfig`. Deshalb: der erste
 * Entry gewinnt; ein späterer Entry mit Konflikt wird explizit (ohne die Duplikate) re-exportiert,
 * Typen per `export type`. Die Export-Namen liefert der TypeScript-Checker auf der Rohausgabe.
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
    const exported = (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).filter((symbol) => symbol.name !== 'default');
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
      lines.push(`// ohne ${duplicates.sort().join(', ')}: schon aus einem früheren Entry exportiert`);
      if (values.length) lines.push(`export { ${values.sort().join(', ')} } from '${specifier}';`);
      if (types.length) lines.push(`export type { ${types.sort().join(', ')} } from '${specifier}';`);
    }
    exported.forEach((symbol) => seen.add(symbol.name));
  });
  return lines.join('\n');
}
