import { execFileSync } from 'node:child_process';

/** Read-only git access to the analyzed repo. */
export function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024 });
}

/** Tracked files (sorted, `/`-separated): ignores build output and untracked noise by construction. */
export function trackedFiles(repo: string): string[] {
  return git(repo, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort();
}

export function headSha(repo: string): string {
  return git(repo, ['rev-parse', 'HEAD']).trim();
}
