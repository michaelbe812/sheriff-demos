import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { calcChangeCoupling, type ChangeCoupling } from './change-coupling.ts';
import { type CouplingConfig, loadConfig } from './config.ts';
import { type DetectiveResult, runDetective } from './detective.ts';
import { type CutProposal, deriveFindings, type Finding, proposeCut } from './findings.ts';
import { filterCommits, readCommits } from './git-log.ts';
import { globToRegExp, matchesAny } from './glob.ts';
import { buildImportGraph } from './imports.ts';
import { headSha, trackedFiles } from './repo.ts';
import { createSliceMap, type SliceMap, type SliceRole } from './slices.ts';
import { calcStaticCoupling, type StaticCoupling } from './static-coupling.ts';
import { TOOL } from './version.ts';

export interface CouplingReport {
  meta: {
    repo: string;
    tool: string;
    head: string;
    sliceMode: SliceMap['mode'];
    analyzedFiles: number;
    unassignedFiles: number;
    /** Top folders (2 levels) without slice: hints for `slices` patterns in foreign repos. */
    unassignedFolders: { folder: string; files: number }[];
    commitsRead: number;
    commitsAnalyzed: number;
    config: CouplingConfig;
  };
  slices: { slice: string; role: SliceRole; folders: string[] }[];
  staticCoupling: StaticCoupling;
  changeCoupling: ChangeCoupling;
  findings: Finding[];
  proposal: CutProposal;
  detective?: DetectiveResult;
}

export interface AnalyzeOptions {
  repo: string;
  config?: CouplingConfig;
  configFile?: string;
  detective?: boolean;
}

export function fileFilter(config: CouplingConfig): (path: string) => boolean {
  const excludes = config.exclude.map(globToRegExp);
  return (path) => config.extensions.some((extension) => path.endsWith(extension)) && !matchesAny(path, excludes);
}

function unassignedFolders(files: string[]): { folder: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const folder = file.split('/').slice(0, -1).slice(0, 2).join('/') || '.';
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, files: count }))
    .sort((a, b) => b.files - a.files || a.folder.localeCompare(b.folder))
    .slice(0, 10);
}

/** Lists capped at `maxListed` keep the report readable; counts stay exact. */
function capEdges(staticCoupling: StaticCoupling, max: number): StaticCoupling {
  return { ...staticCoupling, pairs: staticCoupling.pairs.map((pair) => ({ ...pair, edges: pair.edges.slice(0, max) })) };
}

export async function analyze(options: AnalyzeOptions): Promise<CouplingReport> {
  const repo = resolve(options.repo);
  const config = options.config ?? loadConfig(repo, options.configFile);
  const tracked = trackedFiles(repo);
  const isAnalyzed = fileFilter(config);
  const slices = createSliceMap(repo, config, tracked);
  const files = tracked.filter((file) => isAnalyzed(file) && existsSync(join(repo, file)));
  const assigned = files.filter((file) => slices.sliceOf(file));
  const edges = buildImportGraph(repo, files, config.tsconfig);
  const staticCoupling = calcStaticCoupling(edges, assigned, slices);
  const commitsRead = readCommits(repo, config);
  const commits = filterCommits(commitsRead, isAnalyzed, config);
  const changeCoupling = calcChangeCoupling(commits, slices, config);
  const findings = deriveFindings({ config, slices, staticCoupling, change: changeCoupling, edges });
  const allSlices = [...new Set([...slices.folders.keys(), ...changeCoupling.slices.map(({ slice }) => slice)])].sort();
  const report: CouplingReport = {
    meta: {
      repo: basename(repo),
      tool: TOOL,
      head: headSha(repo),
      sliceMode: slices.mode,
      analyzedFiles: files.length,
      unassignedFiles: files.length - assigned.length,
      unassignedFolders: unassignedFolders(files.filter((file) => !slices.sliceOf(file))),
      commitsRead: commitsRead.length,
      commitsAnalyzed: commits.length,
      config,
    },
    slices: allSlices.map((slice) => ({ slice, role: slices.roleOf(slice), folders: slices.folders.get(slice) ?? [] })),
    staticCoupling: capEdges(staticCoupling, config.thresholds.maxListed),
    changeCoupling: { ...changeCoupling, filePairs: changeCoupling.filePairs.slice(0, config.thresholds.maxListed * 5) },
    findings,
    proposal: proposeCut(findings, allSlices, slices),
  };
  if (options.detective) report.detective = await runDetective(repo, slices, config);
  return report;
}
