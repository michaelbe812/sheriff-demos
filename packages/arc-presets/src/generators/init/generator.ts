import {
  addDependenciesToPackageJson,
  formatFiles,
  GeneratorCallback,
  installPackagesTask,
  logger,
  Tree,
  updateJson,
} from '@nx/devkit';
import { PresetId, PRESETS } from '../../presets';
import { configTemplate } from '../../presets/templates';
import { PRESET_MARKER } from '../detect-preset';
import { wireEslint } from '../eslint';
import {
  detectWorkspacePackageManager,
  installCommand,
  runScriptCommand,
} from '../package-manager';
import {
  FORK_CORE,
  FORK_ESLINT,
  FORK_VERSION,
  TS_ESLINT_UTILS,
  TS_ESLINT_UTILS_VERSION,
  UPSTREAM_CORE,
  UPSTREAM_ESLINT,
  UPSTREAM_VERSION,
} from '../versions';
import { ciWorkflow } from './ci';

export interface InitGeneratorSchema {
  preset: PresetId;
  app?: string;
  installFork?: boolean;
  skipEslint?: boolean;
  ci?: boolean;
  aliasPrefix?: string;
  /** Override the derived package manager instead of deriving it from the repo. */
  packageManager?: string;
  /** Write the dev dependencies, but do not run the install. */
  skipInstall?: boolean;
}

export default async function initGenerator(
  tree: Tree,
  options: InitGeneratorSchema,
): Promise<GeneratorCallback> {
  const preset = PRESETS[options.preset];
  if (!preset) {
    throw new Error(
      `Unknown preset "${options.preset}". Valid: ${Object.keys(PRESETS).join(', ')}.`,
    );
  }

  const installFork = options.installFork ?? true;
  const aliasPrefix = options.aliasPrefix ?? '@blueprint';

  // strict hexagonal needs denyRules -> the fork is mandatory.
  if (preset.requiresFork && !installFork) {
    throw new Error(
      `Preset "${preset.id}" requires the @lambda-solutions Sheriff fork (denyRules). Re-run without --installFork=false.`,
    );
  }

  const useFork = installFork;

  // 0. the target repo's package manager — drives the install and every hint
  const packageManager = detectWorkspacePackageManager(
    tree,
    options.packageManager,
  );
  logger.info(
    `arc-presets: package manager: ${packageManager.name} (${packageManager.detail})`,
  );

  // 1. sheriff.config.ts (do not clobber an existing one)
  if (tree.exists('sheriff.config.ts')) {
    logger.warn(
      'arc-presets: sheriff.config.ts already exists — left unchanged. Delete it and re-run to regenerate.',
    );
  } else {
    const body = configTemplate(preset.id, { app: options.app, useFork });
    tree.write('sheriff.config.ts', `${PRESET_MARKER(preset.id)}\n${body}`);
  }

  // 2. dependencies (fork or upstream) + the preset package itself
  const core = useFork ? FORK_CORE : UPSTREAM_CORE;
  const eslintPlugin = useFork ? FORK_ESLINT : UPSTREAM_ESLINT;
  const coreVersion = useFork ? FORK_VERSION : UPSTREAM_VERSION;

  const devDeps: Record<string, string> = {
    [core]: coreVersion,
    [eslintPlugin]: coreVersion,
    [TS_ESLINT_UTILS]: TS_ESLINT_UTILS_VERSION,
    '@lambda-solutions/arc-presets': '^0.1.0',
  };
  addDependenciesToPackageJson(tree, {}, devDeps);

  // 3. eslint wiring
  if (!options.skipEslint) {
    wireEslint(tree, eslintPlugin, aliasPrefix);
  } else {
    logger.info('arc-presets: skipped eslint wiring (--skipEslint).');
  }

  // 4. verify npm script
  updateJson(tree, 'package.json', (json) => {
    json.scripts ??= {};
    if (!json.scripts['sheriff:verify']) {
      json.scripts['sheriff:verify'] = 'sheriff verify';
    }
    return json;
  });

  // 5. optional CI workflow
  if (options.ci) {
    tree.write(
      '.github/workflows/sheriff.yml',
      ciWorkflow(packageManager.name, tree),
    );
    logger.info(
      `arc-presets: added .github/workflows/sheriff.yml (${packageManager.name})`,
    );
  }

  await formatFiles(tree);

  const install = installCommand(packageManager.name);
  const verify = runScriptCommand(packageManager.name, 'sheriff:verify');

  logger.info(
    [
      '',
      `arc-presets: '${preset.id}' preset scaffolded.`,
      `  - sheriff.config.ts written (${useFork ? 'fork' : 'upstream'} engine)`,
      options.skipInstall
        ? `  - dev dependencies added; run \`${install}\` (--skipInstall was set)`
        : `  - dev dependencies added and installed via ${packageManager.name}`,
      `  - run: ${verify}`,
      preset.sliceKind === 'vertical'
        ? `  - scaffold slices: nx g @lambda-solutions/arc-presets:domain <name> [--app <app>]`
        : `  - scaffold slices: nx g @lambda-solutions/arc-presets:hexagon <name> [--app <app>]`,
      `  - add shared features to sharedFeatures / apps in sheriff.config.ts`,
      '',
    ].join('\n'),
  );

  if (options.skipInstall) {
    return () => {
      // deps are written to package.json; the user installs them.
    };
  }

  return () => installPackagesTask(tree, false, '', packageManager.name);
}
