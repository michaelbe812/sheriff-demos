import { Tree } from '@nx/devkit';
import { PresetId, PRESET_IDS } from '../presets';

/**
 * The init generator writes a marker line into sheriff.config.ts so slice
 * generators know which preset shape to scaffold without a flag.
 */
export const PRESET_MARKER = (preset: PresetId) =>
  `// arc-presets:preset=${preset}`;

const isPreset = (v: string | undefined): v is PresetId =>
  !!v && (PRESET_IDS as readonly string[]).includes(v);

/**
 * The actual factory call is the source of truth — detect it FIRST so a stale
 * marker in a comment cannot override the real config. Falls back to the marker,
 * then to 'inverted' (the recommended default).
 */
export function detectPreset(tree: Tree, override?: string): PresetId {
  if (isPreset(override)) return override;

  const config = tree.exists('sheriff.config.ts')
    ? (tree.read('sheriff.config.ts', 'utf-8') ?? '')
    : '';

  // 1. factory call — authoritative
  if (/hexagonalConfig\(\s*['"]hexagonal-strict['"]/.test(config))
    return 'hexagonal-strict';
  if (/hexagonalConfig\(\s*['"]hexagonal-fwcore['"]/.test(config))
    return 'hexagonal-fwcore';
  if (/verticalSliceConfig\(\s*['"]blueprint['"]/.test(config))
    return 'blueprint';
  if (/verticalSliceConfig\(\s*['"]inverted['"]/.test(config))
    return 'inverted';

  // 2. marker — only when it is the SOLE content of a comment line, so a
  //    "TODO: remove old marker: arc-presets:preset=..." note is ignored.
  for (const line of config.split('\n')) {
    const m = /^\s*\/\/\s*arc-presets:preset=([\w-]+)\s*$/.exec(line);
    if (m && isPreset(m[1])) return m[1];
  }

  return 'inverted';
}
