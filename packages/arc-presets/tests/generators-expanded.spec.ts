import { logger, readJson, Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import doctorGenerator from '../src/generators/doctor/generator';
import domainGenerator from '../src/generators/domain/generator';
import { detectPreset, PRESET_MARKER } from '../src/generators/detect-preset';
import featGenerator from '../src/generators/feat/generator';
import initGenerator from '../src/generators/init/generator';
import migrateGenerator from '../src/generators/migrate/generator';
import sharedFeatureGenerator from '../src/generators/shared-feature/generator';
import {
  FORK_CORE,
  FORK_ESLINT,
  UPSTREAM_CORE,
  UPSTREAM_ESLINT,
} from '../src/generators/versions';
import { nxModuleBoundariesOptions } from '../src/presets';
import { configTemplate } from '../src/presets/templates';

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

const doctorOutput = async (tree: Tree): Promise<string> => {
  const messages: string[] = [];
  const info = vi.spyOn(logger, 'info').mockImplementation((message) => {
    messages.push(String(message));
  });
  try {
    await doctorGenerator(tree, {});
  } finally {
    info.mockRestore();
  }
  return messages.join('\n');
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('feat generator', () => {
  it('writes blueprint feat files below an existing domain', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'blueprint', app: 'client' });
    await domainGenerator(tree, { name: 'booking', app: 'client' });

    await featGenerator(tree, {
      name: 'check-in',
      domain: 'booking',
      app: 'client',
    });

    const base = 'apps/client/src/app/domains/booking/feat-check-in';
    expect(tree.exists(`${base}/feat-check-in.ts`)).toBe(true);
    expect(tree.exists(`${base}/api/check-in-api.ts`)).toBe(true);
    expect(tree.exists(`${base}/api/index.ts`)).toBe(false);
    expect(tree.exists(`${base}/data/check-in.store.ts`)).toBe(true);
  });

  it('writes inverted feat files below an existing domain', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'inverted', app: 'client' });
    await domainGenerator(tree, { name: 'booking', app: 'client' });

    await featGenerator(tree, {
      name: 'check-in',
      domain: 'booking',
      app: 'client',
    });

    const base = 'apps/client/src/app/domains/booking/feat-check-in';
    expect(tree.exists(`${base}/feat-check-in.ts`)).toBe(true);
    expect(tree.exists(`${base}/api/index.ts`)).toBe(true);
    expect(tree.exists(`${base}/api/check-in-api.ts`)).toBe(false);
    expect(tree.exists(`${base}/data/check-in.store.ts`)).toBe(true);
  });

  it('rejects when the domain root does not exist', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'inverted', app: 'client' });

    await expect(
      featGenerator(tree, {
        name: 'check-in',
        domain: 'booking',
        app: 'client',
      }),
    ).rejects.toThrow(/Domain "booking" not found/);
  });
});

describe('shared-feature generator', () => {
  it('writes api token, store, providers, and warns about config registration', async () => {
    const tree = createTreeWithEmptyWorkspace();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await sharedFeatureGenerator(tree, { name: 'auth-session', app: 'client' });

    const base = 'apps/client/src/app/auth-session';
    expect(read(tree, `${base}/api/auth-session-api.ts`)).toContain(
      'new InjectionToken<AuthSessionApi>',
    );
    expect(read(tree, `${base}/data/auth-session.store.ts`)).toContain(
      'class AuthSessionStore implements AuthSessionApi',
    );
    expect(read(tree, `${base}/auth-session.providers.ts`)).toContain(
      'provideAuthSession',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("add 'authSession' to sharedFeatures"),
    );
  });
});

describe('doctor generator failures', () => {
  it('reports missing config and wiring in an empty workspace', async () => {
    const tree = createTreeWithEmptyWorkspace();

    const output = await doctorOutput(tree);

    expect(output).toContain('sheriff.config.ts exists');
    expect(output).toContain('sheriff-core installed (none)');
    expect(output).toContain('eslint-plugin-sheriff installed');
    expect(output).toContain('eslint config wires sheriff.configs.all');
    expect(output).toContain('sheriff:verify npm script present');
    expect(output).toContain('5 check(s) need attention');
  });

  it('reports missing deps when config and scripts exist', async () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      'sheriff.config.ts',
      `${PRESET_MARKER('inverted')}\nexport const config = {};`,
    );
    const pkg = readJson(tree, 'package.json');
    pkg.scripts = { 'sheriff:verify': 'sheriff verify' };
    tree.write('package.json', JSON.stringify(pkg, null, 2));
    tree.write(
      'eslint.config.mjs',
      "export default [{ rules: {} }, { name: 'x', extends: ['sheriff.configs.all'] }];",
    );

    const output = await doctorOutput(tree);

    expect(output).toContain('active preset: inverted');
    expect(output).toContain('sheriff-core installed (none)');
    expect(output).toContain('eslint-plugin-sheriff installed');
    expect(output).toContain('2 check(s) need attention');
  });

  it('reports strict preset without the fork', async () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      'sheriff.config.ts',
      `${PRESET_MARKER('hexagonal-strict')}\nexport const config = {};`,
    );
    const pkg = readJson(tree, 'package.json');
    pkg.devDependencies = {
      [UPSTREAM_CORE]: '^0.19.6',
      [UPSTREAM_ESLINT]: '^0.19.6',
    };
    pkg.scripts = { 'sheriff:verify': 'sheriff verify' };
    tree.write('package.json', JSON.stringify(pkg, null, 2));
    tree.write(
      'eslint.config.mjs',
      "import sheriff from '@softarc/eslint-plugin-sheriff';\nexport default [sheriff.configs.all];\n",
    );

    const output = await doctorOutput(tree);

    expect(output).toContain("preset 'hexagonal-strict' requires the fork");
    expect(output).toContain('1 check(s) need attention');
  });
});

describe('migrate generator', () => {
  it('is idempotent after migrating blueprint to inverted', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'blueprint', app: 'client' });

    await migrateGenerator(tree, {});
    const once = read(tree, 'sheriff.config.ts');
    await migrateGenerator(tree, {});
    const twice = read(tree, 'sheriff.config.ts');

    expect(once).toBe(twice);
    expect(twice.match(/arc-presets:preset=inverted/g)).toHaveLength(1);
    expect(twice).toContain("verticalSliceConfig('inverted'");
  });

  it('rejects on a hexagonal preset', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'hexagonal-fwcore', app: 'client' });

    await expect(migrateGenerator(tree, {})).rejects.toThrow(
      /only supports blueprint -> inverted/,
    );
  });
});

describe('detectPreset', () => {
  it('the factory call wins over a conflicting marker (marker may be stale)', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      'sheriff.config.ts',
      `${PRESET_MARKER('blueprint')}\nexport const config = verticalSliceConfig('inverted');`,
    );

    // The factory call is the source of truth; a stale marker must not override it.
    expect(detectPreset(tree)).toBe('inverted');
  });

  it('uses the marker as a fallback when no factory call is present', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      'sheriff.config.ts',
      `${PRESET_MARKER('blueprint')}\nexport const config = {};`,
    );

    expect(detectPreset(tree)).toBe('blueprint');
  });

  it('ignores a marker that is only mentioned inside another comment', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      'sheriff.config.ts',
      `// TODO remove old note: arc-presets:preset=hexagonal-strict\nexport const config = verticalSliceConfig('inverted');`,
    );

    expect(detectPreset(tree)).toBe('inverted');
  });

  it.each([
    ["hexagonalConfig('hexagonal-strict')", 'hexagonal-strict'],
    ['hexagonalConfig("hexagonal-fwcore")', 'hexagonal-fwcore'],
    ["verticalSliceConfig('blueprint')", 'blueprint'],
    ['verticalSliceConfig("inverted")', 'inverted'],
  ] as const)('detects %s from the config body', (body, expected) => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('sheriff.config.ts', `export const config = ${body};`);

    expect(detectPreset(tree)).toBe(expected);
  });

  it('falls back to inverted when no marker or factory call exists', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('sheriff.config.ts', 'export const config = {};');

    expect(detectPreset(tree)).toBe('inverted');
  });
});

describe('configTemplate', () => {
  it.each([
    ['blueprint', 'verticalSliceConfig'],
    ['inverted', 'verticalSliceConfig'],
    ['hexagonal-fwcore', 'hexagonalConfig'],
    ['hexagonal-strict', 'hexagonalConfig'],
  ] as const)('emits the %s factory call', (preset, factory) => {
    const template = configTemplate(preset, {
      app: 'client',
      useFork: preset === 'hexagonal-strict',
    });

    expect(template).toContain(
      `import { ${factory} } from '@lambda-solutions/arc-presets';`,
    );
    expect(template).toContain(`${factory}('${preset}'`);
    expect(template).toContain(
      "entryPoints: { \"client\": 'apps/client/src/main.ts' }",
    );
  });

  it('documents fork requirements only for the strict hexagonal template', () => {
    expect(
      configTemplate('hexagonal-strict', { app: 'client', useFork: true }),
    ).toContain('Requires the @lambda-solutions Sheriff fork');
    expect(
      configTemplate('hexagonal-fwcore', { app: 'client', useFork: false }),
    ).not.toContain('Requires the @lambda-solutions Sheriff fork');
  });

  it('init installs fork or upstream core dependencies to match the option', async () => {
    const forkTree = createTreeWithEmptyWorkspace();
    await initGenerator(forkTree, { preset: 'inverted', installFork: true });
    const forkPkg = readJson(forkTree, 'package.json');
    expect(forkPkg.devDependencies).toHaveProperty(FORK_CORE);
    expect(forkPkg.devDependencies).toHaveProperty(FORK_ESLINT);

    const upstreamTree = createTreeWithEmptyWorkspace();
    await initGenerator(upstreamTree, {
      preset: 'blueprint',
      installFork: false,
    });
    const upstreamPkg = readJson(upstreamTree, 'package.json');
    expect(upstreamPkg.devDependencies).toHaveProperty(UPSTREAM_CORE);
    expect(upstreamPkg.devDependencies).toHaveProperty(UPSTREAM_ESLINT);
    expect(upstreamPkg.devDependencies).not.toHaveProperty(FORK_CORE);
  });
});

describe('nxModuleBoundariesOptions', () => {
  it('returns the expected permissive shape for Sheriff-governed imports', () => {
    expect(nxModuleBoundariesOptions('@demo')).toEqual({
      enforceBuildableLibDependency: true,
      checkDynamicDependenciesExceptions: ['@demo/**'],
      allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
      depConstraints: [
        { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
      ],
    });
  });
});
