#!/usr/bin/env node
/**
 * Negative probes for the ArchUnitTS spike: writes ONE temporary file per probe (real violation or
 * allowed edge), runs the archunit suite, records which tests fail, removes the file again (finally).
 * Optional `eslint: true` also lints the probe file with the real eslint.config.mjs (Nx boundaries)
 * for comparison.
 *
 *   node tools/archunit/negative-probes.mjs            (exit 1 if any probe does not match `expect`)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const report = join(root, 'tmp/archunit-report.json');
const NX_RULES = ['@nx/enforce-module-boundaries', 'no-restricted-imports'];

const imp = (spec) => `import { x } from '${spec}';\nexport const probe = x;\n`;
const probe = (name, file, code, expect, extra = {}) => ({ name, file, code, expect, ...extra });

// expect: 'rot' = archunit must fail, 'grün' = must pass
const probes = [
  probe('layer: ui -> data', 'libs/booking/ui/src/tmp-probe.ts', imp('@blueprint/booking/data'), 'rot'),
  probe('layer: ui -> api', 'libs/booking/ui/src/tmp-probe.ts', imp('@blueprint/booking/api'), 'rot'),
  probe('layer: utils -> api (shared)', 'libs/shared/utils/src/tmp-probe.ts', imp('@blueprint/shared/api'), 'rot'),
  probe('layer: types -> utils', 'libs/booking/types/src/tmp-probe.model.ts', imp('@blueprint/shared/utils'), 'rot'),
  probe('layer: events -> data (no cycle)', 'libs/booking/events/src/tmp-probe.events.ts', imp('@blueprint/auth/data'), 'rot'),
  probe('layer: api -> data (no cycle)', 'libs/booking/api/src/tmp-probe.ts', imp('@blueprint/auth/data'), 'rot'),
  probe('layer: data -> ui', 'libs/booking/data/src/tmp-probe.ts', imp('@blueprint/booking/ui'), 'rot'),
  probe('layer: ui -> events (erlaubt)', 'libs/booking/ui/src/tmp-probe.ts', imp('@blueprint/booking/events'), 'grün'),
  probe('layer: data -> api (erlaubt)', 'libs/booking/data/src/tmp-probe.ts', imp('@blueprint/booking/api'), 'grün'),
  probe('layer: ui -> data (type-only import)', 'libs/booking/ui/src/tmp-probe.ts', `import type { X } from '@blueprint/booking/data';\nexport type P = X;\n`, 'rot'),
  probe('scope: foreign domain internals', 'libs/checkin/data/src/tmp-probe.ts', imp('@blueprint/booking/data'), 'rot'),
  probe('scope: foreign domain via port (erlaubt)', 'libs/checkin/data/src/tmp-probe.ts', imp('@blueprint/booking/api'), 'grün'),
  probe('scope: shared-feature internals', 'libs/checkin/feat-checkin/feature/src/tmp-probe.ts', imp('@blueprint/auth/data'), 'rot'),
  probe('scope: shared-feature via port (erlaubt)', 'libs/checkin/feat-checkin/feature/src/tmp-probe.ts', imp('@blueprint/auth/api'), 'grün'),
  probe('scope: foreign entry', 'libs/booking/shell/src/tmp-probe.ts', imp('@blueprint/checkin/shell'), 'rot'),
  probe('scope: shared -> domain', 'libs/shared/utils/src/tmp-probe.ts', imp('@blueprint/checkin/utils'), 'rot'),
  probe('feat: sibling feat internals', 'libs/checkin/feat-history/feature/src/tmp-probe.ts', imp('@blueprint/checkin/feat-checkin/data'), 'rot'),
  probe('feat: sibling via feat-port (erlaubt)', 'libs/checkin/feat-history/feature/src/tmp-probe.ts', imp('@blueprint/checkin/feat-checkin/api'), 'grün'),
  probe('feat: foreign feat-port', 'libs/booking/feat-manage-booking/feature/src/tmp-probe.ts', imp('@blueprint/checkin/feat-checkin/api'), 'rot'),
  probe('app: shell -> slice internals', 'apps/client/src/app/tmp-probe.ts', imp('@blueprint/booking/ui'), 'rot'),
  probe('app: shell -> port (erlaubt)', 'apps/client/src/app/tmp-probe.ts', imp('@blueprint/booking/api'), 'grün'),
  probe('app: shell -> shared/testing', 'apps/client/src/app/tmp-probe.ts', imp('@blueprint/shared/testing'), 'rot'),
  probe('app: static import of lazy entry', 'apps/client/src/app/tmp-probe.ts', imp('@blueprint/booking/shell'), 'rot'),
  probe('testing: production -> testing', 'libs/booking/data/src/tmp-probe.ts', imp('@blueprint/booking/testing'), 'rot'),
  probe('testing: spec -> foreign domain testing (erlaubt)', 'libs/checkin/feat-checkin/feature/src/tmp-probe.spec.ts', imp('@blueprint/booking/testing'), 'grün'),
  probe('testing: shared spec -> domain testing', 'libs/shared/api/src/tmp-probe.spec.ts', imp('@blueprint/booking/testing'), 'rot'),
  probe('testing: testing -> api (port)', 'libs/booking/testing/src/tmp-probe.ts', imp('@blueprint/booking/api'), 'rot'),
  probe('testing: msw in production (api)', 'libs/booking/api/src/tmp-probe.ts', imp('msw'), 'rot'),
  probe('testing: msw in testing lib (erlaubt)', 'libs/booking/testing/src/tmp-probe.ts', imp('msw'), 'grün'),
  probe('http: HttpClient in ui', 'libs/booking/ui/src/tmp-probe.ts', imp('@angular/common/http'), 'rot'),
  probe('http: HttpClient in data', 'libs/booking/data/src/tmp-probe.ts', imp('@angular/common/http'), 'rot'),
  probe('http: HttpClient in api (erlaubt)', 'libs/booking/api/src/tmp-probe.ts', imp('@angular/common/http'), 'grün'),
  probe('types: framework-free (@angular/core)', 'libs/booking/types/src/tmp-probe.model.ts', imp('@angular/core'), 'rot'),
  probe('generated: domain port -> own client api (erlaubt)', 'libs/booking/api/src/tmp-probe.ts', imp('@blueprint/booking/generated/booking-client/api'), 'grün'),
  probe('generated: foreign domain -> domain client api', 'libs/checkin/api/src/tmp-probe.ts', imp('@blueprint/booking/generated/booking-client/api'), 'rot'),
  probe('generated: ui -> client core', 'libs/booking/ui/src/tmp-probe.ts', imp('@blueprint/booking/generated/booking-client/core'), 'rot'),
  probe('encapsulation: relative into foreign lib', 'libs/checkin/ui/src/tmp-probe.ts', imp('../../data/src/internal/checkin.mapper'), 'rot'),
  probe('encapsulation: deep alias import', 'libs/checkin/feat-checkin/data/src/tmp-probe.ts', imp('@blueprint/checkin/data/src/internal/checkin.mapper'), 'rot'),
  probe('cycle: booking/data -> feat-check-booking/data', 'libs/booking/data/src/tmp-probe.ts', imp('@blueprint/booking/feat-check-booking/data'), 'rot'),
  probe('tooling: conventions -> openapi', 'packages/tooling/conventions/src/tmp-probe.ts', imp('@blueprint/tooling-openapi'), 'rot'),
  probe('struktur: lib außerhalb des Schemas (noTag)', 'libs/booking/tmp-probe/src/index.ts', 'export const probe = 1;\n', 'rot'),
  probe('naming: .events.ts in data', 'libs/booking/data/src/tmp-probe.events.ts', 'export const probe = 1;\n', 'rot'),
  probe('naming: Datei nicht kebab-case', 'libs/booking/ui/src/TmpProbe.ts', 'export const probe = 1;\n', 'rot'),
  // known gaps of archunit's graph (only `import … from` declarations become edges)
  probe('lücke: re-export ui -> data (export * from)', 'libs/booking/ui/src/tmp-probe.ts', `export * from '@blueprint/booking/data';\n`, 'rot', { eslint: true }),
  probe('lücke: dynamic import() foreign slice internals', 'libs/booking/ui/src/tmp-probe.ts', `export const load = () => import('@blueprint/checkin/data');\n`, 'rot', { eslint: true }),
  probe('lücke: require() of msw', 'libs/booking/data/src/tmp-probe.ts', `// eslint-disable-next-line @typescript-eslint/no-require-imports\nexport const m = require('msw');\n`, 'rot', { eslint: true }),
];

function runSuite() {
  rmSync(report, { force: true });
  spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'tools/archunit/vitest.config.mts', 'architecture', '--reporter=json', `--outputFile=${report}`], { cwd: root, stdio: 'ignore' });
  const json = JSON.parse(readFileSync(report, 'utf-8'));
  return json.testResults.flatMap((file) => file.assertionResults).filter((t) => t.status === 'failed').map((t) => t.fullName);
}

function eslintFires(file) {
  try {
    execFileSync('pnpm', ['exec', 'eslint', '--format', 'json', file], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [];
  } catch (error) {
    const [result] = JSON.parse(error.stdout);
    return result.messages.filter((m) => NX_RULES.includes(m.ruleId)).map((m) => m.ruleId);
  }
}

const baseline = runSuite();
if (baseline.length) {
  console.error('Baseline not green:', baseline);
  process.exit(1);
}

let mismatches = 0;
const rows = [];
for (const p of probes) {
  const abs = join(root, p.file);
  const createdDir = !existsSync(dirname(abs));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, p.code);
  try {
    const failed = runSuite();
    const result = failed.length ? 'rot' : 'grün';
    const nx = p.eslint ? (eslintFires(p.file).length ? 'rot' : 'grün') : '';
    if (result !== p.expect) mismatches++;
    rows.push({ probe: p.name, erwartet: p.expect, archunit: result, ok: result === p.expect ? '✓' : '✗', nx, tests: failed.join(' | ') });
  } finally {
    rmSync(createdDir ? join(root, p.file.split('/').slice(0, 3).join('/')) : abs, { recursive: true, force: true });
  }
}
console.log('| Fall | erwartet | ArchUnitTS | ok | Nx-ESLint | rote Tests |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.probe} | ${r.erwartet} | ${r.archunit} | ${r.ok} | ${r.nx} | ${r.tests} |`);
console.log(`\n${probes.length - mismatches}/${probes.length} Proben wie erwartet`);
process.exit(mismatches ? 1 : 0);
