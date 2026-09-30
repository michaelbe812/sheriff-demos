import { formatFiles, type GeneratorCallback, logger, type Tree } from '@nx/devkit';
import { FEAT_PREFIX, GENERATED_FOLDER, SHARED_SCOPE, SLICE_LAYERS, TESTING_LAYER } from '../../plugin/lib-conventions';
import { assertLayerDependencies, generateSliceLayer, generateTestingLib, registerSliceRoute } from '../shared/slice';
import { dataStoreSpec, SLICE_LAYER_ORDER, sliceNames } from '../shared/slice-templates';
import { addScope, APP_ROUTES_FILE, assertKebabCase, libExists, writeIfMissing } from '../shared/workspace';

export interface DomainGeneratorSchema {
  name: string;
  /** comma-separated or list, default types,api,data,ui,shell */
  layers?: string | string[];
  testing?: boolean;
  appRoutesFile?: string;
  skipFormat?: boolean;
}

export const DEFAULT_DOMAIN_LAYERS = ['types', 'api', 'data', 'ui', 'shell'];

export function parseLayers(layers: string | string[] | undefined, fallback: string[]): string[] {
  if (layers === undefined || layers.length === 0) return fallback;
  const list = Array.isArray(layers) ? layers : layers.split(',');
  return list.map((layer) => layer.trim()).filter(Boolean);
}

/** A new slice: scope in the list, one lib per layer, testing lib + example spec, lazy route in the app. */
export async function domainGenerator(tree: Tree, options: DomainGeneratorSchema): Promise<GeneratorCallback> {
  const scope = options.name;
  assertKebabCase(scope, 'Domain');
  if (scope === SHARED_SCOPE || scope === GENERATED_FOLDER || scope.startsWith(FEAT_PREFIX))
    throw new Error(`"${scope}" is reserved and cannot be a domain.`);
  const layers = parseLayers(options.layers, DEFAULT_DOMAIN_LAYERS).filter((layer) => layer !== TESTING_LAYER);
  const allowed = SLICE_LAYERS.filter((layer) => layer !== TESTING_LAYER);
  const unknown = layers.filter((layer) => !allowed.includes(layer));
  if (unknown.length) throw new Error(`Unknown layer(s) ${unknown.join(', ')} — allowed: ${allowed.join(', ')}`);
  const withTesting = options.testing !== false;
  for (const layer of layers) assertLayerDependencies(tree, scope, layer, layers);
  if (withTesting) assertLayerDependencies(tree, scope, TESTING_LAYER, layers);

  addScope(tree, scope);
  const n = sliceNames(scope);
  const created = SLICE_LAYER_ORDER.filter((layer) => layers.includes(layer)).filter((layer) =>
    generateSliceLayer(tree, n, layer),
  );
  if (withTesting) generateTestingLib(tree, n);
  if (created.includes('data') && libExists(tree, `${scope}/testing`)) {
    const spec = dataStoreSpec(n);
    writeIfMissing(tree, `libs/${scope}/data/src/${spec.file}`, spec.content);
  }
  if (layers.includes('shell')) registerSliceRoute(tree, scope, options.appRoutesFile ?? APP_ROUTES_FILE);

  if (!options.skipFormat) await formatFiles(tree);
  return () => {
    logger.info(
      `Domain "${scope}": libs/${scope}/{${[...layers, ...(withTesting ? [TESTING_LAYER] : [])].join(',')}}, scope in nx.json.`,
    );
    logger.info(`Next: nx g @blueprint/tooling:feat ${scope} <name> --api --data --ui`);
  };
}

export default domainGenerator;
