/**
 * Example sources of a feat (libs/<slice>/feat-<feat>/…): feature = smart container (lazy route of
 * the slice shell), api = feat-port for sibling feats, data = feat store, ui = dumb view.
 */
import { names } from '@nx/devkit';
import { aliasFor } from '../../plugin/lib-conventions';
import type { LibFiles } from './slice-templates';

export interface FeatNames {
  scope: string;
  /** kebab-case feat name without `feat-` */
  feat: string;
  /** e.g. `Checkout` */
  className: string;
  /** e.g. `checkout` */
  property: string;
  /** container component class, e.g. `FeatCheckout` (exported from the feature lib) */
  container: string;
  /** libs path of the feat folder, e.g. `payment/feat-checkout` */
  featPath: string;
}

export function featNames(scope: string, feat: string): FeatNames {
  const { className, propertyName } = names(feat);
  return { scope, feat, className, property: propertyName, container: `Feat${className}`, featPath: `${scope}/feat-${feat}` };
}

export interface FeatParts {
  api: boolean;
  data: boolean;
  ui: boolean;
}

const alias = (n: FeatNames, layer: string): string => aliasFor(`${n.featPath}/${layer}`);

export const featApi = (n: FeatNames): LibFiles => ({
  files: {
    [`${n.feat}-api.ts`]: `/**
 * FEAT-PORT: the only lib sibling feats may import from feat-${n.feat}.
 * Never visible outside the ${n.scope} slice.
 */
export interface ${n.className}Summary {
  selected: string | null;
}

export function describe${n.className}(summary: ${n.className}Summary): string {
  return summary.selected ? \`Selected: \${summary.selected}\` : 'Nothing selected';
}
`,
  },
  exports: [`${n.feat}-api`],
});

export const featData = (n: FeatNames, parts: FeatParts): LibFiles => {
  const apiImport = parts.api ? `import { describe${n.className} } from '${alias(n, 'api')}';\n` : '';
  const summary = parts.api ? `\n  readonly summary = computed(() => describe${n.className}({ selected: this.selected() }));\n` : '';
  return {
    files: {
      [`${n.feat}.store.ts`]: `import { ${parts.api ? 'computed, ' : ''}Injectable, signal } from '@angular/core';
${apiImport}
/** Feat-private store, provided by the feat container (${n.container}.providers). */
@Injectable()
export class ${n.className}Store {
  private readonly entries = signal<string[]>(['first', 'second']);

  readonly items = this.entries.asReadonly();
  readonly selected = signal<string | null>(null);
${summary}
  select(item: string): void {
    this.selected.set(item);
  }
}
`,
    },
    exports: [`${n.feat}.store`],
  };
};

export const featUi = (n: FeatNames): LibFiles => ({
  files: {
    [`${n.feat}-view.ts`]: `import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Dumb view of feat-${n.feat}: inputs in, events out. */
@Component({
  selector: 'app-${n.feat}-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`
    <ul>
      @for (item of items(); track item) {
        <li>
          <button type="button" (click)="selected.emit(item)">{{ item }}</button>
        </li>
      } @empty {
        <li>Nothing here yet.</li>
      }
    </ul>
  \`,
})
export class ${n.className}View {
  readonly items = input.required<string[]>();
  readonly selected = output<string>();
}
`,
  },
  exports: [`${n.feat}-view`],
});

export const featFeature = (n: FeatNames, parts: FeatParts): LibFiles => {
  const imports = [
    `import { ChangeDetectionStrategy, Component${parts.data ? ', inject' : ''} } from '@angular/core';`,
    parts.data ? `import { ${n.className}Store } from '${alias(n, 'data')}';` : '',
    parts.ui ? `import { ${n.className}View } from '${alias(n, 'ui')}';` : '',
  ].filter(Boolean);
  const view = parts.ui
    ? `<app-${n.feat}-view [items]="${parts.data ? 'store.items()' : '[]'}"${parts.data ? ' (selected)="store.select($event)"' : ''} />`
    : parts.data
      ? `<p>{{ store.items().length }} entries</p>`
      : `<p>feat-${n.feat} works.</p>`;
  const summary = parts.data && parts.api ? `\n    <p>{{ store.summary() }}</p>` : '';
  return {
    files: {
      [`feat-${n.feat}.ts`]: `${imports.join('\n')}

/** Smart container of feat-${n.feat} (lazy route of the ${n.scope} shell). */
@Component({
  selector: 'app-feat-${n.feat}',${parts.ui ? `\n  imports: [${n.className}View],` : ''}${parts.data ? `\n  providers: [${n.className}Store],` : ''}
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`
    <h2>${n.className}</h2>
    ${view}${summary}
  \`,
})
export class ${n.container} {${parts.data ? `\n  protected readonly store = inject(${n.className}Store);\n` : ''}}
`,
    },
    exports: [`feat-${n.feat}`],
  };
};
