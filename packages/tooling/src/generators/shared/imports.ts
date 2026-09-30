import type { Tree } from '@nx/devkit';
import { aliasFor, LIBS_DIR } from '../../plugin/lib-conventions';
import { forEachSourceFile } from './workspace';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `'@blueprint/<path>'` or `'@blueprint/<path>/…'` inside quotes — static imports, `export … from`,
 * dynamic `import()` in routes, `vi.mock()` alike. `@blueprint/booking` never matches `@blueprint/booking-x`.
 */
const aliasPattern = (libPath: string): RegExp => new RegExp(`(['"\`])${escapeRegExp(aliasFor(libPath))}(?=[/'"\`])`, 'g');

/** Rewrites every `@blueprint/<from>…` specifier in apps/ and libs/ to `@blueprint/<to>…`. Returns the changed files. */
export function rewriteAliases(tree: Tree, from: string, to: string): string[] {
  const pattern = aliasPattern(from);
  const changed: string[] = [];
  forEachSourceFile(tree, (file, content) => {
    const updated = content.replace(pattern, `$1${aliasFor(to)}`);
    if (updated !== content) {
      tree.write(file, updated);
      changed.push(file);
    }
  });
  return changed;
}

/** Files in apps/ and libs/ (outside libs/<path>) that still reference `@blueprint/<path>…`. */
export function findReferences(tree: Tree, libPath: string): string[] {
  const pattern = aliasPattern(libPath);
  const ownDir = `${LIBS_DIR}/${libPath}/`;
  const files: string[] = [];
  forEachSourceFile(tree, (file, content) => {
    if (!file.startsWith(ownDir) && pattern.test(content)) files.push(file);
    pattern.lastIndex = 0;
  });
  return files;
}
