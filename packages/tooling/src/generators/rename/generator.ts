import type { Tree } from '@nx/devkit';
import { FEAT_PREFIX } from '@blueprint/tooling-conventions';
import { moveGenerator } from '../move/generator';
import { assertKebabCase, normalizeLibsPath } from '../shared/workspace';

export interface RenameGeneratorSchema {
  /** lib, feat or domain below libs/ */
  path: string;
  /** new last segment: domain name, feat name (with or without `feat-`) or layer */
  name: string;
  appRoutesFile?: string;
  skipFormat?: boolean;
}

/** Renames in place = move to a sibling path (`payment` → `billing`, `booking/feat-a` → `booking/feat-b`). */
export async function renameGenerator(tree: Tree, options: RenameGeneratorSchema): Promise<void> {
  const path = normalizeLibsPath(options.path);
  const segments = path.split('/');
  const last = segments.pop() as string;
  const isFeat = last.startsWith(FEAT_PREFIX);
  const bareName = isFeat && options.name.startsWith(FEAT_PREFIX) ? options.name.slice(FEAT_PREFIX.length) : options.name;
  assertKebabCase(bareName, 'Name');
  await moveGenerator(tree, {
    from: path,
    to: [...segments, isFeat ? `${FEAT_PREFIX}${bareName}` : bareName].join('/'),
    appRoutesFile: options.appRoutesFile,
    skipFormat: options.skipFormat,
  });
}

export default renameGenerator;
