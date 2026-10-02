import { names, type Tree } from '@nx/devkit';
import { type ArtifactSchema, resolveArtifact, writeArtifact } from '../shared/artifact';

export const STORE_LAYERS = ['state', 'ui', 'feature'];

/** Signal store (`<name>.store.ts`, class `<Name>Store`), provided where it is used. */
export async function storeGenerator(tree: Tree, options: ArtifactSchema): Promise<void> {
  const target = resolveArtifact(tree, options.path.replace(/[.-]store$/, ''), 'store', STORE_LAYERS);
  const className = `${names(target.name).className}Store`;
  const content = `import { computed, Injectable, signal } from '@angular/core';

interface ${className.replace(/Store$/, '')}State {
  loading: boolean;
}

/** Signal store: provide it where it lives (\`providers: [${className}]\` on the component or route). */
@Injectable()
export class ${className} {
  private readonly state = signal<${className.replace(/Store$/, '')}State>({ loading: false });

  readonly loading = computed(() => this.state().loading);

  setLoading(loading: boolean): void {
    this.state.update((state) => ({ ...state, loading }));
  }
}
`;
  await writeArtifact(tree, target, `${target.relative}.store.ts`, content, options);
}

export default storeGenerator;
