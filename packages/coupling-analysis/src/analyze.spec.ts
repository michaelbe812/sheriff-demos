import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze, type CouplingReport } from './analyze.ts';
import { mergeConfig } from './config.ts';
import { toJson, toMarkdown } from './report.ts';
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts';

/**
 * A legacy-style app (folders under src/app, imports between features) that shows every indicator once:
 * orders ↔ billing (mutual), shared → catalog (direction), catalog/product used by shipping + reviews
 * (shared candidate), reviews/rating only used by shipping (misplaced; no moves inside the merge pair),
 * orders + payments changed
 * together without imports (hidden coupling).
 */
describe('analyze (patterns, legacy repo)', () => {
  let repo: FixtureRepo;
  let report: CouplingReport;
  const config = mergeConfig({
    slices: ['src/app/{slice}/**'],
    shared: ['shared'],
    thresholds: { minSharedCommits: 2, changeCouplingDegree: 0.3, minFileRevisions: 2, fileChangeCouplingDegree: 0.5, maxListed: 20 },
  });

  beforeAll(async () => {
    repo = createFixtureRepo();
    repo.commit('feat: initial', {
      'src/main.ts': `import './app/orders/order';`,
      'src/app/orders/order.ts': `import { invoice } from '../billing/invoice';\nexport const order = invoice;`,
      'src/app/orders/order-status.ts': `export const status = 'open';`,
      'src/app/billing/invoice.ts': `import { status } from '../orders/order-status';\nexport const invoice = status;`,
      'src/app/catalog/product.ts': `import { money } from '../shared/money';\nexport const product = money;`,
      'src/app/catalog/product-type.ts': `export type ProductType = string;`,
      'src/app/shared/money.ts': `import type { ProductType } from '../catalog/product-type';\nexport const money: ProductType = '1 €';`,
      'src/app/shipping/shipment.ts': `import { product } from '../catalog/product';\nimport { rating } from '../reviews/rating';\nexport const shipment = [product, rating];`,
      'src/app/shipping/label.ts': `import { rating } from '../reviews/rating';\nexport const label = rating;`,
      'src/app/reviews/review.ts': `import { product } from '../catalog/product';\nexport const review = product;`,
      'src/app/reviews/rating.ts': `export const rating = 5;`,
      'src/app/payments/payment.ts': `export const payment = 1;`,
      'src/app/orders/order.spec.ts': `import '../payments/payment';`,
    });
    for (const round of [1, 2, 3]) {
      repo.commit(`feat: checkout ${round}`, {
        'src/app/orders/order-status.ts': `export const status = 'open-${round}';`,
        'src/app/payments/payment.ts': `export const payment = ${round};`,
      });
    }
    report = await analyze({ repo: repo.root, config });
  });

  afterAll(() => repo.dispose());

  it('finds the cross-slice imports (specs excluded, unassigned files counted)', () => {
    expect(report.staticCoupling.pairs.map(({ from, to, imports }) => `${from}→${to}:${imports}`)).toEqual([
      'billing→orders:1',
      'catalog→shared:1',
      'orders→billing:1',
      'reviews→catalog:1',
      'shared→catalog:1',
      'shipping→catalog:1',
      'shipping→reviews:2',
    ]);
    expect(report.staticCoupling.cycles).toEqual([
      ['billing', 'orders'],
      ['catalog', 'shared'],
    ]);
    expect(report.meta).toMatchObject({ sliceMode: 'patterns', analyzedFiles: 12, unassignedFiles: 1, commitsRead: 4, commitsAnalyzed: 4 });
  });

  it('derives one indicator per smell, ordered by migration step', () => {
    expect(report.findings.map(({ step, kind, slices, files }) => [step, kind, slices.join('+'), files.join()])).toEqual([
      ['merge', 'mutual-dependency', 'billing+orders', 'src/app/billing/invoice.ts,src/app/orders/order-status.ts'],
      ['fix-direction', 'shared-depends-on-slice', 'shared+catalog', 'src/app/catalog/product-type.ts'],
      ['move-file', 'misplaced-file', 'reviews+shipping', 'src/app/reviews/rating.ts'],
      ['move-file', 'move-into-slice', 'shared+catalog', 'src/app/shared/money.ts'],
      ['extract-shared', 'shared-candidate', 'catalog+reviews+shipping', 'src/app/catalog/product.ts'],
      ['invert', 'stable-dependency', 'reviews+catalog', 'src/app/catalog/product.ts'],
      ['invert', 'stable-dependency', 'shipping+catalog', 'src/app/catalog/product.ts'],
      ['invert', 'stable-dependency', 'shipping+reviews', 'src/app/reviews/rating.ts'],
      ['review-cut', 'hidden-coupling', 'orders+payments', 'src/app/orders/order-status.ts,src/app/payments/payment.ts'],
    ]);
  });

  it('proposes the cut', () => {
    expect(report.proposal).toEqual({ clusters: [['billing', 'orders']], standalone: ['catalog', 'payments', 'reviews', 'shipping'] });
  });

  it('measures change coupling with the Tornhill degree', () => {
    expect(report.changeCoupling.pairs[0]).toEqual({ a: 'orders', b: 'payments', shared: 3, revisionsA: 4, revisionsB: 3, degree: 0.86 });
  });

  it('is deterministic', async () => {
    const again = await analyze({ repo: repo.root, config });
    expect(toJson(again)).toBe(toJson(report));
    expect(toMarkdown(again)).toBe(toMarkdown(report));
  });

  it('renders the markdown report', () => {
    const markdown = toMarkdown(report);
    expect(markdown).toContain('**6** unerwartete Kanten zwischen Slices');
    expect(markdown).toContain('- **billing + orders**');
    expect(markdown).toContain('s_shipping ==>|2| s_reviews');
    expect(markdown).toContain('s_catalog -.->|1| s_shared');
  });
});

describe('analyze (nx, scope tags + tsconfig paths)', () => {
  let repo: FixtureRepo;

  beforeAll(() => {
    repo = createFixtureRepo();
    const project = (name: string, tags: string[], projectType = 'library') => JSON.stringify({ name, projectType, tags });
    repo.commit('feat: workspace', {
      'nx.json': '{}',
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@x/a/ui': ['libs/a/ui/src/index.ts'], '@x/b/data': ['libs/b/data/src/index.ts'] } },
      }),
      'apps/web/project.json': project('web', ['type:app'], 'application'),
      'apps/web/src/main.ts': `import { a } from '@x/a/ui';\nconsole.log(a);`,
      'libs/a/ui/project.json': project('a-ui', ['scope:a', 'type:ui']),
      'libs/a/ui/src/index.ts': `import { b } from '@x/b/data';\nexport const a = b;`,
      'libs/b/data/project.json': project('b-data', ['scope:b', 'type:data']),
      'libs/b/data/src/index.ts': `export const b = 1;`,
    });
  });

  afterAll(() => repo.dispose());

  it('slices by scope tag, apps by name, aliases resolved', async () => {
    const report = await analyze({ repo: repo.root, config: mergeConfig({}) });
    expect(report.meta.sliceMode).toBe('nx');
    expect(report.slices).toEqual([
      { slice: 'a', role: 'slice', folders: ['libs/a/ui/'] },
      { slice: 'b', role: 'slice', folders: ['libs/b/data/'] },
      { slice: 'web', role: 'app', folders: ['apps/web/'] },
    ]);
    expect(report.staticCoupling.pairs.map(({ from, to }) => `${from}→${to}`)).toEqual(['a→b', 'web→a']);
    expect(report.findings.map(({ kind, slices }) => `${kind}:${slices.join('+')}`)).toEqual(['stable-dependency:a+b']);
  });
});
