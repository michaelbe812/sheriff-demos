import { PresetId } from './index';

export interface TemplateOptions {
  /** Primary app name — used to seed a sensible entryPoints entry. */
  app?: string;
  /** Whether the config should import from the fork (strict) or upstream. */
  useFork: boolean;
}

const coreImport = (useFork: boolean): string =>
  useFork ? '@lambda-solutions/sheriff-core' : '@softarc/sheriff-core';

const entryPointsBlock = (app?: string): string =>
  app
    ? `  entryPoints: { ${JSON.stringify(app)}: 'apps/${app}/src/main.ts' },\n`
    : `  // entryPoints: { app: 'apps/app/src/main.ts' },\n`;

/** Vertical-slice presets delegate to the published arc-presets factory. */
function verticalTemplate(preset: 'blueprint' | 'inverted', app?: string): string {
  return `import { verticalSliceConfig } from '@lambda-solutions/arc-presets';

/**
 * Sheriff config — '${preset}' preset (scaffolded by @lambda-solutions/arc-presets).
 * Rules, slice shape and rationale live in the preset package; projects only
 * declare their shared features and entry points here.
 */
export const config = verticalSliceConfig('${preset}', {
  sharedFeatures: [],
${entryPointsBlock(app)}  // extraModules / extraDepRules for project specifics
});
`;
}

/** Hexagonal presets are emitted self-contained (denyRules / complex axes). */
function hexagonalTemplate(
  preset: 'hexagonal-fwcore' | 'hexagonal-strict',
  opts: TemplateOptions,
): string {
  const app = opts.app ?? 'app';
  return `import { hexagonalConfig } from '@lambda-solutions/arc-presets';

/**
 * Sheriff config — '${preset}' preset (scaffolded by @lambda-solutions/arc-presets).
 *${preset === 'hexagonal-strict' ? '\n * Requires the @lambda-solutions Sheriff fork (v1+) for denyRules.\n *' : ''}
 * List each app and its hexagon slices below.
 */
export const config = hexagonalConfig('${preset}', {
  apps: { ${JSON.stringify(app)}: [] },
${entryPointsBlock(opts.app)}});
`;
}

/** Returns the sheriff.config.ts file content for a preset. */
export function configTemplate(preset: PresetId, opts: TemplateOptions): string {
  switch (preset) {
    case 'blueprint':
    case 'inverted':
      return verticalTemplate(preset, opts.app);
    case 'hexagonal-fwcore':
    case 'hexagonal-strict':
      return hexagonalTemplate(preset, opts);
  }
}

/** Which core package a preset imports at runtime (for dep installation). */
export function coreImportFor(useFork: boolean): string {
  return coreImport(useFork);
}
