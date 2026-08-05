import { logger, readJson, Tree } from '@nx/devkit';
import { detectPreset } from '../detect-preset';
import { isSheriffWired } from '../eslint';
import { PRESETS } from '../../presets';
import {
  detectWorkspacePackageManager,
  runScriptCommand,
} from '../package-manager';
import {
  FORK_CORE,
  FORK_ESLINT,
  UPSTREAM_CORE,
  UPSTREAM_ESLINT,
} from '../versions';

export interface DoctorGeneratorSchema {}

interface Check {
  ok: boolean;
  label: string;
  hint?: string;
}

const ESLINT_CANDIDATES = [
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.ts',
];

/** Read-only health check — reports; never writes. */
export default async function doctorGenerator(
  tree: Tree,
  _options: DoctorGeneratorSchema,
): Promise<void> {
  const checks: Check[] = [];

  const hasConfig = tree.exists('sheriff.config.ts');
  checks.push({
    ok: hasConfig,
    label: 'sheriff.config.ts exists',
    hint: 'run: nx g @lambda-solutions/arc-presets:init',
  });

  const preset = hasConfig ? detectPreset(tree) : undefined;
  if (preset) {
    checks.push({ ok: true, label: `active preset: ${preset}` });
  }

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  } = {};
  try {
    pkg = readJson(tree, 'package.json');
  } catch {
    // no package.json
  }
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  const hasForkCore = FORK_CORE in allDeps;
  const hasUpstreamCore = UPSTREAM_CORE in allDeps;
  checks.push({
    ok: hasForkCore || hasUpstreamCore,
    label: `sheriff-core installed (${hasForkCore ? 'fork' : hasUpstreamCore ? 'upstream' : 'none'})`,
    hint: 'add @lambda-solutions/sheriff-core (or @softarc/sheriff-core)',
  });

  if (preset && PRESETS[preset].requiresFork) {
    checks.push({
      ok: hasForkCore,
      label: `preset '${preset}' requires the fork`,
      hint: 'install @lambda-solutions/sheriff-core@^1',
    });
  }

  const hasEslintPlugin =
    FORK_ESLINT in allDeps || UPSTREAM_ESLINT in allDeps;
  checks.push({
    ok: hasEslintPlugin,
    label: 'eslint-plugin-sheriff installed',
    hint: 'add @lambda-solutions/eslint-plugin-sheriff (or @softarc/...)',
  });

  const eslintPath = ESLINT_CANDIDATES.find((c) => tree.exists(c));
  const eslintWired =
    !!eslintPath && isSheriffWired(tree.read(eslintPath, 'utf-8') ?? '');
  checks.push({
    ok: eslintWired,
    label: 'eslint config wires sheriff.configs.all',
    hint: 'add sheriff.configs.all to your flat config',
  });

  const hasVerifyScript = !!pkg.scripts && 'sheriff:verify' in pkg.scripts;
  checks.push({
    ok: hasVerifyScript,
    label: 'sheriff:verify npm script present',
    hint: 'add "sheriff:verify": "sheriff verify" to package.json scripts',
  });

  const packageManager = detectWorkspacePackageManager(tree);

  logger.info('\narc-presets doctor:');
  for (const c of checks) {
    logger.info(`  ${c.ok ? '✓' : '✗'} ${c.label}`);
    if (!c.ok && c.hint) logger.info(`      → ${c.hint}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  const verify = runScriptCommand(packageManager.name, 'sheriff:verify');
  logger.info(
    failed === 0
      ? `\nAll checks passed. Run \`${verify}\` for the runtime gate.\n`
      : `\n${failed} check(s) need attention.\n`,
  );
}
