/**
 * Facade-Vertrag (Spike S1, gemeinsam mit S2). Beschreibung: docs/openapi-facade-spike.md.
 *
 * Die Facade legt fest, WO der Code liegt und WIE er in Nx-Libs aufgeteilt wird.
 * Ein Adapter liefert nur Rohausgabe + Klassifizierung. Er kennt weder Nx noch Libs noch Aliase.
 */

/** Ein Client. Im Workspace aus Ordner + nx.json-Plugin-Optionen abgeleitet (siehe blueprint-openapi-clients.ts). */
export interface ClientDefinition {
  /** Ordnername, z.B. 'pet-client'. */
  name: string;
  /** 'shared' → libs/generated/<name>, { domain } → libs/<domain>/generated/<name>. */
  placement: 'shared' | { domain: string };
  /**
   * `file` (workspace-relativ, committet) ist die einzige Quelle für `generate` und Cache-Input.
   * `url` nur für `update-spec`: lädt, normalisiert (YAML) und überschreibt `file`. Nie direkt von der URL generieren.
   */
  spec: { file: string; url?: string };
  generator: { adapter: string; options?: Record<string, unknown> };
}

/** Kontext für generate UND classify (classify braucht die Optionen, z.B. bei Multi-Plugin-Adaptern). */
export interface GenerateContext {
  /** absolut */
  specFile: string;
  /** absolut: tmp/openapi/<pfad-unter-libs>/raw, vor generate geleert */
  outDir: string;
  /** Adapter-Defaults bereits mit `generator.options` gemergt */
  options: Record<string, unknown>;
  workspaceRoot: string;
  client: ClientDefinition;
}

export type Part = 'types' | 'api' | 'core';

/**
 * Dateien relativ zu outDir, posix. Nicht gelistete Dateien werden verworfen (README, .openapi-generator/, Root-index.ts …).
 * models → Lib `types` (type:types), apis → Lib `api` (type:api), core → Lib `core` (type:api, enthält HTTP).
 */
export interface Classification {
  models: string[];
  apis: string[];
  core: string[];
  /**
   * Öffentliche API je Teil: Dateien, die `src/generated/index.ts` per `export *` re-exportiert.
   * Default: alle Dateien des Teils. Nötig, wenn Barrels (models.ts) doppelt exportieren würden.
   */
  entries?: Partial<Record<Part, string[]>>;
}

export interface GeneratorAdapter {
  id: string;
  /** Rohausgabe nach ctx.outDir. */
  generate(ctx: GenerateContext): Promise<void>;
  classify(ctx: GenerateContext): Promise<Classification>;
}

/**
 * Registry-Eintrag (adapters/registry.cjs), sync lesbar fürs Nx-Plugin:
 * Cache-Inputs des generate-Targets.
 */
export interface AdapterRegistration {
  module: string;
  /** npm-Pakete, deren Version Cache-Input ist (= Adapter-Version) */
  packages: string[];
  /** weitere Workspace-Dateien als Input, z.B. openapitools.json (Jar-Version) */
  inputs: string[];
  /** Runtime-Inputs, z.B. `java -version 2>&1` */
  runtime: string[];
}
