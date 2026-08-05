import { names, Tree } from '@nx/devkit';

/**
 * Slice file templates for the vertical-slice presets. Preset-aware:
 *   - 'blueprint' — api/ holds a concrete class (no infra/, no providers)
 *   - 'inverted'  — api/index.ts holds an ABSTRACT contract, the impl lives in
 *                   infra/, wired at the slice root by <name>.providers.ts
 */

export type VerticalPreset = 'blueprint' | 'inverted';

export function routesFile(name: string): string {
  return `import { Routes } from '@angular/router';

/** Slice root (entry): the only thing the app shell wires up. */
const ${names(name).propertyName}Routes: Routes = [];

export default ${names(name).propertyName}Routes;
`;
}

export function modelFile(name: string): string {
  const { className } = names(name);
  return `export interface ${className} {
  id: string;
}
`;
}

export function eventsFile(name: string): string {
  return `/** Domain events: ui/feature emit, data handles. */
export interface ${names(name).className}Changed {
  readonly type: '${names(name).fileName}.changed';
  readonly id: string;
}
`;
}

export function utilsFile(name: string): string {
  const { className, fileName, propertyName } = names(name);
  return `import { ${className} } from '../types/${fileName}.model';

export function ${propertyName}Label(entity: ${className}): string {
  return entity.id;
}
`;
}

/** blueprint: concrete class in api/<name>-api.ts. */
export function apiConcreteFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { Injectable } from '@angular/core';
import { ${className} } from '../types/${fileName}.model';

/**
 * PUBLIC PORT of the ${fileName} domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here.
 */
export type { ${className} } from '../types/${fileName}.model';

@Injectable({ providedIn: 'root' })
export class ${className}Api {
  async load(): Promise<${className}[]> {
    const response = await fetch('/api/${fileName}');
    return (await response.json()) as ${className}[];
  }
}
`;
}

/** inverted: abstract contract in api/index.ts. */
export function apiContractFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { ${className} } from '../types/${fileName}.model';

/**
 * PUBLIC PORT of the ${fileName} domain — CONTRACT ONLY. Consumers bind to this
 * abstract class (which is both the TYPE and the DI TOKEN); the implementation
 * lives in infra/ and is wired at the slice root by provide${className}().
 * \`type:api\` has no clearance towards \`type:infra\`: this file structurally
 * cannot name its own implementation. That is what makes it inverted.
 */
export type { ${className} } from '../types/${fileName}.model';

export abstract class ${className}Api {
  abstract load(): Promise<${className}[]>;
}
`;
}

export function infraFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { Injectable } from '@angular/core';
import { ${className}Api } from '../api';
import { ${className} } from '../types/${fileName}.model';

/**
 * The port's implementation (type:infra) — the only place that knows how the
 * data arrives. Not tagged \`port\`, so no other domain can reach it.
 */
@Injectable({ providedIn: 'root' })
export class Http${className}Api extends ${className}Api {
  async load(): Promise<${className}[]> {
    const response = await fetch('/api/${fileName}');
    return (await response.json()) as ${className}[];
  }
}
`;
}

export function providersFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { Provider } from '@angular/core';
import { ${className}Api } from './api';
import { Http${className}Api } from './infra/http-${fileName}-api';

/** Slice root (entry): wires the port contract to its implementation. */
export function provide${className}(): Provider {
  // the abstract class IS the token — no separate InjectionToken needed
  return { provide: ${className}Api, useClass: Http${className}Api };
}
`;
}

export function storeFile(name: string, preset: VerticalPreset): string {
  const { className, fileName } = names(name);
  const apiImport =
    preset === 'inverted'
      ? `import { ${className}Api } from '../api';`
      : `import { ${className}Api } from '../api/${fileName}-api';`;
  return `import { inject, Injectable, signal } from '@angular/core';
${apiImport}
import { ${className} } from '../types/${fileName}.model';

/** Domain-shared store: usable by feature containers, never by ui. */
@Injectable({ providedIn: 'root' })
export class ${className}Store {
  private readonly api = inject(${className}Api);
  private readonly entities = signal<${className}[]>([]);

  readonly all = this.entities.asReadonly();

  async load(): Promise<void> {
    this.entities.set(await this.api.load());
  }
}
`;
}

export function featContainerFile(feat: string): string {
  const { className, fileName } = names(feat);
  return `import { Component } from '@angular/core';

/** Smart container: wires domain-shared + feat-private state into dumb ui. */
@Component({
  selector: 'app-feat-${fileName}',
  template: \`<h2>${className}</h2>\`,
})
export class Feat${className} {}
`;
}

export function featPortFile(feat: string): string {
  const { className, fileName } = names(feat);
  return `/** FEAT-PORT: the only module sibling feats may import from feat-${fileName}. */
export interface ${className}Summary {
  id: string;
}
`;
}

export function featStoreFile(feat: string): string {
  const { className } = names(feat);
  return `import { Injectable, signal } from '@angular/core';

/** Feat-private store; may use domain-shared data (same slice family). */
@Injectable({ providedIn: 'root' })
export class ${className}Store {
  readonly busy = signal(false);
}
`;
}

/** Writes the domain-shared buckets of a slice below `root`. */
export function writeSliceBuckets(
  tree: Tree,
  root: string,
  name: string,
  preset: VerticalPreset,
): void {
  const { fileName } = names(name);
  tree.write(`${root}/${fileName}.routes.ts`, routesFile(name));
  tree.write(`${root}/types/${fileName}.model.ts`, modelFile(name));
  tree.write(`${root}/utils/${fileName}.utils.ts`, utilsFile(name));
  tree.write(`${root}/events/${fileName}.events.ts`, eventsFile(name));
  if (preset === 'inverted') {
    // BUCKET-level barrel: shortens the import to the port without merging the
    // buckets — api/ keeps its own `type:api, port` tags.
    tree.write(`${root}/api/index.ts`, apiContractFile(name));
    tree.write(`${root}/infra/http-${fileName}-api.ts`, infraFile(name));
    tree.write(`${root}/${fileName}.providers.ts`, providersFile(name));
  } else {
    tree.write(`${root}/api/${fileName}-api.ts`, apiConcreteFile(name));
  }
  tree.write(`${root}/data/${fileName}.store.ts`, storeFile(name, preset));
  tree.write(`${root}/ui/.gitkeep`, '');
}

/** Writes a feat sub-slice below `sliceRoot`. */
export function writeFeat(
  tree: Tree,
  sliceRoot: string,
  feat: string,
  preset: VerticalPreset,
): void {
  const { fileName } = names(feat);
  const root = `${sliceRoot}/feat-${fileName}`;
  tree.write(`${root}/feat-${fileName}.ts`, featContainerFile(feat));
  const featPort =
    preset === 'inverted' ? `${root}/api/index.ts` : `${root}/api/${fileName}-api.ts`;
  tree.write(featPort, featPortFile(feat));
  tree.write(`${root}/data/${fileName}.store.ts`, featStoreFile(feat));
  tree.write(`${root}/ui/.gitkeep`, '');
}
