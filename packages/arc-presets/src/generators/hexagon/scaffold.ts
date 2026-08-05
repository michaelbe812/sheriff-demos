import { names, Tree } from '@nx/devkit';

/**
 * File templates for a hexagon slice (Ports & Adapters).
 *   fwcore — domain/ holds models + rules + use-cases + store (knows Angular)
 *   strict — domain/ is framework-free; application/ holds use-cases + store
 */

export type HexPreset = 'hexagonal-fwcore' | 'hexagonal-strict';

function modelFile(name: string): string {
  const { className } = names(name);
  return `/** Pure domain model — no framework, no I/O. */
export interface ${className} {
  id: string;
}
`;
}

function portInFile(name: string): string {
  const { className } = names(name);
  return `import { ${className} } from '../../domain/${names(name).fileName}.model';

/**
 * ports/in — the public face of the slice (\`port\`). The ONLY cross-slice
 * surface. Driving adapters and other slices bind to this.
 */
export abstract class ${className}Facade {
  abstract load(): Promise<${className}[]>;
}
`;
}

function portOutFile(name: string): string {
  const { className } = names(name);
  return `import { ${className} } from '../../domain/${names(name).fileName}.model';

/** ports/out — what the core needs from the world. Private to the slice. */
export abstract class ${className}Repository {
  abstract findAll(): Promise<${className}[]>;
}
`;
}

/** fwcore: store lives in the core. */
function coreStoreFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { inject, Injectable, signal } from '@angular/core';
import { ${className}Repository } from '../ports/out/${fileName}.repository';
import { ${className}Facade } from '../ports/in/${fileName}.facade';
import { ${className} } from './${fileName}.model';

/**
 * The core use-case + store. Framework-aware (DI, signals) but reaches only
 * its own ports — never a driven adapter directly.
 */
@Injectable({ providedIn: 'root' })
export class ${className}Store extends ${className}Facade {
  private readonly repo = inject(${className}Repository);
  private readonly entities = signal<${className}[]>([]);
  readonly all = this.entities.asReadonly();

  async load(): Promise<${className}[]> {
    const found = await this.repo.findAll();
    this.entities.set(found);
    return found;
  }
}
`;
}

/** strict: use-case + store live in application/, core stays framework-free. */
function appStoreFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { inject, Injectable, signal } from '@angular/core';
import { ${className}Repository } from '../ports/out/${fileName}.repository';
import { ${className}Facade } from '../ports/in/${fileName}.facade';
import { ${className} } from '../domain/${fileName}.model';

/**
 * application/ — use-cases + signal store. Everything with inject() lives here
 * so the domain core can stay framework-free.
 */
@Injectable({ providedIn: 'root' })
export class ${className}Store extends ${className}Facade {
  private readonly repo = inject(${className}Repository);
  private readonly entities = signal<${className}[]>([]);
  readonly all = this.entities.asReadonly();

  async load(): Promise<${className}[]> {
    const found = await this.repo.findAll();
    this.entities.set(found);
    return found;
  }
}
`;
}

function drivenAdapterFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { Injectable } from '@angular/core';
import { ${className}Repository } from '../../ports/out/${fileName}.repository';
import { ${className} } from '../../domain/${fileName}.model';

/** adapters/driven — the impure edge. Implements ports/out. */
@Injectable({ providedIn: 'root' })
export class Http${className}Repository extends ${className}Repository {
  async findAll(): Promise<${className}[]> {
    const res = await fetch('/api/${fileName}');
    return (await res.json()) as ${className}[];
  }
}
`;
}

function drivingComponentFile(name: string): string {
  const { className, fileName } = names(name);
  return `import { Component, inject } from '@angular/core';
import { ${className}Facade } from '../../ports/in/${fileName}.facade';

/** adapters/driving — UI. Sees ports/in (the facade). NEVER ports/out or HTTP. */
@Component({
  selector: 'app-${fileName}',
  template: \`<h2>${className}</h2>\`,
})
export class ${className}Page {
  protected readonly facade = inject(${className}Facade);
}
`;
}

function providersFile(name: string, preset: HexPreset): string {
  const { className, fileName } = names(name);
  const storeImport =
    preset === 'hexagonal-strict'
      ? `import { ${className}Store } from '../application/${fileName}.store';`
      : `import { ${className}Store } from '../domain/${fileName}.store';`;
  return `import { Provider } from '@angular/core';
import { ${className}Facade } from './in/${fileName}.facade';
import { ${className}Repository } from './out/${fileName}.repository';
import { Http${className}Repository } from '../adapters/driven/http-${fileName}.repository';
${storeImport}

/** Slice composition root — the only place that wires adapters onto ports. */
export function provide${className}(): Provider[] {
  return [
    { provide: ${className}Facade, useExisting: ${className}Store },
    { provide: ${className}Repository, useClass: Http${className}Repository },
  ];
}
`;
}

function routesFile(name: string): string {
  return `import { Routes } from '@angular/router';

/** Slice root (entry): the only thing app.routes.ts may see. */
const ${names(name).propertyName}Routes: Routes = [];

export default ${names(name).propertyName}Routes;
`;
}

/** Writes a full hexagon slice below `root`. */
export function writeHexSlice(
  tree: Tree,
  root: string,
  name: string,
  preset: HexPreset,
): void {
  const { fileName } = names(name);
  tree.write(`${root}/${fileName}.routes.ts`, routesFile(name));
  tree.write(`${root}/domain/${fileName}.model.ts`, modelFile(name));
  tree.write(`${root}/ports/in/${fileName}.facade.ts`, portInFile(name));
  tree.write(`${root}/ports/out/${fileName}.repository.ts`, portOutFile(name));
  if (preset === 'hexagonal-strict') {
    tree.write(`${root}/application/${fileName}.store.ts`, appStoreFile(name));
  } else {
    tree.write(`${root}/domain/${fileName}.store.ts`, coreStoreFile(name));
  }
  tree.write(
    `${root}/adapters/driven/http-${fileName}.repository.ts`,
    drivenAdapterFile(name),
  );
  tree.write(
    `${root}/adapters/driving/${fileName}.page.ts`,
    drivingComponentFile(name),
  );
  tree.write(`${root}/ports/${fileName}.providers.ts`, providersFile(name, preset));
}
