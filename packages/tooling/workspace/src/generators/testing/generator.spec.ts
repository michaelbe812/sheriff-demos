import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBlueprintTree, read } from '@blueprint/tooling-conventions/testing';
import { testingGenerator } from './generator';

describe('testing generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('scaffolds fixtures + handlers + scenarios on top of the domain types', async () => {
    await testingGenerator(tree, { domain: 'booking' });

    expect(read(tree, 'libs/booking/testing/src/fixtures/booking.fixture.ts')).toContain(
      "import { Booking } from '@blueprint/booking/types';",
    );
    const handlers = read(tree, 'libs/booking/testing/src/handlers/booking.handlers.ts');
    expect(handlers).toContain("import { http, HttpResponse } from 'msw';");
    expect(handlers).toContain('export const bookingHandlers');
    expect(handlers).toContain('serverError: () =>');
  });

  it('declares the backend shape itself when the types lib has no entity', async () => {
    tree.write('libs/layout/types/src/index.ts', 'export {};\n');

    await testingGenerator(tree, { domain: 'layout' });

    const fixture = read(tree, 'libs/layout/testing/src/fixtures/layout.fixture.ts');
    expect(fixture).toContain('export interface Layout {');
    expect(fixture).not.toContain("from '@blueprint/layout/types'");
  });

  it('keeps an existing testing lib and rejects unknown domains', async () => {
    tree.write('libs/booking/testing/src/index.ts', '// mine\n');
    await testingGenerator(tree, { domain: 'booking' });
    expect(read(tree, 'libs/booking/testing/src/index.ts')).toBe('// mine\n');

    await expect(testingGenerator(tree, { domain: 'bokking' })).rejects.toThrow('Unknown scope "bokking"');
  });
});
