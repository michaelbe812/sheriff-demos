import { PackageManager, Tree } from '@nx/devkit';
import {
  ciInstallCommand,
  execCommand,
  runScriptCommand,
} from '../package-manager';

/** Extra setup step + `actions/setup-node` cache key per package manager. */
const SETUP: Record<PackageManager, { steps: string[]; cache?: string }> = {
  npm: { steps: [], cache: 'npm' },
  pnpm: { steps: ['      - uses: pnpm/action-setup@v4'], cache: 'pnpm' },
  yarn: { steps: [], cache: 'yarn' },
  bun: { steps: ['      - uses: oven-sh/setup-bun@v2'] },
};

/**
 * GitHub Actions workflow content that runs sheriff verify + eslint with the
 * package manager the target repo uses.
 */
export function ciWorkflow(pm: PackageManager = 'pnpm', tree?: Tree): string {
  const setup = SETUP[pm];
  const nodeStep = [
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 20',
    ...(setup.cache ? [`          cache: ${setup.cache}`] : []),
  ];

  return `name: sheriff

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${[...setup.steps, ...nodeStep].join('\n')}
      - run: ${ciInstallCommand(pm, tree)}
      - run: ${runScriptCommand(pm, 'sheriff:verify')}
      - run: ${execCommand(pm)} eslint .
`;
}
