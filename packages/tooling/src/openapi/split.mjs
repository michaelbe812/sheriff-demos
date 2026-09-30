/**
 * Splits the classified raw output into the client libs and rewrites imports.
 *
 * - The folder structure of the raw output is kept inside a part
 *   (raw/model/pet.ts → types/src/generated/model/pet.ts), relative imports within a part stay valid.
 * - Relative imports into ANOTHER part → the part's alias (`@blueprint/<path>/types`).
 * - Relative imports of dropped/unknown files → error (otherwise only the typecheck would break).
 *
 * Works on the TypeScript AST (import/export declarations, import() calls, import types) and
 * replaces only the module specifier literals. Deterministic: files sorted, no timestamps.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';

const ts = createRequire(import.meta.url)('typescript');

const CATEGORY_TO_PART = { models: 'types', apis: 'api', core: 'core' };

/** Module specifier literals of a file (statically resolvable ones only). */
function moduleSpecifiers(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.map((literal) => ({ start: literal.getStart(source), end: literal.getEnd(), text: literal.text }));
}

/** Resolves a relative specifier against the known files of the raw output. */
function resolveRelative(fromFile, specifier, knownFiles) {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const withoutJs = base.replace(/\.(m?js)$/, '');
  const candidates = [base, `${withoutJs}.ts`, `${withoutJs}.d.ts`, `${withoutJs}/index.ts`];
  return candidates.find((candidate) => knownFiles.has(candidate));
}

/**
 * @param {{ rawDir: string, classification: import('./contract').Classification,
 *           aliases: Record<import('./contract').Part, string>, allFiles: string[] }} input
 * @returns {Record<import('./contract').Part, { files: { path: string, content: string }[], entries: string[] }>}
 */
export function splitIntoParts({ rawDir, classification, aliases, allFiles }) {
  const partOf = new Map();
  for (const [category, part] of Object.entries(CATEGORY_TO_PART)) {
    for (const file of classification[category] ?? []) {
      if (partOf.has(file)) throw new Error(`${file}: classified in several categories`);
      if (file === 'index.ts') throw new Error(`${file}: root index.ts is reserved (the facade writes the barrel)`);
      partOf.set(file, part);
    }
  }
  const knownFiles = new Set(allFiles);
  const result = {
    types: { files: [], entries: [] },
    api: { files: [], entries: [] },
    core: { files: [], entries: [] },
  };

  for (const file of [...partOf.keys()].sort()) {
    const part = partOf.get(file);
    const text = readFileSync(join(rawDir, file), 'utf-8');
    const replacements = [];
    for (const specifier of moduleSpecifiers(file, text)) {
      if (!specifier.text.startsWith('.')) continue;
      const target = resolveRelative(file, specifier.text, knownFiles);
      const targetPart = target && partOf.get(target);
      if (!targetPart) {
        throw new Error(
          `${file}: Import '${specifier.text}' points to a dropped or unknown file (${target ?? 'not found'})`,
        );
      }
      if (targetPart !== part) replacements.push({ ...specifier, alias: aliases[targetPart] });
    }
    // replace from the back so the offsets stay valid; the quote character is kept
    let content = text;
    for (const { start, end, alias } of replacements.sort((a, b) => b.start - a.start)) {
      const quote = content[start];
      content = `${content.slice(0, start)}${quote}${alias}${quote}${content.slice(end)}`;
    }
    result[part].files.push({ path: file, content });
  }

  for (const part of Object.keys(result)) {
    const files = result[part].files.map((f) => f.path);
    const declared = classification.entries?.[part];
    const entries = declared ?? files;
    const unknown = entries.filter((entry) => !files.includes(entry));
    if (unknown.length) throw new Error(`entries.${part}: ${unknown.join(', ')} not in this part`);
    // order of the adapter's entries is kept (first wins on duplicate names, see barrel.mjs)
    result[part].entries = declared ? [...entries] : [...entries].sort();
  }
  return result;
}
