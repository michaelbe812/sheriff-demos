import { formatFiles, logger, type Tree } from '@nx/devkit';
import { aliasFor, FEAT_PREFIX } from '@blueprint/tooling-conventions';
import { featApi, featState, featFeature, featNames, type FeatParts, featUi } from '../shared/feat-templates';
import { findExportedRoutes, findLazyRoutes, insertRoute, lazyRouteSource, updateFile } from '../shared/routes';
import { writeLib } from '../shared/slice';
import { assertKebabCase, assertSliceExists } from '../shared/workspace';

export interface FeatGeneratorSchema {
  domain: string;
  name: string;
  api?: boolean;
  state?: boolean;
  ui?: boolean;
  skipFormat?: boolean;
}

/** libs/<domain>/feat-<name>/feature (+ api/state/ui), lazy route in the domain shell routes. */
export async function featGenerator(tree: Tree, options: FeatGeneratorSchema): Promise<void> {
  const feat = options.name.startsWith(FEAT_PREFIX) ? options.name.slice(FEAT_PREFIX.length) : options.name;
  assertKebabCase(feat, 'Feat');
  assertSliceExists(tree, options.domain);
  const n = featNames(options.domain, feat);
  const parts: FeatParts = { api: Boolean(options.api), state: Boolean(options.state), ui: Boolean(options.ui) };

  // sub-libs first: the container imports them
  if (parts.api) writeLib(tree, `${n.featPath}/api`, featApi(n));
  if (parts.state) writeLib(tree, `${n.featPath}/state`, featState(n, parts));
  if (parts.ui) writeLib(tree, `${n.featPath}/ui`, featUi(n));
  writeLib(tree, `${n.featPath}/feature`, featFeature(n, parts));
  registerFeatRoute(tree, n.scope, feat, n.container);

  if (!options.skipFormat) await formatFiles(tree);
}

/** Lazy route `{ path: '<feat>', loadComponent: … }` in the routes of libs/<domain>/shell. */
export function registerFeatRoute(tree: Tree, scope: string, feat: string, container: string): boolean {
  const shellRoutes = findExportedRoutes(tree, `${scope}/shell`);
  if (!shellRoutes) {
    logger.warn(`libs/${scope}/shell exports no Routes — add feat-${feat} to a route yourself`);
    return false;
  }
  const specifier = aliasFor(`${scope}/${FEAT_PREFIX}${feat}/feature`);
  return updateFile(tree, shellRoutes.file, (content) =>
    findLazyRoutes(content, shellRoutes.file).some((route) => route.specifier === specifier)
      ? content
      : insertRoute(content, lazyRouteSource({ path: feat, specifier, exportName: container, kind: 'component' }), shellRoutes.file),
  );
}

export default featGenerator;
