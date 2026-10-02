import { formatFiles, logger, Tree } from '@nx/devkit';
import { detectPreset, PRESET_MARKER } from '../detect-preset';

export interface MigrateGeneratorSchema {
  app?: string;
}

/**
 * Migrates a workspace from the 'blueprint' preset to 'inverted'.
 *
 * The heavy lifting (moving each slice's api/ impl into infra/, making the port
 * abstract, adding <name>.providers.ts) is inherently slice-specific and risky
 * to do blindly, so this generator does the SAFE, mechanical part — flipping
 * the config to the inverted factory — and prints a precise checklist for the
 * per-slice code moves.
 */
export default async function migrateGenerator(
  tree: Tree,
  _options: MigrateGeneratorSchema,
): Promise<void> {
  const current = detectPreset(tree);
  if (current === 'inverted') {
    logger.info('arc-presets: already on the inverted preset — nothing to do.');
    return;
  }
  if (current !== 'blueprint') {
    throw new Error(
      `migrate only supports blueprint -> inverted, but the active preset is '${current}'.`,
    );
  }

  if (!tree.exists('sheriff.config.ts')) {
    throw new Error('sheriff.config.ts not found — run the init generator first.');
  }

  const original = tree.read('sheriff.config.ts', 'utf-8') ?? '';
  const migrated = original
    .replace(/arc-presets:preset=blueprint/g, 'arc-presets:preset=inverted')
    .replace(
      /verticalSliceConfig\(\s*['"]blueprint['"]/g,
      "verticalSliceConfig('inverted'",
    );

  // If neither the marker nor a literal call was present, ensure the marker.
  const withMarker = migrated.includes('arc-presets:preset=inverted')
    ? migrated
    : `${PRESET_MARKER('inverted')}\n${migrated}`;

  tree.write('sheriff.config.ts', withMarker);

  await formatFiles(tree);

  logger.info(
    [
      '',
      "arc-presets: sheriff.config.ts switched to the 'inverted' preset.",
      '',
      'Per-slice code moves you still need to do (the port must not name its impl):',
      '  1. In each slice, move api/<name>-api.ts logic into infra/http-<name>-api.ts',
      '     as `class Http<Name>Api extends <Name>Api`.',
      '  2. Turn api/ into a CONTRACT: api/index.ts with `abstract class <Name>Api`',
      '     (abstract methods only — no bodies).',
      '  3. Add <name>.providers.ts at the slice root:',
      '       { provide: <Name>Api, useClass: Http<Name>Api }',
      '  4. Update state/ stores to `inject(<Name>Api)` from ../api (the contract).',
      '  5. Run `<pm> sheriff:verify` — type:api -> type:infra should now be blocked.',
      '',
      'Tip: `nx g @lambda-solutions/arc-presets:domain <name>` on the inverted preset',
      'shows the exact target shape for reference.',
      '',
    ].join('\n'),
  );
}
