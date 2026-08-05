import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PresetId } from '../src/presets';

const e2eEnabled = !!process.env.ARC_PRESETS_E2E;
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const createdWorkspaces: string[] = [];

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const run = (
  cwd: string,
  command: string,
  args: string[],
  expectOk = true,
): Promise<CommandResult> =>
  new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: '1',
        NX_DAEMON: 'false',
      },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectCommand(
        new Error(
          `Command timed out after 240s: ${command} ${args.join(' ')}\ncwd: ${cwd}`,
        ),
      );
    }, 240_000);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      if (expectOk && status !== 0) {
        rejectCommand(
          new Error(
            [
              `Command failed: ${command} ${args.join(' ')}`,
              `cwd: ${cwd}`,
              `exit: ${status}`,
              'stdout:',
              stdout,
              'stderr:',
              stderr,
            ].join('\n'),
          ),
        );
        return;
      }
      resolveCommand({ status, stdout, stderr });
    });
  });

let packedTarball = '';

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
};

const createWorkspace = async (name: string): Promise<string> => {
  const workspace = mkdtempSync(join(tmpdir(), `arc-presets-${name}-`));
  createdWorkspaces.push(workspace);

  writeJson(join(workspace, 'package.json'), {
    name: `arc-presets-${name}`,
    private: true,
    packageManager: 'pnpm@10.0.0',
    scripts: {
      lint: 'eslint .',
    },
    devDependencies: {
      '@angular/core': '~22.0.4',
      '@angular/router': '~22.0.4',
      '@lambda-solutions/arc-presets': `file:${packedTarball}`,
      '@lambda-solutions/eslint-plugin-sheriff': '^1.0.0',
      '@lambda-solutions/sheriff-core': '^1.0.0',
      '@nx/devkit': '23.1.0',
      '@nx/eslint': '23.1.0',
      '@typescript-eslint/utils': '^8.0.0',
      eslint: '^9.8.0',
      nx: '23.1.0',
      rxjs: '~7.8.0',
      tslib: '^2.3.0',
      typescript: '~5.9.0',
    },
    pnpm: {
      overrides: {
        '@lambda-solutions/arc-presets': `file:${packedTarball}`,
      },
    },
  });
  writeJson(join(workspace, 'nx.json'), {
    extends: 'nx/presets/npm.json',
    workspaceLayout: { appsDir: 'apps', libsDir: 'libs' },
  });
  writeJson(join(workspace, 'tsconfig.base.json'), {
    compilerOptions: {
      strict: true,
      target: 'es2022',
      module: 'preserve',
      moduleResolution: 'bundler',
      paths: {},
    },
  });
  writeJson(join(workspace, 'tsconfig.json'), {
    extends: './tsconfig.base.json',
    include: ['apps/**/*.ts', 'libs/**/*.ts', 'sheriff.config.ts'],
  });

  await run(workspace, 'pnpm', ['install', '--ignore-scripts']);
  return workspace;
};

const scaffoldPreset = async (preset: PresetId): Promise<string> => {
  const workspace = await createWorkspace(preset);
  await run(workspace, 'pnpm', [
    'exec',
    'nx',
    'g',
    '@lambda-solutions/arc-presets:init',
    `--preset=${preset}`,
    '--app=client',
    '--installFork=true',
    '--skipEslint=true',
    '--no-interactive',
  ]);

  if (preset === 'blueprint' || preset === 'inverted') {
    await run(workspace, 'pnpm', [
      'exec',
      'nx',
      'g',
      '@lambda-solutions/arc-presets:domain',
      'booking',
      '--app=client',
      '--no-interactive',
    ]);
  } else {
    await run(workspace, 'pnpm', [
      'exec',
      'nx',
      'g',
      '@lambda-solutions/arc-presets:hexagon',
      'booking',
      '--app=client',
      '--no-interactive',
    ]);
    registerHexagon(workspace, 'client', 'booking');
  }

  mkdirSync(join(workspace, 'apps/client/src'), { recursive: true });
  writeJson(join(workspace, 'apps/client/tsconfig.json'), {
    extends: '../../tsconfig.base.json',
    include: ['src/**/*.ts'],
  });
  writeFileSync(join(workspace, 'apps/client/src/main.ts'), 'export {};\n');
  return workspace;
};

const registerHexagon = (
  workspace: string,
  app: string,
  sliceName: string,
): void => {
  const configPath = join(workspace, 'sheriff.config.ts');
  const config = readFileSync(configPath, 'utf-8');
  const updated = config.replace(
    new RegExp(`apps: \\{ ${JSON.stringify(app)}: \\[\\] \\}`),
    `apps: { ${JSON.stringify(app)}: [${JSON.stringify(sliceName)}] }`,
  );
  writeFileSync(configPath, updated);
};

const writeSheriffOnlyEslintConfig = (workspace: string): void => {
  writeFileSync(
    join(workspace, 'eslint.config.mjs'),
    [
      "import sheriff from '@lambda-solutions/eslint-plugin-sheriff';",
      '',
      'export default [sheriff.configs.all];',
      '',
    ].join('\n'),
  );
};

const runEslint = (workspace: string, file: string, expectOk = true) =>
  run(workspace, 'pnpm', ['exec', 'eslint', file], expectOk);

describe.skipIf(!e2eEnabled)('arc-presets real package e2e', () => {
  beforeAll(async () => {
    await run(packageRoot, 'npm', ['run', 'build']);
    const packDir = mkdtempSync(join(tmpdir(), 'arc-presets-pack-'));
    await run(packageRoot, 'pnpm', ['pack', '--pack-destination', packDir]);
    const tarball = readdirSync(packDir).find((entry) => entry.endsWith('.tgz'));
    if (!tarball) {
      throw new Error(`pnpm pack did not produce a tarball in ${packDir}`);
    }
    packedTarball = join(packDir, tarball);
  });

  afterAll(() => {
    if (!process.env.ARC_PRESETS_KEEP_E2E) {
      for (const workspace of createdWorkspaces) {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  });

  it.each([
    'blueprint',
    'inverted',
    'hexagonal-fwcore',
    'hexagonal-strict',
  ] as const)('scaffolds %s and passes sheriff verify', async (preset) => {
    const workspace = await scaffoldPreset(preset);

    const verify = await run(workspace, 'pnpm', ['exec', 'sheriff', 'verify']);

    expect(verify.stdout + verify.stderr).toContain('No issues found');
  });

  it('blocks inverted data -> infra imports and allows data -> api imports through eslint', async () => {
    const workspace = await scaffoldPreset('inverted');
    writeSheriffOnlyEslintConfig(workspace);

    const base = join(workspace, 'apps/client/src/app/domains/booking/data');
    writeFileSync(
      join(base, 'data-to-infra.ts'),
      "import { HttpBookingApi } from '../infra/http-booking-api';\nexport const blocked = HttpBookingApi;\n",
    );
    writeFileSync(
      join(base, 'data-to-api.ts'),
      "import { BookingApi } from '../api';\nexport const allowed = BookingApi;\n",
    );

    const blocked = await runEslint(
      workspace,
      'apps/client/src/app/domains/booking/data/data-to-infra.ts',
      false,
    );
    expect(blocked.status).not.toBe(0);
    expect(blocked.stdout + blocked.stderr).toMatch(
      /type:data has no clearance[\s\S]*type:infra/,
    );

    const allowed = await runEslint(
      workspace,
      'apps/client/src/app/domains/booking/data/data-to-api.ts',
    );
    expect(allowed.status).toBe(0);
  });

  it('blocks hexagonal adapters/driving -> adapters/driven imports through eslint', async () => {
    const workspace = await scaffoldPreset('hexagonal-fwcore');
    writeSheriffOnlyEslintConfig(workspace);

    const driving = join(
      workspace,
      'apps/client/src/app/domains/booking/adapters/driving',
    );
    writeFileSync(
      join(driving, 'driving-to-driven.ts'),
      "import { HttpBookingRepository } from '../driven/http-booking.repository';\nexport const blocked = HttpBookingRepository;\n",
    );

    const blocked = await runEslint(
      workspace,
      'apps/client/src/app/domains/booking/adapters/driving/driving-to-driven.ts',
      false,
    );

    expect(blocked.status).not.toBe(0);
    expect(blocked.stdout + blocked.stderr).toMatch(
      /type:adapter-driving has no clearance[\s\S]*type:adapter-driven/,
    );
  });
});
