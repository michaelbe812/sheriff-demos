import type { Tree } from '@nx/devkit';
import { type ArtifactSchema, resolveArtifact, writeArtifact } from '../shared/artifact';

export const COMPONENT_LAYERS = ['ui', 'feature', 'shell'];

/** Standalone OnPush component with inline template, `input()` ready. */
export async function componentGenerator(tree: Tree, options: ArtifactSchema): Promise<void> {
  const target = resolveArtifact(tree, options.path, 'component', COMPONENT_LAYERS);
  const content = `import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-${target.name}',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`<p>${target.name} works.</p>\`,
})
export class ${target.className} {}
`;
  await writeArtifact(tree, target, `${target.relative}.ts`, content, options);
}

export default componentGenerator;
