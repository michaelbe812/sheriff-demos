/**
 * Minimal, engine-agnostic Sheriff config typing + rule helpers.
 *
 * arc-presets deliberately does NOT import from a concrete sheriff-core at
 * runtime: a target repo may install the upstream `@softarc/sheriff-core` OR
 * the `@lambda-solutions` fork, and the preset factories must load under
 * either. The helper functions below (`anyTag`, `sameTag`, `noDependencies`)
 * are identical across both engines and trivial, so we inline them.
 */

export interface DepRuleContext {
  from: string;
  to: string;
  fromModulePath: string;
  toModulePath: string;
  fromFilePath: string;
  toFilePath: string;
}

export type DepRuleFn = (context: DepRuleContext) => boolean;
export type DepRule = string | DepRuleFn | Array<string | DepRuleFn>;

export type ModuleTags = string[];
export interface ModuleConfig {
  [path: string]: ModuleTags | ModuleConfig;
}

export interface SheriffConfig {
  enableBarrelLess?: boolean;
  encapsulationPattern?: string;
  entryPoints?: Record<string, string>;
  modules?: ModuleConfig;
  depRules?: Record<string, DepRule>;
  /** Fork-only; upstream ignores it. */
  denyRules?: Record<string, DepRuleFn>;
}

/** Any target tag is allowed. */
export const anyTag: DepRuleFn = () => true;

/** Only the identical tag is allowed. */
export const sameTag: DepRuleFn = ({ from, to }) => from === to;

/** No dependency is allowed. */
export const noDependencies: DepRuleFn = () => false;
