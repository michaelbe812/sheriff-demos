/**
 * Route files (app.routes.ts, <slice>/shell routes) edited via the TypeScript AST:
 * find lazy routes (`loadChildren`/`loadComponent: () => import('<alias>')`), add one, remove some.
 * Edits are text splices at AST positions; formatFiles (prettier) normalizes the layout afterwards.
 */
import type { Tree } from '@nx/devkit';
import * as ts from 'typescript';
import { ALIAS_PREFIX, LIBS_DIR } from '../../plugin/lib-conventions';

export interface LazyRoute {
  /** the route object literal `{ path: …, loadChildren: … }` */
  node: ts.ObjectLiteralExpression;
  /** import specifier of the dynamic import, e.g. `@blueprint/booking/shell` */
  specifier: string;
  /** value of `path`, if it is a string literal */
  path?: string;
  pathNode?: ts.StringLiteralLike;
}

const LAZY_PROPERTIES = ['loadChildren', 'loadComponent'];

const parse = (fileName: string, content: string): ts.SourceFile =>
  ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const propertyNamed = (object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined =>
  object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );

function dynamicImportSpecifier(node: ts.Node): string | undefined {
  let specifier: string | undefined;
  const visit = (child: ts.Node): void => {
    if (specifier) return;
    if (
      ts.isCallExpression(child) &&
      child.expression.kind === ts.SyntaxKind.ImportKeyword &&
      child.arguments[0] &&
      ts.isStringLiteralLike(child.arguments[0])
    ) {
      specifier = child.arguments[0].text;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return specifier;
}

function toLazyRoute(object: ts.ObjectLiteralExpression): LazyRoute | undefined {
  const lazy = LAZY_PROPERTIES.map((name) => propertyNamed(object, name)).find(Boolean);
  const specifier = lazy && dynamicImportSpecifier(lazy.initializer);
  if (!specifier) return undefined;
  const pathProperty = propertyNamed(object, 'path');
  const pathNode = pathProperty && ts.isStringLiteralLike(pathProperty.initializer) ? pathProperty.initializer : undefined;
  return { node: object, specifier, path: pathNode?.text, pathNode };
}

function collect<T extends ts.Node>(source: ts.SourceFile, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (guard(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function findLazyRoutes(content: string, fileName = 'routes.ts'): LazyRoute[] {
  return collect(parse(fileName, content), ts.isObjectLiteralExpression)
    .map(toLazyRoute)
    .filter((route): route is LazyRoute => Boolean(route));
}

/**
 * Array the new route goes into: where the other lazy routes live, else the first `children`
 * array, else the initializer of the first exported routes const.
 */
function findTargetArray(source: ts.SourceFile): ts.ArrayLiteralExpression | undefined {
  const lazyParent = collect(source, ts.isObjectLiteralExpression)
    .filter((object) => toLazyRoute(object))
    .map((object) => object.parent)
    .find(ts.isArrayLiteralExpression);
  if (lazyParent) return lazyParent;
  const children = collect(source, ts.isObjectLiteralExpression)
    .map((object) => propertyNamed(object, 'children')?.initializer)
    .find((initializer): initializer is ts.ArrayLiteralExpression => Boolean(initializer && ts.isArrayLiteralExpression(initializer)));
  if (children) return children;
  return collect(source, ts.isVariableDeclaration)
    .map((declaration) => declaration.initializer)
    .find((initializer): initializer is ts.ArrayLiteralExpression => Boolean(initializer && ts.isArrayLiteralExpression(initializer)));
}

/** `{ path: '', redirectTo: … }` stays last — new routes go before it. */
const isRedirectFallback = (element: ts.Expression): boolean =>
  ts.isObjectLiteralExpression(element) && Boolean(propertyNamed(element, 'redirectTo'));

/** Whitespace in front of the element starting at `position` on its line. */
function indentAt(content: string, position: number): string {
  const lineStart = content.lastIndexOf('\n', position - 1) + 1;
  return /^[ \t]*/.exec(content.slice(lineStart, position))?.[0] ?? '';
}

const indentLines = (source: string, indent: string): string => source.replaceAll('\n', `\n${indent}`);

/**
 * Inserts `routeSource` (an object literal) into the routes array. Returns the new content.
 * The inserted text is exactly what removeRoutes() takes out again (remove after add = no diff).
 */
export function insertRoute(content: string, routeSource: string, fileName = 'routes.ts'): string {
  const source = parse(fileName, content);
  const array = findTargetArray(source);
  if (!array) throw new Error(`${fileName}: no routes array found`);
  const elements = array.elements;
  const fallback = elements.find(isRedirectFallback);
  if (fallback) {
    const indent = indentAt(content, fallback.getStart(source));
    const at = fallback.getFullStart();
    return `${content.slice(0, at)}\n${indent}${indentLines(routeSource, indent)},${content.slice(at)}`;
  }
  if (elements.length === 0) {
    const at = array.getEnd() - 1;
    return `${content.slice(0, at)}${routeSource}${content.slice(at)}`;
  }
  const last = elements[elements.length - 1];
  const indent = indentAt(content, last.getStart(source));
  const route = `\n${indent}${indentLines(routeSource, indent)}`;
  if (!elements.hasTrailingComma) return `${content.slice(0, last.getEnd())},${route}${content.slice(last.getEnd())}`;
  // the trailing comma after the last element stays in place, the new route gets its own
  const afterComma = content.indexOf(',', last.getEnd()) + 1;
  return `${content.slice(0, afterComma)}${route},${content.slice(afterComma)}`;
}

/** Removes every lazy route whose import specifier matches. Returns the new content and what was removed. */
export function removeRoutes(
  content: string,
  matches: (specifier: string) => boolean,
  fileName = 'routes.ts',
): { content: string; removed: LazyRoute[] } {
  const source = parse(fileName, content);
  const removed = collect(source, ts.isObjectLiteralExpression)
    .map(toLazyRoute)
    .filter((route): route is LazyRoute => Boolean(route && matches(route.specifier)));
  const ranges = removed.map(({ node }) => elementRange(node, source)).sort((a, b) => b[0] - a[0]);
  let result = content;
  for (const [start, end] of ranges) result = result.slice(0, start) + result.slice(end);
  return { content: result, removed };
}

/** Text range of an array element including its separating comma. */
function elementRange(node: ts.ObjectLiteralExpression, source: ts.SourceFile): [number, number] {
  const array = node.parent;
  if (!ts.isArrayLiteralExpression(array)) return [node.getFullStart(), node.getEnd()];
  const elements = array.elements;
  const index = elements.indexOf(node);
  if (index < elements.length - 1) return [node.getFullStart(), elements[index + 1].getFullStart()];
  if (index > 0) return [elements[index - 1].getEnd(), node.getEnd()];
  // the only element: empty the array (also drops a trailing comma)
  return [array.getStart(source) + 1, array.getEnd() - 1];
}

/** Replaces the `path` of the lazy route importing `specifier` (`from` → `to`). */
export function renameRoutePath(content: string, specifier: string, from: string, to: string, fileName = 'routes.ts'): string {
  const route = findLazyRoutes(content, fileName).find((candidate) => candidate.specifier === specifier && candidate.path === from);
  if (!route?.pathNode) return content;
  const start = route.pathNode.getStart() + 1;
  return content.slice(0, start) + to + content.slice(start + from.length);
}

/** Exported `Routes`/`Route[]` constant of a lib's sources, e.g. `bookingRoutes` in libs/booking/shell. */
export function findExportedRoutes(tree: Tree, libPath: string): { file: string; name: string } | undefined {
  const srcDir = `${LIBS_DIR}/${libPath}/src`;
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const child of tree.children(dir)) {
      const path = `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) files.push(path);
      } else visit(path);
    }
  };
  if (tree.exists(srcDir)) visit(srcDir);
  for (const file of files.sort()) {
    const match = /export const (\w+)\s*:\s*(Routes|Route\[\])\s*=/.exec(tree.read(file, 'utf-8') ?? '');
    if (match) return { file, name: match[1] };
  }
  return undefined;
}

/** Lib path below libs/ for a `@blueprint/…` specifier, undefined for anything else. */
export const libPathOfSpecifier = (specifier: string): string | undefined =>
  specifier.startsWith(ALIAS_PREFIX) ? specifier.slice(ALIAS_PREFIX.length) : undefined;

/** Source of a lazy route. `loadChildren` for slice routes, `loadComponent` for a feat container. */
export function lazyRouteSource(options: { path: string; specifier: string; exportName: string; kind: 'children' | 'component' }): string {
  const property = options.kind === 'children' ? 'loadChildren' : 'loadComponent';
  return `{
  path: '${options.path}',
  ${property}: () => import('${options.specifier}').then((m) => m.${options.exportName}),
}`;
}

/** Edits a file in the tree with a content → content function; no-op if the file is missing. */
export function updateFile(tree: Tree, file: string, update: (content: string) => string): boolean {
  if (!tree.exists(file)) return false;
  const before = tree.read(file, 'utf-8') ?? '';
  const after = update(before);
  if (after === before) return false;
  tree.write(file, after);
  return true;
}
