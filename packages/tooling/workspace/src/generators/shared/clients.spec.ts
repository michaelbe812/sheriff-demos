import type { Tree } from '@nx/devkit';
import { createBlueprintTree, pathsOf, read, readProject, scopesOf } from '@blueprint/tooling-conventions/testing';
import { addClientEntry, type ClientEntry, readClientsJson } from '@blueprint/tooling-openapi/clients';
import { clientPartConfig, clientProjectJson } from '@blueprint/tooling-openapi';
import { writeJsonFile, writeLibConfig } from '@blueprint/tooling-conventions/tree';
import { beforeEach, describe, expect, it } from 'vitest';
import { moveGenerator } from '../move/generator';
import { removeGenerator } from '../remove/generator';
import { renameGenerator } from '../rename/generator';

/**
 * move / rename / remove keep openapi-clients.json and the client config in step. The client is laid out
 * like `nx g @blueprint/tooling-openapi:client` does it (spec, client project.json, four libs with index.ts
 * + config, paths, entry).
 */
const SPEC_YAML = 'openapi: 3.0.3\ninfo: { title: Demo, version: 1.0.0 }\npaths:\n  /things: {}\n';
const clients = (tree: Tree) => JSON.parse(read(tree, 'openapi-clients.json')).clients;

function addClient(tree: Tree, clientPath: string, entry: ClientEntry = {}): void {
  tree.write(`libs/${clientPath}/openapi.yaml`, SPEC_YAML);
  for (const part of ['api', 'core', 'testing', 'types']) {
    tree.write(`libs/${clientPath}/${part}/src/index.ts`, "export * from './generated';\n");
  }
  addClientEntry(tree, clientPath, entry);
  const exists = (path: string): boolean => tree.exists(path);
  writeJsonFile(tree, `libs/${clientPath}/project.json`, clientProjectJson(exists, clientPath, readClientsJson(tree)));
  for (const part of ['api', 'core', 'testing', 'types']) {
    writeLibConfig(tree, `${clientPath}/${part}`, clientPartConfig(exists, clientPath, part));
  }
}

describe('move / rename / remove with OpenAPI clients', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('remove takes the client, its config, paths and entry out — exactly as before', async () => {
    addClient(tree, 'generated/keep-client');
    const before = read(tree, 'openapi-clients.json');
    const baseTsconfig = read(tree, 'tsconfig.base.json');
    addClient(tree, 'booking/generated/demo-client');

    await removeGenerator(tree, { path: 'booking/generated/demo-client', skipFormat: true });

    expect(tree.exists('libs/booking/generated')).toBe(false);
    expect(read(tree, 'openapi-clients.json')).toBe(before);
    expect(read(tree, 'tsconfig.base.json')).toBe(baseTsconfig);

    // `generated` is no scope: removing one of two shared clients leaves the scope list alone
    addClient(tree, 'generated/other-client');
    await removeGenerator(tree, { path: 'generated/keep-client', skipFormat: true });
    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'shared']);
  });

  it('remove refuses while a data lib imports the client', async () => {
    addClient(tree, 'booking/generated/demo-client');
    tree.write(
      'libs/booking/data/src/uses.ts',
      "import { DemoService } from '@blueprint/booking/generated/demo-client/api';\nexport const x = DemoService;\n",
    );

    await expect(removeGenerator(tree, { path: 'booking/generated/demo-client' })).rejects.toThrow(
      'libs/booking/data/src/uses.ts',
    );
  });

  it('move / rename keep the entry, the aliases and the generated testing exports in step', async () => {
    addClient(tree, 'generated/demo-client', { url: 'https://example.org/a.yaml' });
    tree.write(
      'libs/booking/data/src/booking-api.spec.ts',
      "import { demoClientHandlers, demoClientHttp } from '@blueprint/generated/demo-client/testing';\nexport const h = [demoClientHandlers, demoClientHttp];\n",
    );

    await moveGenerator(tree, { from: 'generated/demo-client', to: 'booking/generated/demo-client', skipFormat: true });
    expect(clients(tree)).toEqual({ 'booking/generated/demo-client': { url: 'https://example.org/a.yaml' } });
    expect(tree.exists('libs/booking/generated/demo-client/openapi.yaml')).toBe(true);

    const moved = readProject(tree, 'libs/booking/generated/demo-client/project.json');
    expect(moved.name).toBe('booking-generated-demo-client');
    expect(moved.tags).toEqual(['scope:booking', 'generated']);
    expect(moved.targets.generate.options).toEqual({ client: 'booking/generated/demo-client' });
    expect(moved.targets.generate.inputs).toContainEqual({
      json: '{workspaceRoot}/openapi-clients.json',
      fields: ['defaultAdapter', 'clients.booking/generated/demo-client'],
    });
    expect(moved.targets.generate.inputs?.[0]).toBe('{workspaceRoot}/libs/booking/generated/demo-client/openapi.yaml');

    await renameGenerator(tree, { path: 'booking/generated/demo-client', name: 'thing-client', skipFormat: true });
    expect(clients(tree)).toEqual({ 'booking/generated/thing-client': { url: 'https://example.org/a.yaml' } });
    const api = readProject(tree, 'libs/booking/generated/thing-client/api/project.json');
    expect(api.name).toBe('booking-generated-thing-client-api');
    expect(api.implicitDependencies).toEqual([
      'booking-generated-thing-client',
      'booking-generated-thing-client-types',
      'booking-generated-thing-client-core',
    ]);
    const testing = readProject(tree, 'libs/booking/generated/thing-client/testing/project.json');
    expect(testing.targets.generate.options).toEqual({ client: 'booking/generated/thing-client' });
    expect(pathsOf(tree)).toHaveProperty(['@blueprint/booking/generated/thing-client/api']);
    expect(read(tree, 'libs/booking/data/src/booking-api.spec.ts')).toBe(
      "import { thingClientHandlers, thingClientHttp } from '@blueprint/booking/generated/thing-client/testing';\nexport const h = [thingClientHandlers, thingClientHttp];\n",
    );
  });

  it('removing a domain drops its clients', async () => {
    addClient(tree, 'booking/generated/demo-client');
    await removeGenerator(tree, { path: 'booking', force: true, skipFormat: true });
    expect(clients(tree)).toEqual({});
  });

  it('moving a whole domain moves the client paths inside its libs, too', async () => {
    addClient(tree, 'booking/generated/demo-client');
    await moveGenerator(tree, { from: 'booking', to: 'reservation', skipFormat: true });

    const testing = readProject(tree, 'libs/reservation/generated/demo-client/testing/project.json');
    expect(testing.name).toBe('reservation-generated-demo-client-testing');
    expect(testing.tags).toEqual(['scope:reservation', 'type:testing', 'feat:none', 'generated']);
    expect(testing.implicitDependencies).toEqual(['reservation-generated-demo-client']);
    expect(testing.targets.generate.options).toEqual({ client: 'reservation/generated/demo-client' });
    expect(testing.targets.generate.inputs?.[0]).toBe(
      '{workspaceRoot}/libs/reservation/generated/demo-client/openapi.yaml',
    );
    expect(readProject(tree, 'libs/reservation/generated/demo-client/project.json').tags).toEqual([
      'scope:reservation',
      'generated',
    ]);
  });
});
