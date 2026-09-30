import { formatFiles, type Tree } from '@nx/devkit';
import { SLICE_LAYERS } from '@blueprint/tooling-conventions';
import { assertLayerDependencies, generateSliceLayer, registerSliceRoute } from '../shared/slice';
import { sliceNames } from '../shared/slice-templates';
import { APP_ROUTES_FILE, assertSliceExists } from '../shared/workspace';

export interface LayerGeneratorSchema {
  domain: string;
  layer: string;
  appRoutesFile?: string;
  skipFormat?: boolean;
}

/** One more lib in an existing slice: libs/<domain>/<layer>. Layer list comes from the plugin. */
export async function layerGenerator(tree: Tree, options: LayerGeneratorSchema): Promise<void> {
  const { domain, layer } = options;
  if (layer === 'feature') throw new Error('"feature" only exists inside a feat: nx g @blueprint/tooling:feat <domain> <name>');
  if (!SLICE_LAYERS.includes(layer)) throw new Error(`Unknown layer "${layer}" — allowed: ${SLICE_LAYERS.join(', ')}`);
  assertSliceExists(tree, domain);
  assertLayerDependencies(tree, domain, layer);
  generateSliceLayer(tree, sliceNames(domain), layer);
  if (layer === 'shell') registerSliceRoute(tree, domain, options.appRoutesFile ?? APP_ROUTES_FILE);
  if (!options.skipFormat) await formatFiles(tree);
}

export default layerGenerator;
