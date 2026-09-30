/**
 * ESLint rules of the blueprint naming scheme. Loaded by eslint.config.mjs via
 * `loadWorkspaceRules` (@nx/eslint-plugin: swc-transpiled from source, no build) as plugin `blueprint`.
 * Layer, scope and feat come from @blueprint/tooling-conventions — the same parser the crystal plugin uses.
 */
import { layerSymbolNaming, RULE_NAME as LAYER_SYMBOL_NAMING } from './rules/layer-symbol-naming';
import { libFileNaming, RULE_NAME as LIB_FILE_NAMING } from './rules/lib-file-naming';
import { noInternalExport, RULE_NAME as NO_INTERNAL_EXPORT } from './rules/no-internal-export';

export const rules = {
  [LIB_FILE_NAMING]: libFileNaming,
  [LAYER_SYMBOL_NAMING]: layerSymbolNaming,
  [NO_INTERNAL_EXPORT]: noInternalExport,
};
