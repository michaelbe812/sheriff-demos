import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { CouplingConfig } from './config.ts';
import type { SliceMap } from './slices.ts';

/**
 * Detective (@softarc/detective, Angular Architects) as a second source: it builds its import graph with
 * Sheriff and counts co-changes from its own git log cache. We seed `.detective/config.json` with our
 * slices as scopes, start it headless, read `/api/coupling` + `/api/change-coupling` and aggregate the
 * folder matrices to slices. Its numbers are raw counts (no commit-size filter, no degree): a cross-check,
 * not the basis of the findings.
 */
export interface DetectiveResult {
  version: string;
  scopes: string[];
  coupling: { from: string; to: string; imports: number }[];
  changeCoupling: { a: string; b: string; shared: number }[];
}

interface DetectiveMatrix {
  dimensions: string[];
  matrix: number[][];
}

const DETECTIVE_DIR = '.detective';

function detectiveBin(): { bin: string; version: string } {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('@softarc/detective/package.json');
  return { bin: join(dirname(packageJson), 'bin/main.js'), version: JSON.parse(readFileSync(packageJson, 'utf-8')).version };
}

/**
 * One scope per slice where possible: the common folder prefix of the slice, unless it also covers
 * another slice's folders (then the slice keeps its individual folders).
 */
export function detectiveScopes(folders: Map<string, string[]>): Map<string, string> {
  const scopeToSlice = new Map<string, string>();
  const allFolders = [...folders.entries()].flatMap(([slice, list]) => list.map((folder) => ({ slice, folder })));
  for (const [slice, list] of folders) {
    const prefix = commonFolderPrefix(list);
    const collides = !prefix || allFolders.some((entry) => entry.slice !== slice && entry.folder.startsWith(prefix));
    for (const scope of collides ? list : [prefix]) scopeToSlice.set(scope.replace(/\/$/, ''), slice);
  }
  return new Map([...scopeToSlice.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function commonFolderPrefix(folders: string[]): string {
  const parts = folders.map((folder) => folder.split('/').filter(Boolean));
  const common: string[] = [];
  for (let i = 0; parts.every((segments) => i < segments.length && segments[i] === parts[0][i]); i++) common.push(parts[0][i]);
  return common.length ? `${common.join('/')}/` : '';
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

async function waitForHealth(baseUrl: string, child: ChildProcess, log: () => string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`detective exited (${child.exitCode}):\n${log()}`);
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`detective did not start within ${timeoutMs} ms:\n${log()}`);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** Folder matrix → slice pairs (sums over the folders of a slice; diagonal = inside a slice, dropped). */
export function aggregateMatrix(result: DetectiveMatrix, scopeToSlice: Map<string, string>, symmetric: boolean): Map<string, number> {
  const pairs = new Map<string, number>();
  const sliceOf = (dimension: string) => scopeToSlice.get(dimension.replace(/\/$/, ''));
  result.dimensions.forEach((rowDimension, i) => {
    result.dimensions.forEach((columnDimension, j) => {
      const from = sliceOf(rowDimension);
      const to = sliceOf(columnDimension);
      const value = result.matrix[i]?.[j] ?? 0;
      if (!from || !to || from === to || value === 0) return;
      const key = symmetric ? [from, to].sort().join('\0') : `${from}\0${to}`;
      pairs.set(key, (pairs.get(key) ?? 0) + value);
    });
  });
  return pairs;
}

function seedConfig(repo: string, scopes: string[], config: CouplingConfig): () => void {
  const dir = join(repo, DETECTIVE_DIR);
  const file = join(dir, 'config.json');
  const dirExisted = existsSync(dir);
  const original = existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
  const current = original ? JSON.parse(original) : {};
  const ownFilter = [...config.extensions.map((extension) => `**/*${extension}`), ...config.exclude.map((glob) => `!${glob}`)];
  const seeded = {
    groups: [],
    entries: [],
    aliases: {},
    teams: {},
    ...current,
    scopes,
    filter: {
      logs: [...(current.filter?.logs ?? []), ...config.git.ignoreMessages],
      files: current.filter?.files?.length ? current.filter.files : ownFilter,
    },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(seeded, null, 2)}\n`);
  return () => {
    if (!dirExisted) rmSync(dir, { recursive: true, force: true });
    else if (original === undefined) rmSync(file, { force: true });
    else writeFileSync(file, original);
  };
}

/** Headless run: start, read both matrices, stop, restore the repo's `.detective` state. */
export async function runDetective(repo: string, slices: SliceMap, config: CouplingConfig): Promise<DetectiveResult> {
  const { bin, version } = detectiveBin();
  const scopeToSlice = detectiveScopes(slices.folders);
  const restore = seedConfig(repo, [...scopeToSlice.keys()], config);
  const port = await freePort();
  const child = spawn(process.execPath, [bin, '--path', repo, '--port', String(port), '--open', 'false'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  const baseUrl = `http://localhost:${port}`;
  try {
    await waitForHealth(baseUrl, child, () => output, 120_000);
    await getJson(`${baseUrl}/api/cache/log/update`);
    const limits = config.git.maxCommits ? `?limitCommits=${config.git.maxCommits}` : '';
    const coupling = await getJson<DetectiveMatrix>(`${baseUrl}/api/coupling`);
    const changeCoupling = await getJson<DetectiveMatrix>(`${baseUrl}/api/change-coupling${limits}`);
    const toList = <T>(pairs: Map<string, number>, build: (x: string, y: string, n: number) => T): T[] =>
      [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => build(...(key.split('\0') as [string, string]), n));
    return {
      version,
      scopes: [...scopeToSlice.keys()],
      coupling: toList(aggregateMatrix(coupling, scopeToSlice, false), (from, to, imports) => ({ from, to, imports })),
      changeCoupling: toList(aggregateMatrix(changeCoupling, scopeToSlice, true), (a, b, shared) => ({ a, b, shared })),
    };
  } finally {
    child.kill();
    restore();
  }
}

/** Interactive run: seed the scopes, then hand over to Detective's UI (keeps `.detective`). */
export function serveDetective(repo: string, slices: SliceMap, config: CouplingConfig): ChildProcess {
  const { bin } = detectiveBin();
  seedConfig(repo, [...detectiveScopes(slices.folders).keys()], config);
  return spawn(process.execPath, [bin, '--path', repo], { stdio: 'inherit' });
}
