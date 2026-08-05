import { logger, Tree } from '@nx/devkit';

/**
 * Patches an existing flat-config eslint file to wire in Sheriff, or prints a
 * copy-paste snippet when a safe automatic patch is not possible.
 */

const ESLINT_CANDIDATES = [
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.ts',
];

export function eslintSnippet(
  eslintPluginPkg: string,
  aliasPrefix: string,
): string {
  return `import sheriff from '${eslintPluginPkg}';
import { nxModuleBoundariesOptions } from '@lambda-solutions/arc-presets';

export default [
  // ...your existing configs
  sheriff.configs.all,
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', nxModuleBoundariesOptions('${aliasPrefix}')],
    },
  },
];`;
}

/** Returns true when the file was patched; false when only a snippet was logged. */
export function wireEslint(
  tree: Tree,
  eslintPluginPkg: string,
  aliasPrefix: string,
): boolean {
  const path = ESLINT_CANDIDATES.find((c) => tree.exists(c));

  if (!path) {
    tree.write('eslint.config.mjs', eslintSnippet(eslintPluginPkg, aliasPrefix) + '\n');
    logger.info('arc-presets: created eslint.config.mjs with the Sheriff config.');
    return true;
  }

  const content = tree.read(path, 'utf-8') ?? '';
  if (content.includes('sheriff.configs.all')) {
    logger.info(`arc-presets: ${path} already wires Sheriff — left unchanged.`);
    return true;
  }

  // Only auto-patch the simple, safe case: a flat-config default-export array.
  const importLine = `import sheriff from '${eslintPluginPkg}';\n`;
  const arrayEntry = `  sheriff.configs.all,\n`;
  const exportMatch = /export default \[\s*\n/.exec(content);

  if (exportMatch && !content.includes(eslintPluginPkg)) {
    const withImport = importLine + content;
    const patched = withImport.replace(
      /export default \[\s*\n/,
      (m) => m + arrayEntry,
    );
    tree.write(path, patched);
    logger.info(
      `arc-presets: added sheriff.configs.all to ${path}. Review the @nx/enforce-module-boundaries rule (snippet below) if you use it.`,
    );
    logger.info('\n' + eslintSnippet(eslintPluginPkg, aliasPrefix));
    return true;
  }

  logger.warn(
    `arc-presets: could not safely patch ${path} automatically. Add this yourself:\n\n${eslintSnippet(eslintPluginPkg, aliasPrefix)}\n`,
  );
  return false;
}
