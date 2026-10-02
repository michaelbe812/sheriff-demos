import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBlueprintTree, readProject } from '@blueprint/tooling-conventions/testing';
import { writeJsonFile } from '@blueprint/tooling-conventions/tree';
import { libTagsSyncGenerator } from './generator';

describe('lib-tags sync generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  const setTags = (libPath: string, tags: string[]): void => {
    const file = `libs/${libPath}/project.json`;
    writeJsonFile(tree, file, { ...readProject(tree, file), tags });
  };

  it('is in sync when every project.json carries the tags of its path', async () => {
    expect(await libTagsSyncGenerator(tree)).toBeUndefined();
  });

  it('rewrites stale tags (old rule set: port marker, type:api, type:data) to the derived ones', async () => {
    setTags('booking/state', ['scope:booking', 'type:data', 'feat:none', 'port']);
    setTags('booking/shell', ['scope:booking', 'type:feature', 'feat:none']);

    const result = await libTagsSyncGenerator(tree);

    expect(result?.outOfSyncDetails).toEqual([
      'libs/booking/shell/project.json: tags ["scope:booking","type:feature","feat:none"] → ["scope:booking","type:feature","feat:none","entry"]',
      'libs/booking/state/project.json: tags ["scope:booking","type:data","feat:none","port"] → ["scope:booking","type:state","feat:none"]',
    ]);
    expect(readProject(tree, 'libs/booking/state/project.json').tags).toEqual(['scope:booking', 'type:state', 'feat:none']);
    expect(readProject(tree, 'libs/booking/shell/project.json').tags).toContain('entry');
    // the rest of project.json stays untouched
    expect(readProject(tree, 'libs/booking/state/project.json')).toMatchObject({ name: 'booking-state', targets: { build: {} } });
    expect(await libTagsSyncGenerator(tree)).toBeUndefined();
  });

  it('reports a lib whose folder breaks the convention, without touching its tags', async () => {
    tree.write('libs/booking/api/src/index.ts', 'export {};\n');
    writeJsonFile(tree, 'libs/booking/api/project.json', { name: 'booking-api', tags: ['scope:booking', 'type:api'] });

    const result = await libTagsSyncGenerator(tree);

    expect(result?.outOfSyncMessage).toContain('need a move');
    expect(result?.outOfSyncDetails?.[0]).toContain('libs/booking/api: not a blueprint lib path');
    expect(readProject(tree, 'libs/booking/api/project.json').tags).toEqual(['scope:booking', 'type:api']);
  });
});
