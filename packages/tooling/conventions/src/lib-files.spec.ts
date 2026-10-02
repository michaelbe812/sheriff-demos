import { describe, expect, it } from 'vitest';
import { libConfigFiles, libPathsEntry, offsetFromRoot, relocateConfig, replacePaths } from './lib-files';

const scopes = ['booking', 'shared'];

describe('libConfigFiles', () => {
  it('buildable lib: project.json (tags from the path), package.json, ng-package.json, tsconfigs', () => {
    const files = libConfigFiles('booking/feat-check-booking/state', {
      scopes,
      peerDependencies: { rxjs: '^7.0.0', '@angular/core': '^22.0.0' },
    });
    expect(Object.keys(files)).toEqual([
      'project.json',
      'tsconfig.json',
      'package.json',
      'ng-package.json',
      'tsconfig.lib.json',
      'tsconfig.lib.prod.json',
    ]);
    expect(files['project.json']).toEqual({
      name: 'booking-feat-check-booking-state',
      $schema: '../../../../node_modules/nx/schemas/project-schema.json',
      projectType: 'library',
      sourceRoot: 'libs/booking/feat-check-booking/state/src',
      tags: ['scope:booking', 'type:state', 'feat:check-booking'],
      targets: { build: {}, lint: {}, typecheck: {} },
    });
    // sorted peers, key order as ng-packagr copies it into dist
    expect(JSON.stringify(files['package.json'])).toBe(
      '{"name":"@blueprint/booking/feat-check-booking/state","version":"0.0.1","private":true,"peerDependencies":{"@angular/core":"^22.0.0","rxjs":"^7.0.0"},"sideEffects":false}',
    );
    expect(files['ng-package.json']).toMatchObject({ dest: '../../../../dist/libs/booking/feat-check-booking/state' });
    expect(files['tsconfig.lib.json']).toMatchObject({ exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'] });
  });

  it('testing lib: no build files; specs: tsconfig.spec.json + test; extra targets + edges', () => {
    const testing = libConfigFiles('booking/testing', { scopes });
    expect(Object.keys(testing)).toEqual(['project.json', 'tsconfig.json']);
    expect(testing['project.json']['targets']).toEqual({ lint: {}, typecheck: {} });

    const withSpecs = libConfigFiles('shared/state', {
      scopes,
      hasSpecs: true,
      implicitDependencies: ['x'],
      targets: { lint: { dependsOn: ['generate'] } },
    });
    expect(withSpecs['project.json']).toMatchObject({
      implicitDependencies: ['x'],
      targets: { build: {}, lint: { dependsOn: ['generate'] }, typecheck: {}, test: {} },
    });
    expect(withSpecs['tsconfig.spec.json']).toMatchObject({ include: ['src/**/*.spec.ts', 'src/**/*.d.ts'] });
    expect(withSpecs['package.json']).not.toHaveProperty('peerDependencies');
  });

  it('fails for a path outside the convention', () => {
    expect(() => libConfigFiles('bokking/ui', { scopes })).toThrow('unknown scope "bokking"');
  });

  it('paths entry and offsets', () => {
    expect(libPathsEntry('shared/ui')).toEqual(['@blueprint/shared/ui', ['./libs/shared/ui/src/index.ts']]);
    expect(offsetFromRoot('libs/a/b/')).toBe('../../../');
  });
});

describe('relocateConfig / replacePaths', () => {
  it('rewrites the path-dependent fields, keeps the rest', () => {
    const files = libConfigFiles('booking/state', { scopes, hasSpecs: true });
    const project = {
      ...files['project.json'],
      targets: { build: {}, custom: { options: { file: 'libs/booking/state/x.json' } } },
    };
    expect(relocateConfig('project.json', project, 'booking/state', 'booking/feat-a/state', { scopes })).toMatchObject({
      name: 'booking-feat-a-state',
      $schema: '../../../../node_modules/nx/schemas/project-schema.json',
      sourceRoot: 'libs/booking/feat-a/state/src',
      tags: ['scope:booking', 'type:state', 'feat:a'],
      targets: { build: {}, custom: { options: { file: 'libs/booking/feat-a/state/x.json' } } },
    });
    const peers = { ...files['package.json'], peerDependencies: { rxjs: '^7.0.0' } };
    expect(relocateConfig('package.json', peers, 'booking/state', 'shared/state', { scopes })).toMatchObject({
      name: '@blueprint/shared/state',
      peerDependencies: { rxjs: '^7.0.0' },
    });
    expect(
      relocateConfig('ng-package.json', files['ng-package.json'], 'booking/state', 'booking/feat-a/state'),
    ).toMatchObject({
      dest: '../../../../dist/libs/booking/feat-a/state',
    });
    expect(
      relocateConfig('tsconfig.json', files['tsconfig.json'], 'booking/state', 'booking/feat-a/state'),
    ).toMatchObject({
      extends: '../../../../tsconfig.base.json',
    });
    expect(
      relocateConfig('tsconfig.spec.json', files['tsconfig.spec.json'], 'booking/state', 'booking/feat-a/state'),
    ).toMatchObject({
      compilerOptions: { outDir: '../../../../dist/out-tsc/spec', noEmit: false },
    });
    expect(relocateConfig('tsconfig.lib.prod.json', { extends: './tsconfig.lib.json' }, 'a/b', 'c/d')).toEqual({
      extends: './tsconfig.lib.json',
    });
  });

  it('replaces libs/<from>, the client path and clients.<from> — never a longer name', () => {
    const value = {
      inputs: [
        '{workspaceRoot}/libs/generated/x-client/openapi.yaml',
        { json: '{workspaceRoot}/openapi-clients.json', fields: ['defaultAdapter', 'clients.generated/x-client'] },
        '{workspaceRoot}/libs/generated/x-client-2/openapi.yaml',
        { runtime: 'java -version 2>&1' },
      ],
      options: { client: 'generated/x-client', other: 'generated/x-client-2' },
      cache: true,
    };
    expect(replacePaths(value, 'generated/x-client', 'booking/generated/y-client')).toEqual({
      inputs: [
        '{workspaceRoot}/libs/booking/generated/y-client/openapi.yaml',
        {
          json: '{workspaceRoot}/openapi-clients.json',
          fields: ['defaultAdapter', 'clients.booking/generated/y-client'],
        },
        '{workspaceRoot}/libs/generated/x-client-2/openapi.yaml',
        { runtime: 'java -version 2>&1' },
      ],
      options: { client: 'booking/generated/y-client', other: 'generated/x-client-2' },
      cache: true,
    });
  });
});
