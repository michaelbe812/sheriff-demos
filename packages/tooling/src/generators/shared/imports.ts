import type { Tree } from '@nx/devkit';
import * as ts from 'typescript';
import { aliasFor } from '../../plugin/lib-conventions';
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

/**
 * true if the source imports `@blueprint/<libPath>` or anything below it — static, `export … from`
 * or dynamic `import()`. Comments (e.g. `// boundary-violation-example: import …`) do not count.
 */
export function referencesAlias(content: string, libPath: string): boolean {
  const alias = aliasFor(libPath);
  return ts
    .preProcessFile(content, true, true)
    .importedFiles.some(({ fileName }) => fileName === alias || fileName.startsWith(`${alias}/`));
}
