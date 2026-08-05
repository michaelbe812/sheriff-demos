import { installPackagesTask, Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import initGenerator from '../src/generators/init/generator';
import { ciWorkflow } from '../src/generators/init/ci';
import {
  ciInstallCommand,
  detectWorkspacePackageManager,
  execCommand,
  installCommand,
  runScriptCommand,
} from '../src/generators/package-manager';

vi.mock('@nx/devkit', async () => {
  const actual =
    await vi.importActual<typeof import('@nx/devkit')>('@nx/devkit');
  return { ...actual, installPackagesTask: vi.fn() };
});

const writeJson = (tree: Tree, path: string, value: unknown): void =>
  tree.write(path, JSON.stringify(value, null, 2));

const patchPackageJson = (tree: Tree, patch: Record<string, unknown>): void => {
  const pkg = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
  writeJson(tree, 'package.json', { ...pkg, ...patch });
};

describe('detectWorkspacePackageManager', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ] as const)('derives %s -> %s', (lockfile, expected) => {
    tree.write(lockfile, '');

    const detected = detectWorkspacePackageManager(tree);

    expect(detected.name).toBe(expected);
    expect(detected.source).toBe('lockfile');
    expect(detected.detail).toBe(lockfile);
  });

  it('prefers the corepack packageManager field over a lockfile', () => {
    tree.write('package-lock.json', '');
    patchPackageJson(tree, { packageManager: 'yarn@4.5.0+sha512.abc' });

    const detected = detectWorkspacePackageManager(tree);

    expect(detected.name).toBe('yarn');
    expect(detected.source).toBe('package.json');
  });

  it('prefers nx.json cli.packageManager over everything derived', () => {
    tree.write('pnpm-lock.yaml', '');
    patchPackageJson(tree, { packageManager: 'yarn@4.5.0' });
    const nxJson = JSON.parse(tree.read('nx.json', 'utf-8') ?? '{}');
    writeJson(tree, 'nx.json', { ...nxJson, cli: { packageManager: 'bun' } });

    const detected = detectWorkspacePackageManager(tree);

    expect(detected.name).toBe('bun');
    expect(detected.source).toBe('nx.json');
  });

  it('lets an explicit override win', () => {
    tree.write('pnpm-lock.yaml', '');

    const detected = detectWorkspacePackageManager(tree, 'npm');

    expect(detected.name).toBe('npm');
    expect(detected.source).toBe('option');
  });

  it('rejects an unknown override', () => {
    expect(() => detectWorkspacePackageManager(tree, 'cargo')).toThrow(
      /Unknown package manager "cargo"/,
    );
  });

  it('ignores an unparsable package.json and an unknown packageManager field', () => {
    tree.write('package.json', '{ not json');
    tree.write('yarn.lock', '');

    expect(detectWorkspacePackageManager(tree).name).toBe('yarn');

    tree.write('package.json', JSON.stringify({ packageManager: 'deno@2' }));
    expect(detectWorkspacePackageManager(tree).name).toBe('yarn');
  });

  it('falls back to a known package manager without any signal', () => {
    const detected = detectWorkspacePackageManager(tree);

    expect(detected.source).toBe('fallback');
    expect(['npm', 'pnpm', 'yarn', 'bun']).toContain(detected.name);
  });
});

describe('package manager commands', () => {
  it.each([
    ['npm', 'npm install', 'npm run sheriff:verify', 'npx', 'npm ci'],
    [
      'pnpm',
      'pnpm install',
      'pnpm sheriff:verify',
      'pnpm exec',
      'pnpm install --frozen-lockfile',
    ],
    [
      'yarn',
      'yarn install',
      'yarn sheriff:verify',
      'yarn',
      'yarn install --frozen-lockfile',
    ],
    [
      'bun',
      'bun install',
      'bun run sheriff:verify',
      'bunx',
      'bun install --frozen-lockfile',
    ],
  ] as const)('%s', (pm, install, run, exec, ciInstall) => {
    expect(installCommand(pm)).toBe(install);
    expect(runScriptCommand(pm, 'sheriff:verify')).toBe(run);
    expect(execCommand(pm)).toBe(exec);
    expect(ciInstallCommand(pm)).toBe(ciInstall);
  });

  it('uses --immutable for yarn berry', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('.yarnrc.yml', 'nodeLinker: node-modules\n');

    expect(ciInstallCommand('yarn', tree)).toBe('yarn install --immutable');
  });
});

describe('ci workflow', () => {
  it('uses pnpm setup and commands', () => {
    const workflow = ciWorkflow('pnpm');

    expect(workflow).toContain('pnpm/action-setup@v4');
    expect(workflow).toContain('cache: pnpm');
    expect(workflow).toContain('- run: pnpm install --frozen-lockfile');
    expect(workflow).toContain('- run: pnpm sheriff:verify');
    expect(workflow).toContain('- run: pnpm exec eslint .');
  });

  it('uses npm commands', () => {
    const workflow = ciWorkflow('npm');

    expect(workflow).not.toContain('pnpm');
    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('- run: npm ci');
    expect(workflow).toContain('- run: npm run sheriff:verify');
    expect(workflow).toContain('- run: npx eslint .');
  });

  it('sets bun up without a setup-node cache', () => {
    const workflow = ciWorkflow('bun');

    expect(workflow).toContain('oven-sh/setup-bun@v2');
    expect(workflow).not.toContain('cache:');
    expect(workflow).toContain('- run: bun install --frozen-lockfile');
    expect(workflow).toContain('- run: bunx eslint .');
  });
});

describe('init generator install', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    vi.mocked(installPackagesTask).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs with the package manager derived from the target repo', async () => {
    tree.write('yarn.lock', '');

    const task = await initGenerator(tree, { preset: 'inverted' });
    task();

    expect(installPackagesTask).toHaveBeenCalledWith(tree, false, '', 'yarn');
  });

  it('honours an explicit --packageManager', async () => {
    tree.write('pnpm-lock.yaml', '');

    const task = await initGenerator(tree, {
      preset: 'inverted',
      packageManager: 'npm',
    });
    task();

    expect(installPackagesTask).toHaveBeenCalledWith(tree, false, '', 'npm');
  });

  it('adds the engine as dev dependencies, never as dependencies', async () => {
    tree.write('pnpm-lock.yaml', '');

    await initGenerator(tree, { preset: 'inverted' });

    const pkg = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining([
        '@lambda-solutions/sheriff-core',
        '@lambda-solutions/eslint-plugin-sheriff',
        '@typescript-eslint/utils',
        '@lambda-solutions/arc-presets',
      ]),
    );
    expect(pkg.dependencies ?? {}).not.toHaveProperty(
      '@lambda-solutions/sheriff-core',
    );
  });

  it('writes the deps but skips the install with --skipInstall', async () => {
    tree.write('pnpm-lock.yaml', '');

    const task = await initGenerator(tree, {
      preset: 'inverted',
      skipInstall: true,
    });
    task();

    expect(installPackagesTask).not.toHaveBeenCalled();
    const pkg = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    expect(pkg.devDependencies).toHaveProperty(
      '@lambda-solutions/sheriff-core',
    );
  });

  it('generates the CI workflow for the derived package manager', async () => {
    tree.write('package-lock.json', '');

    await initGenerator(tree, { preset: 'inverted', ci: true });

    const workflow = tree.read('.github/workflows/sheriff.yml', 'utf-8') ?? '';
    expect(workflow).toContain('- run: npm ci');
    expect(workflow).not.toContain('pnpm');
  });
});
