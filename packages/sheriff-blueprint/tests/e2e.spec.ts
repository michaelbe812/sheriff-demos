import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Integration tests against the REAL workspace: the root sheriff.config.ts
 * consumes createSheriffConfig() from this package, eslint.config.mjs uses
 * sheriff.configs.all — so these tests prove the whole chain
 * (package -> sheriff -> eslint) end to end.
 */

const workspaceRoot = join(__dirname, '..', '..', '..');
const tmpFiles: string[] = [];

function writeTmp(relPath: string, content: string): string {
  const abs = join(workspaceRoot, relPath);
  writeFileSync(abs, content);
  tmpFiles.push(abs);
  return relPath;
}

/** Runs eslint on one file; returns its output (exit code 1 = violations). */
function eslintOn(relPath: string): string {
  try {
    return execSync(`npx eslint ${relPath}`, { cwd: workspaceRoot, encoding: 'utf-8', stdio: 'pipe' });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

afterEach(() => {
  for (const file of tmpFiles.splice(0)) {
    if (existsSync(file)) rmSync(file);
  }
});

describe('sheriff CLI on the real workspace', () => {
  it('verify passes for all entry points', () => {
    const output = execSync('npx sheriff verify', { cwd: workspaceRoot, encoding: 'utf-8', stdio: 'pipe' });
    expect(output).toContain('All projects validated successfully');
  });
});

describe('eslint dependency-rule fires through the packaged config', () => {
  it('blocks utils -> api (layer matrix holds inside shared)', () => {
    const file = writeTmp(
      'apps/client/src/app/shared/utils/tmp-e2e-viol.ts',
      `import { ApiHttp } from '../api/http-client';\nexport const x = ApiHttp;\n`,
    );
    const output = eslintOn(file);
    expect(output).toContain('@softarc/sheriff/dependency-rule');
    expect(output).toContain('type:utils');
  });

  it('blocks cross-domain internals (port bypass)', () => {
    const file = writeTmp(
      'apps/client/src/app/domains/checkin/data/tmp-e2e-viol.ts',
      `import { BookingStore } from '@blueprint/domains/booking/data/booking.store';\nexport const x = BookingStore;\n`,
    );
    const output = eslintOn(file);
    expect(output).toContain('@softarc/sheriff/dependency-rule');
    expect(output).toContain('domain:booking');
  });

  it('allows cross-domain access via the port', () => {
    const file = writeTmp(
      'apps/client/src/app/domains/checkin/data/tmp-e2e-ok.ts',
      `import { BookingApi } from '@blueprint/domains/booking/api';\nexport const x = BookingApi;\n`,
    );
    const output = eslintOn(file);
    expect(output).not.toContain('@softarc/sheriff/dependency-rule');
  });

  it('blocks imports from a foreign internal/ folder (encapsulation)', () => {
    const file = writeTmp(
      'apps/client/src/app/domains/checkin/utils/tmp-e2e-viol.ts',
      `import { toCheckinRecord } from '../data/internal/checkin.mapper';\nexport const x = toCheckinRecord;\n`,
    );
    const output = eslintOn(file);
    expect(output).toContain('@softarc/sheriff/encapsulation');
  });

  it('blocks sibling feat internals but allows the feat-port', () => {
    const viol = writeTmp(
      'apps/client/src/app/domains/checkin/feat-history/tmp-e2e-viol.ts',
      `import { CheckinDeskStore } from '../feat-checkin/data/checkin-desk.store';\nexport const x = CheckinDeskStore;\n`,
    );
    expect(eslintOn(viol)).toContain('feat:history');

    const ok = writeTmp(
      'apps/client/src/app/domains/checkin/feat-history/tmp-e2e-ok.ts',
      `import { describeDesk } from '../feat-checkin/api/checkin-desk-api';\nexport const x = describeDesk;\n`,
    );
    expect(eslintOn(ok)).not.toContain('@softarc/sheriff/dependency-rule');
  });
});

/**
 * The port is a CONTRACT, its impl lives in infra/. These four tests are the
 * teeth behind that claim — without them "inverted" is a code comment.
 */
describe('inverted domain ports: infra/ is unreachable, api/ is the seam', () => {
  it('blocks a foreign domain from reaching booking/infra', () => {
    const file = writeTmp(
      'apps/client/src/app/domains/checkin/data/tmp-e2e-infra-viol.ts',
      `import { HttpBookingApi } from '@blueprint/domains/booking/infra/http-booking-api';\nexport const x = HttpBookingApi;\n`,
    );
    const output = eslintOn(file);
    // Blocked on the SCOPE axis before type:infra is ever consulted: infra/
    // carries no `port` tag, so `domain:checkin` has no clearance towards it.
    // Belt and braces — the type axis (next test) is the second lock.
    expect(output).toContain('@softarc/sheriff/dependency-rule');
    expect(output).toContain('domain:checkin');
  });

  it('blocks a store from binding to the impl instead of the token', () => {
    // type:data -> type:infra. The whole point: a store cannot name the HTTP
    // class even inside its own slice; only the slice root wires them.
    const file = writeTmp(
      'libs/domains/booking/src/data/tmp-e2e-infra-viol.ts',
      `import { HttpBookingApi } from '../infra/http-booking-api';\nexport const x = HttpBookingApi;\n`,
    );
    const output = eslintOn(file);
    expect(output).toContain('@softarc/sheriff/dependency-rule');
    expect(output).toContain('type:data');
  });

  it('blocks the contract from naming its own implementation', () => {
    // type:api -> type:infra. If this were allowed the arrow would point at
    // infrastructure again and the inversion would be decorative.
    const file = writeTmp(
      'libs/domains/booking/src/api/tmp-e2e-infra-viol.ts',
      `import { HttpBookingApi } from '../infra/http-booking-api';\nexport const x = HttpBookingApi;\n`,
    );
    const output = eslintOn(file);
    expect(output).toContain('@softarc/sheriff/dependency-rule');
    expect(output).toContain('type:api');
  });

  it('blocks a feat from reaching its own slice\'s infra', () => {
    // type:feature -> type:infra. A feat root carries `type:feature`, same as
    // the slice root, so a naive `to.startsWith('type:')` let it name the HTTP
    // class directly and walk past the port. The rule distinguishes them by
    // the `entry` tag, which only the slice root has.
    const file = writeTmp(
      'libs/domains/booking/src/feat-manage-booking/tmp-e2e-infra-viol.ts',
      `import { HttpBookingApi } from '../infra/http-booking-api';\nexport const x = HttpBookingApi;\n`,
    );
    const output = eslintOn(file);
    expect(output).toContain('@softarc/sheriff/dependency-rule');
    expect(output).toContain('type:feature');
  });

  it('still allows the slice root to wire the token onto the impl', () => {
    // The counterpart to the test above: if this broke, the block would have
    // cost us the one place that legitimately names both sides.
    const file = writeTmp(
      'libs/domains/booking/src/tmp-e2e-infra-ok.ts',
      `import { HttpBookingApi } from './infra/http-booking-api';\nexport const x = HttpBookingApi;\n`,
    );
    expect(eslintOn(file)).not.toContain('@softarc/sheriff/dependency-rule');
  });

  it('allows a foreign domain to bind to the port contract', () => {
    const file = writeTmp(
      'apps/client/src/app/domains/checkin/data/tmp-e2e-infra-ok.ts',
      `import { BookingApi } from '@blueprint/domains/booking/api';\nexport const x = BookingApi;\n`,
    );
    expect(eslintOn(file)).not.toContain('@softarc/sheriff/dependency-rule');
  });
});
