/**
 * Thin preset for `@nx/angular:component`: with an explicit project.json per lib the Nx generator works
 * again (it finds the project in the tree). This wrapper only adds the blueprint rules — a component
 * lives in a ui/feature/shell lib, never in a generated client — and its defaults: inline template and
 * styles, `app-` selector, no spec, exported from index.ts. Plain `nx g @nx/angular:component <path>`
 * works as well, without the layer check.
 */
import type { Tree } from '@nx/devkit';
import { componentGenerator as nxComponentGenerator } from '@nx/angular/generators';
import { LIBS_DIR } from '@blueprint/tooling-conventions';
import { type ArtifactSchema, resolveArtifact } from '../shared/artifact';

export const COMPONENT_LAYERS = ['ui', 'feature', 'shell'];

export async function componentGenerator(tree: Tree, options: ArtifactSchema): Promise<void> {
  const target = resolveArtifact(tree, options.path, 'component', COMPONENT_LAYERS);
  const file = `${LIBS_DIR}/${target.libPath}/src/${target.relative}.ts`;
  if (tree.exists(file)) throw new Error(`${file} exists already`);
  await nxComponentGenerator(tree, {
    path: `${LIBS_DIR}/${target.libPath}/src/${target.relative}`,
    prefix: 'app',
    inlineTemplate: true,
    inlineStyle: true,
    style: 'none',
    skipTests: true,
    export: options.export !== false,
    skipFormat: options.skipFormat,
  });
}

export default componentGenerator;
