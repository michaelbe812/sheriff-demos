import { formatFiles, logger, names, Tree, updateJson } from '@nx/devkit';
import { detectPreset } from '../detect-preset';
import { HexPreset, writeHexSlice } from './scaffold';

export interface HexagonGeneratorSchema {
  name: string;
  /** App name: scaffold under apps/<app>/src/app/domains. Omit for a lib. */
  app?: string;
  /** Override the detected preset. */
  preset?: HexPreset;
  aliasPrefix?: string;
}

export default async function hexagonGenerator(
  tree: Tree,
  options: HexagonGeneratorSchema,
): Promise<void> {
  const detected = detectPreset(tree, options.preset);
  if (detected !== 'hexagonal-fwcore' && detected !== 'hexagonal-strict') {
    throw new Error(
      `The 'hexagon' generator scaffolds hexagonal slices, but the active preset is '${detected}'. Use the 'domain' generator instead.`,
    );
  }
  const preset: HexPreset = detected;

  const { fileName } = names(options.name);
  const aliasPrefix = options.aliasPrefix ?? '@blueprint';

  const root = options.app
    ? `apps/${options.app}/src/app/domains/${fileName}`
    : `libs/domains/${fileName}/src`;

  writeHexSlice(tree, root, fileName, preset);

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
    if (tree.exists('tsconfig.base.json')) {
      updateJson(tree, 'tsconfig.base.json', (json) => {
        json.compilerOptions ??= {};
        json.compilerOptions.paths ??= {};
        json.compilerOptions.paths[`${aliasPrefix}/domains/${fileName}/*`] = [
          `./libs/domains/${fileName}/src/*`,
        ];
        return json;
      });
    }
  }

  logger.info(
    options.app
      ? `arc-presets: hexagon slice '${fileName}' scaffolded (${preset}). Register it in sheriff.config.ts: apps: { '${options.app}': ['${fileName}'] }.`
      : `arc-presets: hexagon lib '${fileName}' scaffolded (${preset}). Register it in sheriff.config.ts: libDomains: ['${fileName}'] (and add an entryPoint for CI cross-checks).`,
  );
  await formatFiles(tree);
}
