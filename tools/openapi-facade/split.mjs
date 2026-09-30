/**
 * Teilt die klassifizierte Rohausgabe auf die Teil-Libs auf und schreibt Imports um.
 *
 * - Die Ordnerstruktur der Rohausgabe bleibt innerhalb eines Teils erhalten
 *   (raw/model/pet.ts → types/src/generated/model/pet.ts), relative Imports im selben Teil bleiben gültig.
 * - Relative Imports in einen ANDEREN Teil → Alias des Teils (`@blueprint/<pfad>/types`).
 * - Relative Imports auf verworfene/unbekannte Dateien → Fehler (sonst bräche erst der Typecheck).
 *
 * Arbeitet auf dem TypeScript-AST (Import-/Export-Deklarationen, import()-Aufrufe, import-Typen),
 * ersetzt nur die Modul-Specifier-Literale. Deterministisch: Dateien sortiert, keine Zeitstempel.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';

const ts = createRequire(import.meta.url)('typescript');

const CATEGORY_TO_PART = { models: 'types', apis: 'api', core: 'core' };

/** Module-Specifier-Literale einer Datei (nur statisch auflösbare). */
function moduleSpecifiers(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push(node.argument.literal);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      found.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.map((literal) => ({ start: literal.getStart(source), end: literal.getEnd(), text: literal.text }));
}

/** Relativen Specifier gegen die bekannten Dateien der Rohausgabe auflösen. */
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
      if (partOf.has(file)) throw new Error(`${file}: in mehreren Kategorien klassifiziert`);
      if (file === 'index.ts') throw new Error(`${file}: Root-index.ts ist reserviert (Barrel schreibt die Facade)`);
      partOf.set(file, part);
    }
  }
  const knownFiles = new Set(allFiles);
  const result = { types: { files: [], entries: [] }, api: { files: [], entries: [] }, core: { files: [], entries: [] } };

  for (const file of [...partOf.keys()].sort()) {
    const part = partOf.get(file);
    const text = readFileSync(join(rawDir, file), 'utf-8');
    const replacements = [];
    for (const specifier of moduleSpecifiers(file, text)) {
      if (!specifier.text.startsWith('.')) continue;
      const target = resolveRelative(file, specifier.text, knownFiles);
      const targetPart = target && partOf.get(target);
      if (!targetPart) {
        throw new Error(`${file}: Import '${specifier.text}' zeigt auf eine verworfene oder unbekannte Datei (${target ?? 'nicht gefunden'})`);
      }
      if (targetPart !== part) replacements.push({ ...specifier, alias: aliases[targetPart] });
    }
    // von hinten ersetzen, damit die Offsets gültig bleiben; Quote-Zeichen bleibt erhalten
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
    if (unknown.length) throw new Error(`entries.${part}: ${unknown.join(', ')} nicht in diesem Teil`);
    // Reihenfolge der Adapter-Entries bleibt (erster gewinnt bei doppelten Namen, siehe barrel.mjs)
    result[part].entries = declared ? [...entries] : [...entries].sort();
  }
  return result;
}
