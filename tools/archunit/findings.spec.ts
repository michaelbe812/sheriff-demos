/**
 * Verified ArchUnitTS 2.5.4 behaviour that shaped architecture.spec.ts — as assertions, so a fixed
 * upstream behaviour turns this file red (then the workaround can go).
 *
 *   vitest run --config tools/archunit/vitest.config.mts findings
 */
import { chdir } from 'node:process';
import { extractGraph, nxProjectSlices, projectFiles, projectSlices } from 'archunit';
import { TSCONFIG, WORKSPACE_ROOT } from './blueprint';

chdir(WORKSPACE_ROOT);

const collect = async (selection: ReturnType<typeof projectFiles>['inFolder'] extends (...a: never[]) => infer R ? R : never) => {
  const seen: string[] = [];
  await selection.should().adhereTo((file) => (seen.push(file.path), true), 'collect').check({ allowEmptyTests: true });
  return seen;
};

describe('ArchUnitTS 2.5.4 — verifiziertes Verhalten', () => {
  it('tsconfig-Aliase (@blueprint/…) werden auf die index.ts der Lib aufgelöst', async () => {
    const graph = await extractGraph(TSCONFIG);
    const targets = graph
      .filter((edge) => edge.source === 'libs/booking/feat-check-booking/feature/src/feat-check-booking.ts')
      .map((edge) => edge.target);
    expect(targets).toContain('libs/booking/data/src/index.ts');
  });

  it('nur `import … from` wird Kante: kein `export … from`, kein dynamisches import()', async () => {
    const graph = await extractGraph(TSCONFIG);
    const appRoutes = graph.filter((e) => e.source === 'apps/client/src/app/app.routes.ts').map((e) => e.target);
    expect(appRoutes).not.toContain('libs/booking/shell/src/index.ts'); // loadChildren: () => import('@blueprint/booking/shell')
    const barrel = graph.filter((e) => e.source === 'libs/booking/data/src/index.ts' && e.target !== e.source);
    expect(barrel).toEqual([]); // index.ts = only `export * from './…'`
  });

  it('Imports nach node_modules fehlen im Graphen (npm-Verbote nur über Dateiinhalt)', async () => {
    const graph = await extractGraph(TSCONFIG);
    const projectEdges = graph.filter((edge) => /^(libs|apps|packages)\//.test(edge.source));
    expect(projectEdges.some((edge) => edge.target.includes('node_modules'))).toBe(false);
    // the exclusion is a prefix check (`node_modules…`): d.ts files of a PARENT node_modules (this repo as a
    // nested worktree: ../../../node_modules/@types/…) still show up as graph nodes
  });

  it('Nur .ts/.tsx: JS-Dateien (packages/tooling/ng-lib) fehlen im Graphen', async () => {
    const graph = await extractGraph(TSCONFIG);
    expect(graph.some((edge) => edge.source.startsWith('packages/tooling/ng-lib/'))).toBe(false);
  });

  it('Glob mit innerem ** matcht nichts (Issue #108) — Regex nötig', async () => {
    expect(await collect(projectFiles(TSCONFIG).inFolder('libs/**/ui/**'))).toEqual([]);
    expect((await collect(projectFiles(TSCONFIG).inFolder(/(^|\/)ui(\/|$)/))).length).toBeGreaterThan(0);
  });

  it('should().dependOnFiles() ist kein "nur abhängig von": meldet Kanten ALLER Dateien', async () => {
    const violations = await projectFiles(TSCONFIG)
      .inFolder(/^libs\/booking\/ui\//)
      .should()
      .dependOnFiles()
      .inFolder(/^libs\/(booking|shared)\/(types|utils|ui)\//)
      .check();
    const sources = violations.map((v) => (v as { dependency: { sourceLabel: string } }).dependency.sourceLabel);
    expect(sources.some((source) => !source.startsWith('libs/booking/ui/'))).toBe(true);
  });

  it('projectSlices().definedBy("(**)") erfasst nur [\\w]+ — kebab-case-Ordner fallen still heraus', async () => {
    const sliced = (from: string, to: string) =>
      projectSlices(TSCONFIG).definedBy('libs/booking/(**)/').shouldNot().containDependency(from, to).check();
    // control: an existing edge between two \w-only folders below libs/booking is found
    const graph = await extractGraph(TSCONFIG);
    const folder = (path: string) => /^libs\/booking\/(\w+)\//.exec(path)?.[1];
    const control = graph.find((e) => folder(e.source) && folder(e.target) && folder(e.source) !== folder(e.target));
    expect((await sliced(folder(control!.source)!, folder(control!.target)!)).length).toBe(1);
    const kebabEdge = graph.some(
      (e) => e.source.startsWith('libs/booking/feat-check-booking/') && e.target.startsWith('libs/booking/data/'),
    );
    expect(kebabEdge).toBe(true);
    expect(await sliced('feat-check-booking', 'data')).toEqual([]); // existing edge, kebab-case: silently missed
  });

  it('nxProjectSlices liest den gecachten Nx-Graphen (Projektnamen, keine Tags, kein haveNoCycles)', async () => {
    const violations = await nxProjectSlices().shouldNot().containDependency('booking-feat-check-booking-feature', 'booking-data').check();
    expect(violations.length).toBe(1);
    expect('haveNoCycles' in nxProjectSlices().should()).toBe(false); // README shows nxProjectSlices().should().haveNoCycles()
  });
});
