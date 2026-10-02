/**
 * Thin preset for `@schematics/angular:service` (Nx has no own service generator; the Angular schematic
 * runs through Nx' Angular CLI adapter and needs the project — found again via project.json). The wrapper
 * adds the blueprint rules (data/feature/shell lib, never a generated client), takes a path instead of
 * project + name, skips the spec and exports the service from index.ts.
 */
import { formatFiles, type Tree } from '@nx/devkit';
import { wrapAngularDevkitSchematic } from '@nx/devkit/ngcli-adapter';
import { LIBS_DIR, projectNameFor } from '@blueprint/tooling-conventions';
import { type ArtifactSchema, resolveArtifact } from '../shared/artifact';
import { addExport } from '../shared/workspace';

export const SERVICE_LAYERS = ['data', 'feature', 'shell'];

export async function serviceGenerator(tree: Tree, options: ArtifactSchema): Promise<void> {
  const target = resolveArtifact(tree, options.path, 'service', SERVICE_LAYERS);
  const file = `${LIBS_DIR}/${target.libPath}/src/${target.relative}.ts`;
  if (tree.exists(file)) throw new Error(`${file} exists already`);
  const directory = target.relative.split('/').slice(0, -1).join('/');
  const angularServiceSchematic = wrapAngularDevkitSchematic('@schematics/angular', 'service');
  await angularServiceSchematic(tree, {
    name: target.name,
    project: projectNameFor(target.libPath),
    path: `${LIBS_DIR}/${target.libPath}/src${directory ? `/${directory}` : ''}`,
    skipTests: true,
  });
  if (options.export !== false) addExport(tree, target.libPath, `${target.relative}.ts`);
  if (!options.skipFormat) await formatFiles(tree);
}

export default serviceGenerator;
