import { formatFiles, type Tree } from '@nx/devkit';
import { generateTestingLib } from '../shared/slice';
import { sliceNames } from '../shared/slice-templates';
import { assertSliceExists } from '../shared/workspace';

export interface TestingGeneratorSchema {
  domain: string;
  skipFormat?: boolean;
}

/** libs/<domain>/testing alone (fixtures, handlers, scenarios) — for slices that have none yet. */
export async function testingGenerator(tree: Tree, options: TestingGeneratorSchema): Promise<void> {
  assertSliceExists(tree, options.domain);
  generateTestingLib(tree, sliceNames(options.domain));
  if (!options.skipFormat) await formatFiles(tree);
}

export default testingGenerator;
