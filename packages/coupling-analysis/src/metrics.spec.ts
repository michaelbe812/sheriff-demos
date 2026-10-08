import { describe, expect, it } from 'vitest';
import { calcChangeCoupling } from './change-coupling.ts';
import { mergeConfig } from './config.ts';
import { aggregateMatrix, detectiveScopes } from './detective.ts';
import { filterCommits, parseGitLog } from './git-log.ts';
import type { SliceMap } from './slices.ts';
import { calcStaticCoupling, findCycles } from './static-coupling.ts';

/** `src/<slice>/…` → slice; `shared` is shared, `app` is app. */
const sliceMap: SliceMap = {
  mode: 'patterns',
  sliceOf: (path) => /^src\/([^/]+)\//.exec(path)?.[1],
  roleOf: (slice) => (slice === 'shared' ? 'shared' : slice === 'app' ? 'app' : 'slice'),
  folders: new Map(),
};

const commit = (sha: string, files: string[], author = 'Ada', subject = 'feat') => ({ sha, author, subject, files });

describe('findCycles', () => {
  it('finds strongly connected slice groups only', () => {
    const pairs = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
      { from: 'c', to: 'd' },
      { from: 'e', to: 'f' },
      { from: 'f', to: 'e' },
    ];
    expect(findCycles(pairs)).toEqual([
      ['a', 'b', 'c'],
      ['e', 'f'],
    ]);
  });
});

describe('calcStaticCoupling', () => {
  it('aggregates cross-slice imports and Martin metrics', () => {
    const files = ['src/a/x.ts', 'src/a/y.ts', 'src/b/z.ts', 'src/shared/s.ts'];
    const edges = [
      { source: 'src/a/x.ts', target: 'src/a/y.ts' },
      { source: 'src/a/x.ts', target: 'src/b/z.ts' },
      { source: 'src/a/y.ts', target: 'src/b/z.ts' },
      { source: 'src/b/z.ts', target: 'src/shared/s.ts' },
    ];
    const result = calcStaticCoupling(edges, files, sliceMap);
    expect(result.pairs.map(({ from, to, imports, sourceFiles, targetFiles }) => ({ from, to, imports, sourceFiles, targetFiles }))).toEqual([
      { from: 'a', to: 'b', imports: 2, sourceFiles: ['src/a/x.ts', 'src/a/y.ts'], targetFiles: ['src/b/z.ts'] },
      { from: 'b', to: 'shared', imports: 1, sourceFiles: ['src/b/z.ts'], targetFiles: ['src/shared/s.ts'] },
    ]);
    expect(result.metrics).toEqual([
      { slice: 'a', files: 2, internalImports: 1, afferent: 0, efferent: 1, instability: 1 },
      { slice: 'b', files: 1, internalImports: 0, afferent: 2, efferent: 1, instability: 0.33 },
      { slice: 'shared', files: 1, internalImports: 0, afferent: 1, efferent: 0, instability: 0 },
    ]);
    expect(result.cycles).toEqual([]);
  });
});

describe('git log', () => {
  it('parses records and drops noise', () => {
    const raw = '\x1eaaa\x1fAda\x1ffeat: one\nsrc/a/x.ts\nREADME.md\n\n\x1ebbb\x1fBob\x1fchore: format\nsrc/a/x.ts\n';
    const commits = parseGitLog(raw);
    expect(commits).toEqual([commit('aaa', ['README.md', 'src/a/x.ts'], 'Ada', 'feat: one'), commit('bbb', ['src/a/x.ts'], 'Bob', 'chore: format')]);
    const config = mergeConfig({ git: { ignoreMessages: ['format'], maxFilesPerCommit: 30, range: 'HEAD', maxCommits: null, since: null } });
    expect(filterCommits(commits, (path) => path.endsWith('.ts'), config)).toEqual([commit('aaa', ['src/a/x.ts'], 'Ada', 'feat: one')]);
  });

  it('drops commits above maxFilesPerCommit', () => {
    const config = mergeConfig({ git: { maxFilesPerCommit: 2, range: 'HEAD', maxCommits: null, since: null, ignoreMessages: [] } });
    const commits = [commit('a', ['src/a/1.ts', 'src/a/2.ts', 'src/a/3.ts']), commit('b', ['src/a/1.ts'])];
    expect(filterCommits(commits, () => true, config).map(({ sha }) => sha)).toEqual(['b']);
  });
});

describe('calcChangeCoupling', () => {
  const config = mergeConfig({ thresholds: { minSharedCommits: 2, changeCouplingDegree: 0.3, minFileRevisions: 2, fileChangeCouplingDegree: 0.5, maxListed: 20 } });

  it('computes degree = shared / average revisions (Tornhill)', () => {
    const commits = [
      commit('1', ['src/a/x.ts', 'src/b/y.ts']),
      commit('2', ['src/a/x.ts', 'src/b/y.ts']),
      commit('3', ['src/a/x.ts'], 'Bob'),
      commit('4', ['src/a/other.ts']),
      commit('5', ['README.ts']),
    ];
    const result = calcChangeCoupling(commits, sliceMap, config);
    expect(result.pairs).toEqual([{ a: 'a', b: 'b', shared: 2, revisionsA: 4, revisionsB: 2, degree: 0.67 }]);
    expect(result.slices).toEqual([
      { slice: 'a', revisions: 4, authors: 2, mainAuthor: 'Ada', mainAuthorShare: 0.75, sumOfCoupling: 2 },
      { slice: 'b', revisions: 2, authors: 1, mainAuthor: 'Ada', mainAuthorShare: 1, sumOfCoupling: 2 },
    ]);
    expect(result.filePairs).toEqual([
      { a: 'src/a/x.ts', b: 'src/b/y.ts', shared: 2, revisionsA: 3, revisionsB: 2, degree: 0.8, sliceA: 'a', sliceB: 'b' },
    ]);
  });

  it('ignores file pairs inside one slice', () => {
    const commits = [commit('1', ['src/a/x.ts', 'src/a/y.ts']), commit('2', ['src/a/x.ts', 'src/a/y.ts'])];
    expect(calcChangeCoupling(commits, sliceMap, config).filePairs).toEqual([]);
  });
});

describe('detective adapter', () => {
  it('uses one scope per slice unless the prefix covers another slice', () => {
    const folders = new Map([
      ['booking', ['libs/booking/state/', 'libs/booking/ui/']],
      ['shared', ['libs/generated/pet/', 'libs/shared/ui/']],
      ['app', ['apps/client/']],
    ]);
    expect([...detectiveScopes(folders)]).toEqual([
      ['apps/client', 'app'],
      ['libs/booking', 'booking'],
      ['libs/generated/pet', 'shared'],
      ['libs/shared/ui', 'shared'],
    ]);
  });

  it('aggregates folder matrices to slice pairs', () => {
    const scopes = new Map([
      ['libs/a', 'a'],
      ['libs/s1', 's'],
      ['libs/s2', 's'],
    ]);
    const matrix = { dimensions: ['libs/a', 'libs/s1', 'libs/s2'], matrix: [[9, 2, 3], [0, 0, 1], [1, 0, 0]] };
    expect([...aggregateMatrix(matrix, scopes, false)]).toEqual([
      ['a\0s', 5],
      ['s\0a', 1],
    ]);
    expect([...aggregateMatrix(matrix, scopes, true)]).toEqual([['a\0s', 6]]);
  });
});
