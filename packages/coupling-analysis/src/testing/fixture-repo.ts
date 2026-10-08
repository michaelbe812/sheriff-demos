import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Temporary git repo for end-to-end specs: write files, commit with fixed author/date (stable shas). */
export interface FixtureRepo {
  root: string;
  commit(subject: string, files: Record<string, string>): void;
  dispose(): void;
}

export function createFixtureRepo(): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), 'coupling-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  return {
    root,
    commit(subject, files) {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      git('add', '-A');
      git('commit', '-q', '-m', subject);
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
