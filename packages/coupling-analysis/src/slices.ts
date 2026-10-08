import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type CouplingConfig, DEFAULT_SLICE_PATTERNS } from './config.ts';
import { matchSlicePattern } from './glob.ts';

export type SliceRole = 'slice' | 'shared' | 'app';

/** File → slice assignment plus the folders each slice covers (Detective scopes). */
export interface SliceMap {
  mode: 'nx' | 'patterns';
  sliceOf(path: string): string | undefined;
  roleOf(slice: string): SliceRole;
  /** slice → folder prefixes (`libs/booking/`), sorted. */
  folders: Map<string, string[]>;
}

interface NxProject {
  root: string;
  name: string;
  tags: string[];
  application: boolean;
}

function readNxProjects(repo: string, files: string[]): NxProject[] {
  const projects: NxProject[] = [];
  for (const file of files) {
    const isProjectJson = file.endsWith('project.json');
    const isPackageJson = file.endsWith('package.json');
    if (!isProjectJson && !isPackageJson) continue;
    if (file.includes('node_modules/')) continue;
    const root = dirname(file) === '.' ? '' : dirname(file);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(readFileSync(join(repo, file), 'utf-8'));
    } catch {
      continue;
    }
    const nx = (isProjectJson ? json : json['nx']) as Record<string, unknown> | undefined;
    if (!nx) continue;
    projects.push({
      root,
      name: String(nx['name'] ?? json['name'] ?? root),
      tags: Array.isArray(nx['tags']) ? (nx['tags'] as string[]) : [],
      application: nx['projectType'] === 'application',
    });
  }
  // project.json wins over package.json of the same root
  const byRoot = new Map<string, NxProject>();
  for (const project of projects) {
    const known = byRoot.get(project.root);
    if (!known || (known.tags.length === 0 && project.tags.length > 0)) byRoot.set(project.root, project);
  }
  return [...byRoot.values()];
}

function nxSliceOf(project: NxProject, prefix: string): { slice: string; app: boolean } | undefined {
  const scope = project.tags.find((tag) => tag.startsWith(prefix));
  if (scope) return { slice: scope.slice(prefix.length), app: false };
  if (project.application || project.tags.includes('type:app')) return { slice: project.name, app: true };
  return undefined;
}

function roleResolver(config: CouplingConfig, appSlices: Set<string>): (slice: string) => SliceRole {
  return (slice) => {
    if (config.shared.includes(slice)) return 'shared';
    if (config.app.includes(slice) || appSlices.has(slice)) return 'app';
    return 'slice';
  };
}

function addFolder(folders: Map<string, Set<string>>, slice: string, folder: string): void {
  const set = folders.get(slice) ?? new Set<string>();
  set.add(folder);
  folders.set(slice, set);
}

function sortedFolders(folders: Map<string, Set<string>>): Map<string, string[]> {
  return new Map([...folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([slice, set]) => [slice, [...set].sort()]));
}

function nxSliceMap(projects: NxProject[], config: CouplingConfig): SliceMap {
  const appSlices = new Set<string>();
  const roots: { root: string; slice: string }[] = [];
  const folders = new Map<string, Set<string>>();
  for (const project of projects) {
    const assigned = nxSliceOf(project, config.nxScopeTagPrefix);
    if (!assigned || config.ignore.includes(assigned.slice) || project.root === '') continue;
    if (assigned.app) appSlices.add(assigned.slice);
    roots.push({ root: `${project.root}/`, slice: assigned.slice });
    addFolder(folders, assigned.slice, `${project.root}/`);
  }
  // longest root first: nested projects win over their parents
  roots.sort((a, b) => b.root.length - a.root.length || a.root.localeCompare(b.root));
  return {
    mode: 'nx',
    sliceOf: (path) => roots.find(({ root }) => path.startsWith(root))?.slice,
    roleOf: roleResolver(config, appSlices),
    folders: sortedFolders(folders),
  };
}

function patternSliceMap(patterns: string[], config: CouplingConfig, files: string[]): SliceMap {
  const folders = new Map<string, Set<string>>();
  const cache = new Map<string, string | undefined>();
  const sliceOf = (path: string): string | undefined => {
    if (cache.has(path)) return cache.get(path);
    let slice: string | undefined;
    for (const pattern of patterns) {
      const match = matchSlicePattern(path, pattern);
      if (match && !config.ignore.includes(match.slice)) {
        slice = match.slice;
        addFolder(folders, match.slice, match.folder);
        break;
      }
    }
    cache.set(path, slice);
    return slice;
  };
  files.forEach(sliceOf);
  return { mode: 'patterns', sliceOf, roleOf: roleResolver(config, new Set()), folders: sortedFolders(folders) };
}

export function createSliceMap(repo: string, config: CouplingConfig, files: string[]): SliceMap {
  if (Array.isArray(config.slices)) return patternSliceMap(config.slices, config, files);
  const isNxWorkspace = existsSync(join(repo, 'nx.json'));
  const projects = isNxWorkspace ? readNxProjects(repo, files) : [];
  const hasScopes = projects.some((project) => project.tags.some((tag) => tag.startsWith(config.nxScopeTagPrefix)));
  if (config.slices === 'nx') {
    if (!isNxWorkspace) throw new Error('slices "nx": no nx.json in the repo');
    return nxSliceMap(projects, config);
  }
  return hasScopes ? nxSliceMap(projects, config) : patternSliceMap(DEFAULT_SLICE_PATTERNS, config, files);
}
