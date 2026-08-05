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

/**
 * A COMPLETE, self-contained config we can safely WRITE into a workspace that
 * has none. Sheriff-only: it must not reference the `@nx/enforce-module-
 * boundaries` rule, because a fresh workspace has no `@nx/eslint-plugin`
 * registered and eslint throws on an unknown plugin before any rule runs.
 */
export function newConfigContent(eslintPluginPkg: string): string {
  return `import sheriff from '${eslintPluginPkg}';

export default [
  sheriff.configs.all,
];
`;
}

/**
 * A copy-paste snippet for LOGGING only. Includes the optional Nx boundaries
 * rule with a note — the consumer wires it alongside their existing Nx configs
 * (which register the @nx plugin). Never written verbatim to a fresh workspace.
 */
export function eslintSnippet(
  eslintPluginPkg: string,
  aliasPrefix: string,
): string {
  return `import sheriff from '${eslintPluginPkg}';
// Optional — only if you already register @nx/eslint-plugin elsewhere:
// import { nxModuleBoundariesOptions } from '@lambda-solutions/arc-presets';

export default [
  // ...your existing configs (incl. @nx plugin, if any)
  sheriff.configs.all,
  // {
  //   files: ['**/*.ts'],
  //   rules: {
  //     '@nx/enforce-module-boundaries': ['error', nxModuleBoundariesOptions('${aliasPrefix}')],
  //   },
  // },
];`;
}

/**
 * True if `sheriff.configs.all` appears on a line that is NOT a comment — i.e.
 * it is actually wired, not just mentioned in a TODO. Avoids a false "already
 * wired" on configs like `// add sheriff.configs.all later`.
 */
export function isSheriffWired(content: string): boolean {
  return content.split('\n').some((line) => {
    const code = line.split('//')[0];
    return code.includes('sheriff.configs.all');
  });
}

/** Returns true when the file was patched; false when only a snippet was logged. */
export function wireEslint(
  tree: Tree,
  eslintPluginPkg: string,
  aliasPrefix: string,
): boolean {
  const path = ESLINT_CANDIDATES.find((c) => tree.exists(c));

  if (!path) {
    tree.write('eslint.config.mjs', newConfigContent(eslintPluginPkg));
    logger.info(
      'arc-presets: created eslint.config.mjs (Sheriff only). For the optional @nx boundaries rule, see:',
    );
    logger.info('\n' + eslintSnippet(eslintPluginPkg, aliasPrefix));
    return true;
  }

  const content = tree.read(path, 'utf-8') ?? '';
  if (isSheriffWired(content)) {
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
      `arc-presets: added sheriff.configs.all to ${path}.`,
    );
    return true;
  }

  logger.warn(
    `arc-presets: could not safely patch ${path} automatically. Add this yourself:\n\n${eslintSnippet(eslintPluginPkg, aliasPrefix)}\n`,
  );
  return false;
}
