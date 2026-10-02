/**
 * Facade contract for generated OpenAPI clients (docs/nx-umsetzung.md → "OpenAPI-Clients").
 *
 * The facade decides WHERE the code lives and HOW it is split into Nx libs (types / api / core).
 * An adapter only delivers raw output + a classification. It knows neither Nx nor libs nor aliases.
 */

/**
 * One client. Built by the facade (resolveClient) from its entry in openapi-clients.json + the client folder
 * at run time — the `generate` / `update-spec` targets only carry the `client` path (the entry is a json input).
 */
export interface ClientDefinition {
  /** folder name, e.g. 'pet-client' */
  name: string;
  /** 'shared' → libs/generated/<name>, { domain } → libs/<domain>/generated/<name> */
  placement: 'shared' | { domain: string };
  /**
   * `file` (workspace-relative, committed: openapi.yaml|json in the client folder) is the only source for
   * `generate` and a cache input. `url` only for `update-spec`: downloads, normalizes, overwrites `file`.
   * Never generate straight from the URL.
   */
  spec: { file: string; url?: string };
  generator: { adapter: string; options?: Record<string, unknown> };
}

/** Context for generate AND classify (classify needs the options, e.g. for multi-backend adapters). */
export interface GenerateContext {
  /** absolute */
  specFile: string;
  /** absolute: tmp/openapi/<path below libs>/raw, emptied before generate */
  outDir: string;
  /** adapter defaults merged with `generator.options` */
  options: Record<string, unknown>;
  workspaceRoot: string;
  client: ClientDefinition;
}

export type Part = 'types' | 'api' | 'core';

/**
 * Files relative to outDir, posix. Files not listed are dropped (README, .openapi-generator/, root index.ts …).
 * models → lib `types` (type:types), apis → lib `api` (type:data), core → lib `core` (type:data, contains HTTP).
 */
export interface Classification {
  models: string[];
  apis: string[];
  core: string[];
  /**
   * Public API per part: files `src/generated/index.ts` re-exports with `export *`.
   * Default: every file of the part. Needed when generator barrels (models.ts) would export twice.
   */
  entries?: Partial<Record<Part, string[]>>;
}

export interface GeneratorAdapter {
  id: string;
  /** raw output into ctx.outDir */
  generate(ctx: GenerateContext): Promise<void>;
  classify(ctx: GenerateContext): Promise<Classification>;
}

/**
 * Registry entry (adapters/registry.json), read synchronously by the client generator (project.json inputs) and verify:
 * cache inputs of the `generate` target.
 */
export interface AdapterRegistration {
  module: string;
  /** npm packages whose version is a cache input (= adapter version) */
  packages: string[];
  /** further workspace files as input, e.g. openapitools.json (jar version) */
  inputs: string[];
  /** runtime inputs, e.g. `java -version 2>&1` */
  runtime: string[];
}
