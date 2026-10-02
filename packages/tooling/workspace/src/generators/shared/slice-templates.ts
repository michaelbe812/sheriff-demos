/**
 * Example sources per slice layer (libs/<slice>/<layer>), in the style of the booking/checkin
 * slices: data-access = HTTP access over ApiHttp, state = signal store on top of it, ui = dumb OnPush
 * component, shell = routes + providers + smart page. Each layer only imports what the depConstraints allow. No port: a slice is
 * only reachable through its shell (app routes).
 */
import { names } from '@nx/devkit';
import { aliasFor } from '@blueprint/tooling-conventions';

export interface LibFiles {
  /** path below `libs/<lib>/src/` → content */
  files: Record<string, string>;
  /** files re-exported from `index.ts` */
  exports: string[];
}

/** Layers whose example sources import other layers of the same slice. */
export const SLICE_LAYER_REQUIRES: Record<string, string[]> = {
  types: [],
  utils: [],
  'data-access': ['types'],
  state: ['types', 'data-access'],
  ui: ['types'],
  shell: ['state', 'ui'],
  testing: ['types'],
};

/** Order in which a new slice is generated (dependencies first). */
export const SLICE_LAYER_ORDER = ['types', 'utils', 'data-access', 'state', 'ui', 'shell', 'testing'];

export interface SliceNames {
  /** kebab-case slice name, e.g. `car-rental` */
  scope: string;
  /** entity / class prefix, e.g. `CarRental` */
  entity: string;
  /** camelCase, e.g. `carRental` */
  property: string;
  /** backend url of the example data access */
  url: string;
}

export function sliceNames(scope: string): SliceNames {
  const { className, propertyName } = names(scope);
  return { scope, entity: className, property: propertyName, url: `/api/${scope}` };
}

const alias = (n: SliceNames, layer: string): string => aliasFor(`${n.scope}/${layer}`);

const types = (n: SliceNames): LibFiles => ({
  files: {
    [`${n.scope}.model.ts`]: `/** Domain model of the ${n.scope} slice — private to the slice (no port, no foreign importer). */
export interface ${n.entity} {
  id: string;
  name: string;
}
`,
  },
  exports: [`${n.scope}.model`],
});

const utils = (n: SliceNames): LibFiles => ({
  files: {
    [`${n.scope}.utils.ts`]: `/** Pure helpers of the ${n.scope} slice (types, utils only). */
export function normalize${n.entity}Name(name: string): string {
  return name.trim().replace(/\\s+/g, ' ');
}
`,
  },
  exports: [`${n.scope}.utils`],
});

const dataAccess = (n: SliceNames): LibFiles => ({
  files: {
    [`${n.scope}-api.ts`]: `import { inject, Injectable } from '@angular/core';
import { ${n.entity} } from '${alias(n, 'types')}';
import { ApiHttp } from '@blueprint/shared/data-access';

/** HTTP access of the ${n.scope} slice (data-access layer): only its own stores and feats use it. */
@Injectable({ providedIn: 'root' })
export class ${n.entity}Api {
  private readonly http = inject(ApiHttp);

  loadAll(): Promise<${n.entity}[]> {
    return this.http.get<${n.entity}[]>('${n.url}');
  }
}
`,
  },
  exports: [`${n.scope}-api`],
});

const state = (n: SliceNames): LibFiles => ({
  files: {
    [`${n.scope}.store.ts`]: `import { computed, inject, Injectable, signal } from '@angular/core';
import { ${n.entity} } from '${alias(n, 'types')}';
import { ${n.entity}Api } from '${alias(n, 'data-access')}';

/** Slice store: provided on the slice route (provide${n.entity}() in the shell), never used by ui. */
@Injectable()
export class ${n.entity}Store {
  private readonly api = inject(${n.entity}Api);
  private readonly items = signal<${n.entity}[]>([]);

  readonly all = this.items.asReadonly();
  readonly count = computed(() => this.items().length);

  async load(): Promise<void> {
    this.items.set(await this.api.loadAll());
  }
}
`,
  },
  exports: [`${n.scope}.store`],
});

const ui = (n: SliceNames): LibFiles => ({
  files: {
    [`${n.scope}-list.ts`]: `import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ${n.entity} } from '${alias(n, 'types')}';

/** Dumb component: renders what it gets, knows only types (and utils). */
@Component({
  selector: 'app-${n.scope}-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`
    <ul>
      @for (item of items(); track item.id) {
        <li>{{ item.name }}</li>
      } @empty {
        <li>No ${n.scope} entries yet.</li>
      }
    </ul>
  \`,
})
export class ${n.entity}List {
  readonly items = input.required<${n.entity}[]>();
}
`,
  },
  exports: [`${n.scope}-list`],
});

const shell = (n: SliceNames): LibFiles => ({
  files: {
    [`${n.scope}.providers.ts`]: `import { Provider } from '@angular/core';
import { ${n.entity}Store } from '${alias(n, 'state')}';

/** Slice root (entry): providers of the ${n.scope} slice, registered on its route. */
export function provide${n.entity}(): Provider[] {
  return [${n.entity}Store];
}
`,
    [`${n.scope}-page.ts`]: `import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ${n.entity}Store } from '${alias(n, 'state')}';
import { ${n.entity}List } from '${alias(n, 'ui')}';

/** Smart page of the slice root: slice store in, dumb ui out. */
@Component({
  selector: 'app-${n.scope}-page',
  imports: [${n.entity}List],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`
    <h2>${n.entity}</h2>
    <app-${n.scope}-list [items]="store.all()" />
  \`,
})
export class ${n.entity}Page {
  protected readonly store = inject(${n.entity}Store);

  constructor() {
    void this.store.load();
  }
}
`,
    [`${n.scope}.routes.ts`]: `import { Routes } from '@angular/router';
import { ${n.entity}Page } from './${n.scope}-page';
import { provide${n.entity} } from './${n.scope}.providers';

/** Slice root (entry): the only thing the app shell wires up (lazy, app.routes.ts). Feats go into children. */
export const ${n.property}Routes: Routes = [
  {
    path: '',
    providers: [provide${n.entity}()],
    children: [{ path: '', component: ${n.entity}Page }],
  },
];
`,
  },
  exports: [`${n.scope}.routes`, `${n.scope}.providers`],
});

export const SLICE_LAYER_TEMPLATES: Record<string, (n: SliceNames) => LibFiles> = {
  types,
  utils,
  'data-access': dataAccess,
  state,
  ui,
  shell,
};

/** Example spec for the state store: MSW defaults per `beforeEach(() => worker.use(...))`, deviations per test. */
export function stateStoreSpec(n: SliceNames): { file: string; content: string } {
  return {
    file: `${n.scope}.store.spec.ts`,
    content: `import { TestBed } from '@angular/core/testing';
import { a${n.entity}, default${n.entity}Items, ${n.property}Handlers, ${n.property}Scenarios } from '${alias(n, 'testing')}';
import { test, worker } from '@blueprint/shared/testing';
import { beforeEach, describe, expect } from 'vitest';
import { ${n.entity}Store } from './${n.scope}.store';

function create${n.entity}Store(): ${n.entity}Store {
  TestBed.configureTestingModule({ providers: [${n.entity}Store] });
  return TestBed.inject(${n.entity}Store);
}

describe('${n.entity}Store', () => {
  beforeEach(() => worker.use(...${n.property}Handlers));

  test('loads the entries from the backend via the real ${n.entity}Api', async () => {
    const store = create${n.entity}Store();

    await store.load();

    expect(store.all()).toEqual(default${n.entity}Items);
  });

  test('shows whatever a single test serves', async ({ worker }) => {
    worker.use(${n.property}Scenarios.withItems([a${n.entity}({ id: '${n.scope}-1' })]));
    const store = create${n.entity}Store();

    await store.load();

    expect(store.all().map((item) => item.id)).toEqual(['${n.scope}-1']);
  });

  test('fails when the backend fails', async ({ worker }) => {
    worker.use(${n.property}Scenarios.serverError());
    const store = create${n.entity}Store();

    await expect(store.load()).rejects.toThrow('500');
    expect(store.count()).toBe(0);
  });
});
`,
  };
}
