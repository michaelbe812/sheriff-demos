import type { CouplingConfig } from './config.ts';
import { git } from './repo.ts';

export interface Commit {
  sha: string;
  author: string;
  subject: string;
  /** Analyzed files touched by the commit (sorted, unique). */
  files: string[];
}

const RECORD = '\x1e';
const FIELD = '\x1f';

/** Raw `git log --name-only` output → commits (merges excluded: their changes are counted on the branch). */
export function parseGitLog(output: string): Commit[] {
  return output
    .split(RECORD)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [header, ...paths] = chunk.split('\n');
      const [sha, author, subject] = header.split(FIELD);
      return { sha, author, subject, files: [...new Set(paths.map((path) => path.trim()).filter(Boolean))].sort() };
    });
}

export function readCommits(repo: string, config: CouplingConfig): Commit[] {
  const args = ['log', '--no-merges', '--no-renames', '--name-only', `--format=${RECORD}%H${FIELD}%aN${FIELD}%s`];
  if (config.git.maxCommits) args.push(`--max-count=${config.git.maxCommits}`);
  if (config.git.since) args.push(`--since=${config.git.since}`);
  args.push(config.git.range, '--');
  return parseGitLog(git(repo, args));
}

/**
 * Keeps only analyzed files and drops noise: commits with an ignored subject, commits touching more
 * than `maxFilesPerCommit` analyzed files (sweeps, renames) and commits touching none.
 */
export function filterCommits(commits: Commit[], isAnalyzed: (path: string) => boolean, config: CouplingConfig): Commit[] {
  return commits
    .filter(({ subject }) => !config.git.ignoreMessages.some((text) => subject.includes(text)))
    .map((commit) => ({ ...commit, files: commit.files.filter(isAnalyzed) }))
    .filter(({ files }) => files.length > 0 && files.length <= config.git.maxFilesPerCommit);
}
