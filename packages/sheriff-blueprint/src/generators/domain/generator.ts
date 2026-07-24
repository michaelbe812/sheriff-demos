import { formatFiles, logger, names, Tree, updateJson } from '@nx/devkit';
import { writeFeat, writeSliceBuckets } from '../scaffold';

export interface DomainGeneratorSchema {
  name: string;
  /** App name: scaffold app-internal under apps/<app>/src/app/domains. Omit for a lib. */
  app?: string;
  /** First feat to scaffold inside the domain. */
  feat?: string;
  /** tsconfig alias prefix for libs (default @blueprint). */
  aliasPrefix?: string;
}

export default async function domainGenerator(
  tree: Tree,
  options: DomainGeneratorSchema,
): Promise<void> {
  const { fileName } = names(options.name);
  const aliasPrefix = options.aliasPrefix ?? '@blueprint';

  const root = options.app
    ? `apps/${options.app}/src/app/domains/${fileName}`
    : `libs/domains/${fileName}/src`;

  writeSliceBuckets(tree, root, fileName);
  if (options.feat) {
    writeFeat(tree, root, options.feat);
  }

  if (!options.app) {
    const libRoot = `libs/domains/${fileName}`;
    tree.write(
      `${libRoot}/project.json`,
      JSON.stringify(
        {
          name: `domain-${fileName}`,
          $schema: '../../../node_modules/nx/schemas/project-schema.json',
          projectType: 'library',
          sourceRoot: `${libRoot}/src`,
          tags: [],
          targets: { lint: { executor: '@nx/eslint:lint' } },
        },
        null,
        2,
      ) + '\n',
    );
    tree.write(
      `${libRoot}/tsconfig.json`,
      JSON.stringify(
        {
          extends: '../../../tsconfig.base.json',
          compilerOptions: { strict: true, target: 'es2022', module: 'preserve' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ) + '\n',
    );
    updateJson(tree, 'tsconfig.base.json', (json) => {
      json.compilerOptions ??= {};
      json.compilerOptions.paths ??= {};
      // ONE path per domain. The wildcard also resolves `.../<domain>/api`
      // to api/index.ts (TS finds the folder index), so consumers import
      //   import { XApi } from '@blueprint/domains/<domain>/api';
      // Reaching past the port resolves too, but sheriff blocks it — that is
      // where a violation is supposed to fire, with a rule name attached.
      json.compilerOptions.paths[`${aliasPrefix}/domains/${fileName}/*`] = [
        `./libs/domains/${fileName}/src/*`,
      ];
      return json;
    });
    logger.info(
      `Add an entry point for CI cross-checks: entryPoints: { 'domain-${fileName}': 'libs/domains/${fileName}/src/${fileName}.routes.ts' }`,
    );
  }

  await formatFiles(tree);
}
