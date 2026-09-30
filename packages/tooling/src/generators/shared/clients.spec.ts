import type { Tree } from '@nx/devkit';
import { createBlueprintTree, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { addClientEntry, type ClientEntry } from '@blueprint/tooling-openapi/clients';
import { beforeEach, describe, expect, it } from 'vitest';
import { moveGenerator } from '../move/generator';
import { removeGenerator } from '../remove/generator';
import { renameGenerator } from '../rename/generator';

/**
 * move / rename / remove keep openapi-clients.json in step. The client is laid out like
 * `nx g @blueprint/tooling-openapi:client` does it (spec, four libs with only index.ts, entry).
 */
const SPEC_YAML = 'openapi: 3.0.3\ninfo: { title: Demo, version: 1.0.0 }\npaths:\n  /things: {}\n';
const clients = (tree: Tree) => JSON.parse(read(tree, 'openapi-clients.json')).clients;

function addClient(tree: Tree, clientPath: string, entry: ClientEntry = {}): void {
  tree.write(`libs/${clientPath}/openapi.yaml`, SPEC_YAML);
  for (const part of ['api', 'core', 'testing', 'types']) {
    tree.write(`libs/${clientPath}/${part}/src/index.ts`, "export * from './generated';\n");
  }
  addClientEntry(tree, clientPath, entry);
}

describe('move / rename / remove with OpenAPI clients', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('remove takes the client and its entry out — openapi-clients.json exactly as before', async () => {
    addClient(tree, 'generated/keep-client');
    const before = read(tree, 'openapi-clients.json');
    addClient(tree, 'booking/generated/demo-client');

    await removeGenerator(tree, { path: 'booking/generated/demo-client', skipFormat: true });

    expect(tree.exists('libs/booking/generated')).toBe(false);
    expect(read(tree, 'openapi-clients.json')).toBe(before);

    // `generated` is no scope: removing one of two shared clients leaves the scope list alone
    addClient(tree, 'generated/other-client');
    await removeGenerator(tree, { path: 'generated/keep-client', skipFormat: true });
    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'shared']);
  });

  it('remove refuses while a port imports the client', async () => {
    addClient(tree, 'booking/generated/demo-client');
    tree.write(
      'libs/booking/api/src/uses.ts',
      "import { DemoService } from '@blueprint/booking/generated/demo-client/api';\nexport const x = DemoService;\n",
    );

    await expect(removeGenerator(tree, { path: 'booking/generated/demo-client' })).rejects.toThrow(
      'libs/booking/api/src/uses.ts',
    );
  });

  it('move / rename keep the entry, the aliases and the generated testing exports in step', async () => {
    addClient(tree, 'generated/demo-client', { url: 'https://example.org/a.yaml' });
    tree.write(
      'libs/booking/api/src/booking-api.spec.ts',
      "import { demoClientHandlers, demoClientHttp } from '@blueprint/generated/demo-client/testing';\nexport const h = [demoClientHandlers, demoClientHttp];\n",
    );

    await moveGenerator(tree, { from: 'generated/demo-client', to: 'booking/generated/demo-client', skipFormat: true });
    expect(clients(tree)).toEqual({ 'booking/generated/demo-client': { url: 'https://example.org/a.yaml' } });
    expect(tree.exists('libs/booking/generated/demo-client/openapi.yaml')).toBe(true);

    await renameGenerator(tree, { path: 'booking/generated/demo-client', name: 'thing-client', skipFormat: true });
    expect(clients(tree)).toEqual({ 'booking/generated/thing-client': { url: 'https://example.org/a.yaml' } });
    expect(read(tree, 'libs/booking/api/src/booking-api.spec.ts')).toBe(
      "import { thingClientHandlers, thingClientHttp } from '@blueprint/booking/generated/thing-client/testing';\nexport const h = [thingClientHandlers, thingClientHttp];\n",
    );
  });

  it('removing a domain drops its clients', async () => {
    addClient(tree, 'booking/generated/demo-client');
    await removeGenerator(tree, { path: 'booking', force: true, skipFormat: true });
    expect(clients(tree)).toEqual({});
  });
});
