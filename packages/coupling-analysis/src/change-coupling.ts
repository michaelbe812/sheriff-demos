import type { CouplingConfig } from './config.ts';
import type { Commit } from './git-log.ts';
import type { SliceMap } from './slices.ts';
import { round } from './static-coupling.ts';

/**
 * Change coupling after Tornhill (code-maat `coupling`): degree = shared commits / average revisions of
 * both. 1.0 = always changed together, 0.3 = in roughly every third change of either.
 */
export interface ChangePair {
  a: string;
  b: string;
  shared: number;
  revisionsA: number;
  revisionsB: number;
  degree: number;
}

export interface SliceHistory {
  slice: string;
  revisions: number;
  authors: number;
  mainAuthor: string | null;
  /** Share of the slice's commits by the main author (code-maat `main-dev`): low = no clear owner. */
  mainAuthorShare: number | null;
  /** Sum of coupling (code-maat `soc`): other slices touched in the same commits, summed. */
  sumOfCoupling: number;
}

export interface ChangeCoupling {
  commits: number;
  slices: SliceHistory[];
  pairs: ChangePair[];
  /** Files of different slices that change together: the concrete evidence behind a slice pair. */
  filePairs: (ChangePair & { sliceA: string; sliceB: string })[];
}

function countPairs(groups: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = `${group[i]}\0${group[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function toPairs(counts: Map<string, number>, revisions: Map<string, number>, minShared: number, minDegree: number): ChangePair[] {
  const pairs: ChangePair[] = [];
  for (const [key, shared] of counts) {
    const [a, b] = key.split('\0');
    const revisionsA = revisions.get(a) ?? 0;
    const revisionsB = revisions.get(b) ?? 0;
    const degree = round(shared / ((revisionsA + revisionsB) / 2));
    if (shared >= minShared && degree >= minDegree) pairs.push({ a, b, shared, revisionsA, revisionsB, degree });
  }
  return pairs.sort((x, y) => y.degree - x.degree || y.shared - x.shared || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

function authorStats(authors: Map<string, number>, revisions: number): Pick<SliceHistory, 'authors' | 'mainAuthor' | 'mainAuthorShare'> {
  const ranked = [...authors.entries()].sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB));
  if (!ranked.length) return { authors: 0, mainAuthor: null, mainAuthorShare: null };
  return { authors: ranked.length, mainAuthor: ranked[0][0], mainAuthorShare: round(ranked[0][1] / revisions) };
}

export function calcChangeCoupling(commits: Commit[], slices: SliceMap, config: CouplingConfig): ChangeCoupling {
  const { thresholds } = config;
  const sliceRevisions = new Map<string, number>();
  const fileRevisions = new Map<string, number>();
  const sliceAuthors = new Map<string, Map<string, number>>();
  const sumOfCoupling = new Map<string, number>();
  const sliceGroups: string[][] = [];
  const fileGroups: string[][] = [];
  for (const commit of commits) {
    const sliceOfFile = new Map(commit.files.flatMap((file) => (slices.sliceOf(file) ? [[file, slices.sliceOf(file) ?? '']] : [])));
    const assigned = [...sliceOfFile.keys()];
    const touched = [...new Set(sliceOfFile.values())].sort();
    for (const slice of touched) {
      sliceRevisions.set(slice, (sliceRevisions.get(slice) ?? 0) + 1);
      sumOfCoupling.set(slice, (sumOfCoupling.get(slice) ?? 0) + touched.length - 1);
      const authors = sliceAuthors.get(slice) ?? new Map<string, number>();
      authors.set(commit.author, (authors.get(commit.author) ?? 0) + 1);
      sliceAuthors.set(slice, authors);
    }
    for (const file of assigned) fileRevisions.set(file, (fileRevisions.get(file) ?? 0) + 1);
    if (touched.length > 1) {
      sliceGroups.push(touched);
      fileGroups.push(assigned);
    }
  }
  // all slice pairs, the ones with enough shared commits first (a single shared commit has degree 1 easily)
  const relevant = (pair: ChangePair) => (pair.shared >= thresholds.minSharedCommits ? 0 : 1);
  const pairs = toPairs(countPairs(sliceGroups), sliceRevisions, 1, 0).sort((x, y) => relevant(x) - relevant(y));
  // file level: only pairs across slices with enough history on both sides
  const eligible = (file: string): boolean => (fileRevisions.get(file) ?? 0) >= thresholds.minFileRevisions;
  const fileCounts = countPairs(fileGroups.map((group) => group.filter(eligible)));
  for (const key of [...fileCounts.keys()]) {
    const [a, b] = key.split('\0');
    if (slices.sliceOf(a) === slices.sliceOf(b)) fileCounts.delete(key);
  }
  const filePairs = toPairs(fileCounts, fileRevisions, thresholds.minSharedCommits, thresholds.fileChangeCouplingDegree).map((pair) => ({
    ...pair,
    sliceA: slices.sliceOf(pair.a) ?? '',
    sliceB: slices.sliceOf(pair.b) ?? '',
  }));
  const history = [...sliceRevisions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slice, revisions]) => ({
      slice,
      revisions,
      ...authorStats(sliceAuthors.get(slice) ?? new Map(), revisions),
      sumOfCoupling: sumOfCoupling.get(slice) ?? 0,
    }));
  return { commits: commits.length, slices: history, pairs, filePairs };
}

/** Whether a slice pair counts as change-coupled under the thresholds. */
export function isChangeCoupled(pair: ChangePair | undefined, config: CouplingConfig): boolean {
  return !!pair && pair.shared >= config.thresholds.minSharedCommits && pair.degree >= config.thresholds.changeCouplingDegree;
}
