/**
 * Global sync generator (`nx sync` / `nx sync:check`, nx.json → sync.globalGenerators):
 * the tags in every lib's project.json are exactly the ones its path implies (`deriveTags` of
 * @blueprint/tooling-conventions — the same function the generators write them with).
 *
 * Why: tags are written once, when a lib is created. A rule change in the conventions (e.g. the
 * reduced blueprint: generated api/core became type:data-access, data split into data-access + state, port/feat-port were dropped) or a
 * hand-edited project.json leaves stale tags behind. `nx sync` rewrites them, CI's `nx sync:check`
 * reports them. A lib whose path breaks the convention is only reported — its folder needs a fix
 * (move/rename), not its tags.
 */
import { formatFiles, type Tree } from '@nx/devkit';
import type { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import { deriveTags, LIBS_DIR, libPathError } from '@blueprint/tooling-conventions';
import { listLibPaths, readJsonFile, readScopes, writeJsonFile } from '@blueprint/tooling-conventions/tree';

interface ProjectJsonTags {
  tags?: string[];
}

const sameTags = (a: string[], b: string[]): boolean => a.length === b.length && a.every((tag, i) => tag === b[i]);

export async function libTagsSyncGenerator(tree: Tree): Promise<SyncGeneratorResult> {
  const scopes = readScopes(tree);
  const details: string[] = [];
  const unfixable: string[] = [];

  for (const libPath of listLibPaths(tree)) {
    const file = `${LIBS_DIR}/${libPath}/project.json`;
    // a lib without project.json is the config guard's finding (tooling-verify:verify), not ours
    if (!tree.exists(file)) continue;
    const pathError = libPathError(libPath, { scopes });
    if (pathError) {
      unfixable.push(`${pathError} — fix the folder (nx g @blueprint/tooling-workspace:move), tags left as they are`);
      continue;
    }
    const project = readJsonFile<ProjectJsonTags & Record<string, unknown>>(tree, file);
    const actual = project.tags ?? [];
    const expected = deriveTags(libPath, { scopes });
    if (sameTags(actual, expected)) continue;
    writeJsonFile(tree, file, { ...project, tags: expected });
    details.push(`${file}: tags ${JSON.stringify(actual)} → ${JSON.stringify(expected)}`);
  }

  if (details.length === 0 && unfixable.length === 0) return;
  if (details.length) await formatFiles(tree);
  return {
    outOfSyncMessage: unfixable.length
      ? 'Lib tags out of sync; some lib paths break the convention and need a move (see details).'
      : 'Lib tags do not match their paths (run `nx sync`).',
    outOfSyncDetails: [...details, ...unfixable],
  };
}

export default libTagsSyncGenerator;
