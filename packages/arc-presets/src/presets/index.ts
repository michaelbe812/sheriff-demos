export type PresetId =
  | 'blueprint'
  | 'inverted'
  | 'hexagonal-fwcore'
  | 'hexagonal-strict';

export const PRESET_IDS: readonly PresetId[] = [
  'blueprint',
  'inverted',
  'hexagonal-fwcore',
  'hexagonal-strict',
] as const;

export interface PresetMeta {
  id: PresetId;
  /** Human label for prompts / logs. */
  label: string;
  /** Whether the preset REQUIRES the @lambda-solutions fork to run. */
  requiresFork: boolean;
  /** Which slice generator applies to this preset. */
  sliceKind: 'vertical' | 'hexagon';
}

export const PRESETS: Record<PresetId, PresetMeta> = {
  blueprint: {
    id: 'blueprint',
    label: 'Vertical Slice (base, no infra/)',
    requiresFork: false,
    sliceKind: 'vertical',
  },
  inverted: {
    id: 'inverted',
    label: 'Vertical Slice, inverted (api/ contract + infra/ impl)',
    requiresFork: false,
    sliceKind: 'vertical',
  },
  'hexagonal-fwcore': {
    id: 'hexagonal-fwcore',
    label: 'Hexagonal, framework-aware core (3 layers)',
    requiresFork: false,
    sliceKind: 'hexagon',
  },
  'hexagonal-strict': {
    id: 'hexagonal-strict',
    label: 'Hexagonal, strict framework-free core (denyRules)',
    requiresFork: true,
    sliceKind: 'hexagon',
  },
};

export {
  verticalSliceConfig,
  slice,
  blueprintDepRules,
  nxModuleBoundariesOptions,
  sameApp,
  appOf,
  inAnyFeat,
  type VerticalPreset,
  type VerticalSliceOptions,
} from './vertical-slice';

export {
  hexagonalConfig,
  hexSlice,
  type HexPreset,
  type HexagonalOptions,
} from './hexagonal';

export { configTemplate } from './templates';
