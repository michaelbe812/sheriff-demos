import type { Tree } from '@nx/devkit';
import { type ArtifactSchema, resolveArtifact, writeArtifact } from '../shared/artifact';

export const SERVICE_LAYERS = ['api', 'state', 'feature', 'shell'];

/** Root-provided injectable class (`inject()` style). */
export async function serviceGenerator(tree: Tree, options: ArtifactSchema): Promise<void> {
  const target = resolveArtifact(tree, options.path, 'service', SERVICE_LAYERS);
  const content = `import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ${target.className} {}
`;
  await writeArtifact(tree, target, `${target.relative}.ts`, content, options);
}

export default serviceGenerator;
