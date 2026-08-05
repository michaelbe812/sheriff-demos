import { detectPackageManager, PackageManager, Tree } from '@nx/devkit';

/**
 * Derives the package manager of the *target repo* from the generator `Tree`
 * rather than from the process that happens to run the generator, so that
 * `nx g ...:init` installs with the manager the repo is actually set up for.
 */

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

/** Where the answer came from — reported so the user can correct a wrong guess. */
export type PackageManagerSource =
  | 'option'
  | 'nx.json'
  | 'package.json'
  | 'lockfile'
  | 'fallback';

export interface DetectedPackageManager {
  name: PackageManager;
  source: PackageManagerSource;
  /** Human-readable justification, e.g. `pnpm-lock.yaml`. */
  detail: string;
}

/** Lockfiles in the order nx itself probes them. */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
];

function isPackageManager(value: unknown): value is PackageManager {
  return (
    typeof value === 'string' &&
    (PACKAGE_MANAGERS as readonly string[]).includes(value)
  );
}

function readJsonSafe(tree: Tree, path: string): Record<string, unknown> {
  if (!tree.exists(path)) return {};
  try {
    return JSON.parse(tree.read(path, 'utf-8') ?? '{}');
  } catch {
    return {};
  }
}

/** `"pnpm@10.4.1+sha512..."` -> `"pnpm"`; anything unknown -> undefined. */
function packageManagerFromField(value: unknown): PackageManager | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().split('@')[0];
  return isPackageManager(name) ? name : undefined;
}

/**
 * Resolution order: explicit flag, `nx.json` `cli.packageManager` (what nx
 * itself honours first), the corepack `packageManager` field, a lockfile in the
 * tree, and finally nx's own filesystem-based detection.
 */
export function detectWorkspacePackageManager(
  tree: Tree,
  override?: string,
): DetectedPackageManager {
  if (override) {
    if (!isPackageManager(override)) {
      throw new Error(
        `Unknown package manager "${override}". Valid: ${PACKAGE_MANAGERS.join(', ')}.`,
      );
    }
    return { name: override, source: 'option', detail: '--packageManager' };
  }

  const nxJson = readJsonSafe(tree, 'nx.json');
  const cli = nxJson['cli'] as { packageManager?: unknown } | undefined;
  if (isPackageManager(cli?.packageManager)) {
    return {
      name: cli.packageManager,
      source: 'nx.json',
      detail: 'nx.json cli.packageManager',
    };
  }

  const fromField = packageManagerFromField(
    readJsonSafe(tree, 'package.json')['packageManager'],
  );
  if (fromField) {
    return {
      name: fromField,
      source: 'package.json',
      detail: 'package.json packageManager field',
    };
  }

  const lockfile = LOCKFILES.find(([file]) => tree.exists(file));
  if (lockfile) {
    return { name: lockfile[1], source: 'lockfile', detail: lockfile[0] };
  }

  let fallback: PackageManager = 'npm';
  try {
    fallback = detectPackageManager(tree.root);
  } catch {
    // no workspace on disk (e.g. a virtual tree in tests) — npm it is.
  }
  return {
    name: isPackageManager(fallback) ? fallback : 'npm',
    source: 'fallback',
    detail: 'no lockfile or config found',
  };
}

/** `pnpm install` / `npm install` / ... — the command that materialises deps. */
export function installCommand(pm: PackageManager): string {
  return pm === 'npm' ? 'npm install' : `${pm} install`;
}

/** How a user runs an npm script, e.g. `pnpm sheriff:verify`. */
export function runScriptCommand(pm: PackageManager, script: string): string {
  return pm === 'npm' || pm === 'bun'
    ? `${pm} run ${script}`
    : `${pm} ${script}`;
}

/** How a user invokes a locally installed binary, e.g. `pnpm exec eslint .`. */
export function execCommand(pm: PackageManager): string {
  const commands: Record<PackageManager, string> = {
    npm: 'npx',
    pnpm: 'pnpm exec',
    yarn: 'yarn',
    bun: 'bunx',
  };
  return commands[pm];
}

/**
 * The lockfile-respecting install for CI. Yarn Berry renamed the flag, and the
 * `.yarnrc.yml` in the tree is the marker for it.
 */
export function ciInstallCommand(pm: PackageManager, tree?: Tree): string {
  switch (pm) {
    case 'npm':
      return 'npm ci';
    case 'yarn':
      return tree?.exists('.yarnrc.yml')
        ? 'yarn install --immutable'
        : 'yarn install --frozen-lockfile';
    default:
      return `${pm} install --frozen-lockfile`;
  }
}
