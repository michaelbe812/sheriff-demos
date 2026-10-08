import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Analysis config, read from `coupling.config.json` in the analyzed repo (all fields optional).
 * Same repo + same config + same git range → same report (no clock, no randomness).
 */
export interface CouplingConfig {
  /** `"nx"` = slice from the `scope:` tag of each Nx project; otherwise patterns with `{slice}`. `"auto"` picks nx if tags exist. */
  slices: 'auto' | 'nx' | string[];
  /** Tag prefix that names the slice in nx mode. */
  nxScopeTagPrefix: string;
  /** Slices meant to be shared by everyone (imports into them are expected). */
  shared: string[];
  /** Slices that compose others (app/shell: imports out of them are expected). */
  app: string[];
  /** Slices left out completely (generated code, tooling …). */
  ignore: string[];
  extensions: string[];
  exclude: string[];
  /** tsconfig for path aliases; first existing of the list. */
  tsconfig: string[];
  git: {
    /** Revision range for `git log` (`HEAD`, `v1.0..HEAD`, `<sha>`). Pin a sha for reproducible reports. */
    range: string;
    maxCommits: number | null;
    /** `git log --since` (relative dates depend on today: not reproducible). */
    since: string | null;
    /** Commits touching more analyzed files are noise (renames, sweeps, formatting). */
    maxFilesPerCommit: number;
    /** Commits whose subject contains one of these strings are skipped. */
    ignoreMessages: string[];
  };
  thresholds: {
    /** Slice pairs need at least this many common commits to count as change-coupled. */
    minSharedCommits: number;
    /** Degree = shared / avg(revisions of both); from here a pair is change-coupled. */
    changeCouplingDegree: number;
    minFileRevisions: number;
    fileChangeCouplingDegree: number;
    /** Max listed file pairs / edges per entry (report size). */
    maxListed: number;
  };
}

export const CONFIG_FILE = 'coupling.config.json';

export const defaultConfig: CouplingConfig = {
  slices: 'auto',
  nxScopeTagPrefix: 'scope:',
  shared: ['shared', 'core', 'common', 'util', 'utils'],
  app: [],
  ignore: [],
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/*.d.ts',
    '**/*.spec.*',
    '**/*.test.*',
    '**/*.stories.*',
  ],
  tsconfig: ['tsconfig.base.json', 'tsconfig.json'],
  git: {
    range: 'HEAD',
    maxCommits: null,
    since: null,
    maxFilesPerCommit: 30,
    ignoreMessages: [],
  },
  thresholds: {
    minSharedCommits: 3,
    changeCouplingDegree: 0.3,
    minFileRevisions: 3,
    fileChangeCouplingDegree: 0.5,
    maxListed: 20,
  },
};

/** Default patterns when the repo is no Nx workspace with scope tags. */
export const DEFAULT_SLICE_PATTERNS = ['libs/{slice}/**', 'src/app/{slice}/**'];

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function mergeConfig(overrides: DeepPartial<CouplingConfig>): CouplingConfig {
  return {
    ...defaultConfig,
    ...overrides,
    git: { ...defaultConfig.git, ...overrides.git },
    thresholds: { ...defaultConfig.thresholds, ...overrides.thresholds },
  } as CouplingConfig;
}

export function loadConfig(repo: string, file?: string): CouplingConfig {
  const path = file ?? join(repo, CONFIG_FILE);
  if (!existsSync(path)) {
    if (file) throw new Error(`config ${file} not found`);
    return mergeConfig({});
  }
  return mergeConfig(JSON.parse(readFileSync(path, 'utf-8')));
}
