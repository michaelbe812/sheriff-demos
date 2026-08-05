import { Tree } from '@nx/devkit';
import { PresetId, PRESET_IDS } from '../presets';

/**
 * The init generator writes a marker line into sheriff.config.ts so slice
 * generators know which preset shape to scaffold without a flag.
 */
export const PRESET_MARKER = (preset: PresetId) =>
  `// arc-presets:preset=${preset}`;

/**
 * Reads the active preset from the workspace sheriff.config.ts. Falls back to
 * an explicit override, then to 'inverted' (the recommended default).
 */
export function detectPreset(tree: Tree, override?: string): PresetId {
  if (override && (PRESET_IDS as readonly string[]).includes(override)) {
    return override as PresetId;
  }
  const config = tree.exists('sheriff.config.ts')
    ? (tree.read('sheriff.config.ts', 'utf-8') ?? '')
    : '';
  const marker = /arc-presets:preset=([\w-]+)/.exec(config)?.[1];
  if (marker && (PRESET_IDS as readonly string[]).includes(marker)) {
    return marker as PresetId;
  }
  // heuristic fallbacks from the config body
  if (/hexagonalConfig\(\s*['"]hexagonal-strict/.test(config))
    return 'hexagonal-strict';
  if (/hexagonalConfig\(\s*['"]hexagonal-fwcore/.test(config))
    return 'hexagonal-fwcore';
  if (/verticalSliceConfig\(\s*['"]blueprint/.test(config)) return 'blueprint';
  if (/verticalSliceConfig\(\s*['"]inverted/.test(config)) return 'inverted';
  return 'inverted';
}
