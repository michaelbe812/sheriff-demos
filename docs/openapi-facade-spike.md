# Spike S1: OpenAPI-Clients hinter einer Facade

Branch `tmp/openapi-spike` (Basis `feat/nx-blueprint`). Der Code-Generator ist austauschbar und steckt hinter `tools/openapi-facade/`. Die Facade legt fest, wo der Code liegt, und teilt ihn in Nx-Libs auf: Models → `type:types`, Services → `type:api`, Runtime → `core` (`type:api`). Generierter Code wird nicht committet. Drei Adapter sind umgesetzt, alle drei laufen mit demselben Client grün.

## Ergebnis in Kürze

- **Vertrag:** `ClientDefinition` + `GeneratorAdapter` (unten). Er ist gegenüber dem Entwurf in drei Punkten verfeinert: `classify` bekommt den ctx, es gibt `entries` und eine Registry für Cache-Inputs.
- **Adapter:** `openapi-tools` (typescript-angular 7.25.0, Java), `hey-api` (0.83.1, reines Node), `nx-plugin-openapi` (Backend openapi-tools oder hey-api). Beim Tausch ändert sich nur `booking/api` (der Port), sonst nichts.
- **Nx:** Libs werden wie jede andere Lib über ihre **committete** `src/index.ts` erkannt (`export * from './generated'`). Der Generator schreibt nach `src/generated/**`, das ist gitignored. `generate` hängt am Client-Projekt (Marker = `openapi.yaml`), ist gecacht, und jedes Lib-Target hängt per `^generate` davon ab.
- **Fresh Clone:** `git clone` + `pnpm install` + `nx run-many -t build lint typecheck test` sind grün: 131 Tasks, beide Clients werden automatisch generiert.
- **Sheriff:** nicht nötig. Durch die Aufteilung in Libs gelten die Nx-Tags auch zwischen den Teilen eines Clients.
- **Wichtigster Befund:** Nx hasht und analysiert **gitignored Dateien nicht**. Ohne die zusätzliche Input-Regel liefen Konsumenten nach einer Spec-Änderung aus einem veralteten Cache. Das ist behoben und im Verify geprüft (siehe [Nx-Targets](#nx-targets-und-abhängigkeiten)).

## Vertrag (final)

`tools/openapi-facade/contract.d.ts`:

```ts
interface ClientDefinition {
  name: string;                          // 'pet-client' = Ordnername
  placement: 'shared' | { domain: string };
  spec: { file: string; url?: string };  // file committet = einzige Quelle für generate; url nur für update-spec
  generator: { adapter: string; options?: Record<string, unknown> };
}
interface GenerateContext {
  specFile: string;   // absolut (hey-api liest relative Pfade als Registry-Kurzform org/project)
  outDir: string;     // absolut: tmp/openapi/<pfad-unter-libs>/raw, vorher geleert
  options: Record<string, unknown>;  // Adapter-Defaults ⊕ generator.options
  workspaceRoot: string;
  client: ClientDefinition;
}
type Part = 'types' | 'api' | 'core';
interface Classification {
  models: string[]; apis: string[]; core: string[];  // relativ zu outDir, posix; Rest wird verworfen
  entries?: Partial<Record<Part, string[]>>;         // öffentliche API je Teil (Barrel), Default: alle Dateien
}
interface GeneratorAdapter {
  id: string;
  generate(ctx: GenerateContext): Promise<void>;
  classify(ctx: GenerateContext): Promise<Classification>;
}
// adapters/registry.cjs, sync lesbar fürs Nx-Plugin:
interface AdapterRegistration { module: string; packages: string[]; inputs: string[]; runtime: string[] }
```

Verfeinerungen gegenüber dem Entwurf:

| Änderung | warum |
|---|---|
| `classify(ctx)` statt `classify(outDir)` | Ein Multi-Backend-Adapter (nx-plugin-openapi) muss wissen, welches Backend lief (Input aus S2) |
| `entries` | Generator-Barrels wie `model/models.ts` und `api/api.ts` exportieren sonst doppelt. Bleiben nach `export *` doppelte Namen übrig (hey-api core: `CreateClientConfig`), gewinnt der erste Entry. Die Facade ermittelt die Namen per TS-Checker und re-exportiert den Rest explizit (`barrel.mjs`) |
| Registry mit `packages`/`inputs`/`runtime` | Das Nx-Plugin braucht die Adapter-Version synchron als Cache-Input (npm-Version, `openapitools.json`, `java -version`). ESM-Adapter kann es nicht laden |
| Kein `postProcess`, keine Provider-Funktion im Vertrag | Lint-Header, Import-Umschreibung und Barrel sind generator-unabhängig und gehören der Facade. Provider (`provideApi`, `provideHeyApiClient`) exportiert `core` ohnehin |
| `generate` nur aus der Datei | Nie direkt von der URL generieren, sonst veraltet der Cache (Input aus S2). `update-spec` schreibt die Datei, generiert wird aus ihr |

## Architektur

```
libs/booking/generated/booking-client/openapi.yaml   (committet, Marker)
        │                                     ▲
        │                                     │ update-spec: GET url → YAML normalisiert (nicht gecacht)
        ▼
 Nx: booking-generated-booking-client:generate (gecacht)
        │  ./tools/openapi-facade:generate, Optionen = ClientDefinition (Plugin: Ordner + nx.json)
        ▼
 facade.mjs ── loadAdapter(registry.cjs) ──▶ adapter.generate(ctx) ──▶ tmp/openapi/<pfad>/raw/**
        │                                   adapter.classify(ctx)  ──▶ { models, apis, core, entries }
        ▼
 split.mjs   Struktur pro Teil erhalten, relative Imports über Teilgrenzen → @blueprint/<pfad>/<teil> (TS-AST),
             Imports auf verworfene Dateien → Fehler
 barrel.mjs  src/generated/index.ts aus entries (Konflikte per Checker aufgelöst)
 Header      /* eslint-disable */ /* eslint-enable @nx/enforce-module-boundaries, no-restricted-imports */
        ▼
 …/types/src/index.ts  (committet: export * from './generated')   types/src/generated/**  type:types
 …/core/src/index.ts   (committet)                                core/src/generated/**   type:api
 …/api/src/index.ts    (committet)                                api/src/generated/**    type:api
        ▼
 libs/booking/api (Port) ── mappt DTO → Domain, Promise statt Observable ──▶ data / feature / fremde Domains
```

| Datei | Aufgabe |
|---|---|
| `tools/openapi-facade/facade.mjs` | `generateClient`, `updateSpec`, Pfade/Aliase, Header |
| `tools/openapi-facade/split.mjs`, `barrel.mjs` | Aufteilen + Imports umschreiben, Barrel |
| `tools/openapi-facade/adapters/*.mjs`, `registry.cjs` | Adapter + Cache-Inputs |
| `tools/openapi-facade/generate.js`, `update-spec.js`, `executors.json` | Nx-Executoren |
| `tools/nx-plugins/blueprint-openapi-clients.ts` | Client-Projekt je `openapi.yaml`, Targets `generate`/`update-spec` |
| `tools/nx-plugins/generated-clients.ts` | Pfad-Konvention (shared/Domain, Teile) |
| `tools/nx-plugins/blueprint-libs.ts` | Tags der Teil-Libs, `^generate` + Hash der generierten Dateien an allen Lib-Targets, Kanten |

Die Ablage ist deterministisch und idempotent: Zweimal `generate --skip-nx-cache` ergibt byte-identische `src/generated/**` (gleicher Hash über alle 33 Dateien).

## Ablage, was committet ist

```
libs/generated/<client>/                   scope:shared   Client-Projekt generated-<client> (nur Targets)
libs/<domain>/generated/<client>/          scope:<domain> Client-Projekt <domain>-generated-<client>
  openapi.yaml                             committet, Spec + Marker
  types/src/index.ts                       committet   → Lib …-types  type:types
  api/src/index.ts                         committet   → Lib …-api    type:api
  core/src/index.ts                        committet   → Lib …-core   type:api   (optional)
  <teil>/src/generated/**                  gitignored  (/libs/**/generated/*/*/src/generated/)
```

- **Spec-Ort:** `openapi.yaml` im Client-Ordner. Der Ordner ist keine Lib, sondern Container der Teile. Dort kann später auch `<client>/testing` (S3: openapi-typescript/orval/openapi-msw) dieselbe Spec lesen. Als YAML, weil `update-spec` normalisiert und `*.json` unter `libs/` außerhalb `src/` nach Config-Datei aussähe. Der Wächter selbst prüft nur `project/package/ng-package/tsconfig*/eslint.config`.
- **Client-Optionen: `nx.json`** → Plugin-Optionen:

  ```json
  { "plugin": "./tools/nx-plugins/blueprint-openapi-clients.ts",
    "options": { "defaultAdapter": "openapi-tools",
      "clients": { "generated/pet-client": { "url": "https://petstore3.swagger.io/api/v3/openapi.json", "adapter": "hey-api" } } } }
  ```

  Ein Client ohne Eintrag bekommt den `defaultAdapter` und kein `update-spec`, zero-config. Die Alternativen sind schlechter:
  - Sidecar-Datei im Client-Ordner: eine Config-Datei in `libs/`, genau das, was der Wächter verhindern soll.
  - `x-`-Extension in der Spec: `update-spec` überschreibt die Datei, also müsste gemergt werden. Außerdem vermischt das Build-Konfiguration mit dem API-Vertrag.
  - **Preis:** Eine Änderung an `nx.json` invalidiert den ganzen Nx-Cache. Belegt: Option geändert → `shared-types:lint/typecheck` laufen neu. Clients kommen selten dazu, deshalb vertretbar. Wer das nicht will, wählt die `x-blueprint-client`-Extension mit Merge in `update-spec`: dann läuft nur `generate` dieses Clients neu.
- **Erstanlage mit URL:** Das Projekt entsteht erst durch die Datei. Einmalig also die Spec anlegen (Download oder `updateSpec()` aus `facade.mjs`), danach `nx run <client>:update-spec`. Ein `client`-Generator in `packages/tooling` würde das übernehmen.

## Tag-Schema

| Projekt | Tags |
|---|---|
| `…/types` | `scope:<shared\|domain>` `type:types` `feat:none` `generated` |
| `…/api` | `scope:<shared\|domain>` `type:api` `feat:none` `generated` (**kein** `port`) |
| `…/core` | `scope:<shared\|domain>` `type:api` `feat:none` `generated` |
| Client-Projekt | `scope:<shared\|domain>` `generated` (kein Code, kein Alias) |

- `core` ist **`type:api`, nicht `type:utils`**: `configuration.ts`, `encoder.ts` und `api.base.service.ts` (openapi-tools) bzw. die Client-Runtime (hey-api) importieren `@angular/common/http`. Das ist in `utils` verboten (`bannedExternalImports`).
- Kein `port`: Ein generierter Client ist nie die öffentliche API eines Slices. Fremde Domains kommen nur über den Port (`booking/api`) daran.
- `feat:none`: Feats dürfen ihre Domain-Clients nutzen, wie jede Domain-Lib.

## Boundaries

Regeländerung (Vorgabe User): **`type:types` → `type:types`**, vorher → nichts. Damit dürfen Domain-Types generierte Models nutzen oder re-exportieren, wenn die Scope-Regel passt. `bannedExternalImports: ['*']` bleibt. Die Varianten-Frage ist damit erledigt. `booking/api` mappt trotzdem DTO → Domain (Anti-Corruption im Port), weil das den Domain-Typ frei hält.

`pnpm verify:boundaries`: **100/100 Fälle**, davon 34 neu für generierte Clients. Dazu kommen die Checks „Generierte Clients“ und „Config-Dateien“:

| Fall | erwartet | Ergebnis |
|---|---|---|
| Domain-api → eigener Client api/types/core, → shared Client api/core | erlaubt | ✅ |
| fremde Domain (api, types, feat-data) → `booking/generated/**` | blockiert | ✅ `scope:checkin` |
| ui → Client api/core (Domain + shared) | blockiert | ✅ `type:ui` |
| ui → Client types | erlaubt | ✅ |
| data / feature → Client api | erlaubt (Matrix) | ✅ |
| utils → Client api, Domain-types → Client api | blockiert | ✅ `type:utils` / `type:types` |
| Domain-types → eigene/shared Client types | erlaubt (types → types) | ✅ |
| shared types → Domain-Client types | blockiert | ✅ `scope:shared` |
| app → Domain-Client (kein port) | blockiert | ✅ `type:app` |
| Deep-Import in Client-Lib (`…/types/src/generated/model/booking`) | blockiert | ✅ `no-restricted-imports` |
| **aus generiertem Code** (Datei in `src/generated/` mit Facade-Header): types → api / core desselben Clients | blockiert | ✅ Circular (Kanten api → core → types), ohne Zyklus `type:types` |
| generiert: types → `@angular/core`, shared Client → Domain-Client, api → events, Deep-Import | blockiert | ✅ `type:types` / `scope:shared` / `type:api` / Deep import |
| generiert: api → core, api/core → `@angular/common/http` | erlaubt | ✅ |

Dazu Checks aus dem Graph: Tags je Teil-Lib (kein `port`/`entry`), Kante Teil → Client, `^generate` und der Hash des generierten Codes an jedem Lib-Target, `generate` gecacht mit Spec als Input und `src/generated` als Outputs. Weiter: nichts unter `src/generated/` committet, alles gitignored. Der Config-Datei-Wächter (Regex wie in `packages/tooling`) meldet nichts: generierter Code liegt unter `src/`, die Spec ist keine Config-Datei.

**Offen / Härtung:** `data` und `feature` dürfen generierte Services laut Matrix direkt nutzen. Soll nur der Port das dürfen, bräuchten generierte Services ein eigenes Type-Tag (z.B. `type:client`, erlaubt nur für `type:api`). `notDependOnLibsWithTags` taugt nicht, es ist transitiv.

### Sheriff nötig? Nein

Die Regel „Models dürfen keine Services importieren“ gilt **zwischen** zwei Libs (`types` ↔ `api`). Das prüft Nx selbst, und zwar auch in generierten Dateien. Belege:
- Verify-Fälle `generated code: types -> api/core`: blockiert.
- Lint-Probe auf einer Datei in `booking-client/types/src/generated/`:

| Kopf der Datei | Meldungen |
|---|---|
| Facade-Header (disable + enable boundaries) | `@nx/enforce-module-boundaries` |
| nur `/* eslint-disable */` | keine: Regel wäre stumm |
| kein Header | `@nx/enforce-module-boundaries`, `@typescript-eslint/no-explicit-any` |

Alternative ohne Aufteilen: eine Lib pro Client. Dann sind Imports innerhalb der Lib ungeprüft, `models/` → `api/` fiele nicht auf. Das ließe sich per Sheriff (`modules` im Client) oder `no-restricted-imports` pro Ordner lösen. Beides ist ein zweites Regelwerk. Für `no-restricted-imports` müsste man die Ordnernamen jedes Generators kennen (`model/`, `types.gen.ts`), das ist nicht generator-unabhängig. Zudem wären Models dann nur als `type:api` sichtbar, `ui` käme nicht an die Types. Verworfen.

## Nx-Targets und Abhängigkeiten

| Projekt | Target | Konfiguration |
|---|---|---|
| Client (`booking-generated-booking-client`) | `generate` | `./tools/openapi-facade:generate`, `cache: true`. Inputs: `{projectRoot}/openapi.yaml`, `{workspaceRoot}/<client>/*/src/index.ts` (welche Teile committet sind), `tools/openapi-facade/**`, Adapter-`packages` als `externalDependencies`, `openapitools.json`, Runtime `java -version 2>&1` (nur Java-Adapter). Outputs: `{projectRoot}/{types,api,core}/src/generated` |
| Client mit `url` | `update-spec` | nicht gecacht |
| jede Lib (auch Teil-Libs) | `lint`, `typecheck`, `build`, `test` | `dependsOn: ['^generate']` (build: `['^build', '^generate']`), Input `{ dependentTasksOutputFiles: '**/src/generated/**/*.ts', transitive: true }` |
| Teil-Lib | `implicitDependencies` | Client-Projekt; api → core, types; core → types |

- **`^generate` reicht über den Graph**, Konsumenten brauchen keine explizite Kante. `^` geht über Projekte ohne `generate` hinweg weiter. Beleg: generierter Code gelöscht, `nx run booking-data:typecheck` (booking-data → booking-api → Client-api) führt zuerst `booking-generated-booking-client:generate` aus.
- **Gitignored = für Nx unsichtbar.** Nx hasht keine gitignored Dateien und analysiert keine Imports daraus. Das hat drei Folgen:
  1. **Cache veraltet:** Ein Property in der Spec umbenannt → Client neu generiert, aber `booking-api:typecheck` kam **aus dem Cache** (grün statt TS2339). Fix: Input `dependentTasksOutputFiles` (hasht die Outputs der vorgelagerten `generate`-Tasks). Danach war die Probe rot wie erwartet, und der Rückbau kam wieder aus dem Cache.
  2. **Keine Kanten aus generiertem Code:** api → types/core und Teil → Client sind deshalb `implicitDependencies`. Ohne die Kante Teil → Client zeigte `nx show projects --affected --files <spec>` nur das Client-Projekt, jetzt 14 Projekte (Teile, Port, Konsumenten, App).
  3. `peerDependencies` in der dist-`package.json` der Teil-Libs sind leer (der ng-lib-Build leitet sie aus Graph-Kanten ab). Harmlos, weil `private`.
- **Cache:** Zweiter Lauf von `run-many -t build lint test typecheck generate`: 129/131 aus dem Cache (die 2 sind `sheriff-blueprint` ohne Cache, wie vorher). Nach `git clean -fdX libs` stellt `generate` die Dateien aus dem Cache wieder her (`[local cache]`). Eine Spec-Änderung generiert nur diesen Client neu.
- **IDE:** Nach `pnpm generate:clients` (= `nx run-many -t generate`) lösen die Aliase auf. Vorher meldet die IDE `Cannot find module './generated'` in den Teil-Libs und deren Konsumenten. Ein `postinstall`/`prepare`-Hook ist **nicht** empfohlen: jedes `pnpm install` bräuchte dann Java, beim ersten Mal Netz (Jar-Download) und liefe auch in CI-Schritten ohne Build. Build, Lint, Typecheck und Test generieren ohnehin selbst.

## Adapter-Vergleich

| | openapi-tools | hey-api | nx-plugin-openapi |
|---|---|---|---|
| Paket | `@openapitools/openapi-generator-cli` 2.41.0 + Jar 7.25.0 (`openapitools.json`) | `@hey-api/openapi-ts` **0.83.1** (gepinnt: ab 0.96 Node ≥ 22.13, ab 0.98 ≥ 22.18, lokal 22.16; Peer von nx-plugin-openapi) | `@nx-plugin-openapi/core`, `plugin-openapi`, `plugin-hey-api` 1.0.0 |
| Java | ja (JRE 11 lokal ok). Das Jar wird beim ersten Lauf nach `node_modules/…/versions` geladen (Netz), für CI ggf. `storageDir` | nein | je nach Backend |
| Ausgabe | `model/*.ts` → types, `api/*.service.ts` → api, Root (`configuration`, `variables`, `encoder`, `param`, `query.params`, `api.base.service`, `provide-api`) → core. Verworfen: `index.ts`, `api.module.ts` (NgModule-Altlast), README, `.openapi-generator/` | `types.gen.ts` → types, `sdk.gen.ts` + `@angular/common/http/{requests,resources}.gen.ts` → api, `client.gen.ts` + `client/**` + `core/**` → core. Verworfen: `index.ts` | identisch zum jeweiligen Backend (Klassifizierung wiederverwendet) |
| Angular 22 | `ngVersion` Default 22.0.0, standalone `provideApi(basePath\|config)`, `providedIn: 'root'`, Services per Konstruktor-DI (`@Inject`/`@Optional`) | `provideHeyApiClient(client)` bzw. `httpClient`/`injector` pro Aufruf. Angular-Plugin: injectable `…Requests` (liefert `HttpRequest`) und `…Resources` (`httpResource`) | wie Backend |
| Service-API | `BookingsService.listBookings(): Observable<Booking[]>` | `listBookings({ httpClient }): Promise<{ data, error, response }>` (Fehler als Wert, kein Throw) | wie Backend |
| Models | `interface` + `namespace { const … as const; type … }` für Enums = String-Union (Default `stringEnums` aus) | `type` mit Literal-Unions | wie Backend |
| Qualität | Kompiliert strict + ng-packagr. `// @ts-ignore` vor Imports, uneinheitliche Formatierung. **Falle:** `withInterfaces=false` als String wird als wahr gelesen (`api.ts` exportiert eine nicht existente Datei), deshalb nicht übergeben | Sauber typisiert, strict, modern. Runtime (~12 Dateien) wird pro Client mitgeneriert. 0.83: `requests.gen.ts` liefert `HttpRequest<unknown>` (Response-Typ verloren) | Delegation ok. Fallen: `root` = Workspace-Root, `outputPath` relativ, Plugin leert den Ordner, typescript-angular-Optionen nur per Config-Datei (`-c`), `@nx/devkit` 19 als feste Dependency → Peer-Warnung unter Nx 23 (funktioniert) |
| `generate` ohne Cache | booking-client ~2,3 s (JVM-Start) | pet-client (19 Operationen) ~1,2 s | wie Backend |

### Tausch-Beweis (booking-client, alles grün: `run-many -t build lint test typecheck`, 43 Projekte)

| Adapter in `nx.json` | Teile (types/api/core Dateien) | `booking/api` |
|---|---|---|
| `openapi-tools` (Stand im Branch) | 2 / 2 / 7 | Variante A |
| `hey-api` | 1 / 3 / 12 | Variante B |
| `nx-plugin-openapi` + `plugin: hey-api` | 1 / 3 / 12 | Variante B |
| `nx-plugin-openapi` + `plugin: openapi-tools` | 2 / 2 / 7 | Variante A |

Die einzige Anpassung ist der Port (`libs/booking/api/src/booking-api.ts`):

```ts
// A (openapi-tools): Observable + HttpErrorResponse
private readonly bookings = inject(BookingsService);
return (await firstValueFrom(this.bookings.listBookings(), { defaultValue: [] })).map(toBooking);
// catch HttpErrorResponse → throw new Error(`GET /api/bookings failed: ${status}`)

// B (hey-api): Promise + Fehler als Wert
private readonly http = inject(HttpClient);
const { data, response } = await listBookings({ httpClient: this.http });
if (!response) return [];                        // abgebrochen
if (!response.ok) throw new Error(`GET /api/bookings failed: ${response.status}`);
return (data ?? []).map(toBooking);
```

**Generator-unabhängig bleiben:** Pfade, Libs, Aliase, Tags, Boundaries, Targets, Cache-Inputs/Outputs, Lint-Header, `.gitignore`, alle Konsumenten des Ports (data, feature, checkin, Tests, MSW-Handler). **Generator-abhängig sind:** Service-API (Observable vs. Promise, Klasse vs. Funktion, Fehler-Modell), Provider-Konfiguration (`provideApi` vs. `provideHeyApiClient`/`httpClient`), Model-Form (interface+namespace vs. type) und die Namen (`BookingsService` vs. `listBookings`/`BookingsServiceRequests`).

**Einheitliche generierte Adapterschicht? Nein.** Der Domain-Port (`booking/api`, Tag `port`) übernimmt diese Rolle schon. Er mappt DTO → Domain, setzt Promise und Fehler-Semantik fest und ist die einzige Stelle, die beim Tausch angepasst wurde (ein Datei-Diff, 3 Zeilen Logik). Eine generierte Zwischenschicht bräuchte ein eigenes Template pro Adapter und nähme sich trotzdem den kleinsten gemeinsamen Nenner, `httpResource` etwa ginge verloren. Für shared Clients ohne Domain-Port (pet-client) nutzt der konsumierende api-Layer die generierte API direkt. Ein Tausch trifft dort alle Konsumenten, deshalb shared Clients hinter einen eigenen api-Wrapper legen, sobald es mehr als einen Konsumenten gibt.

## HttpClient und MSW

- Angular 22 stellt `HttpClient` `providedIn: 'root'` bereit, mit `FetchBackend` als Default. Die Tests brauchen deshalb **keine** Provider, MSW (Service Worker) sieht die Requests. In der App steht `provideHttpClient(withFetch())` trotzdem explizit (`app.config.ts`).
- `booking-data:test`, `booking-api:test` und `checkin-feat-checkin-feature:test` bleiben grün, mit allen vier Adaptervarianten.
- **Unterschied zu `fetch`:** HttpClient bricht laufende Requests ab, wenn der Injector zerstört wird (TestBed-Reset zwischen Specs). Das Observable endet dann **ohne Wert** → `firstValueFrom` wirft `EmptyError` als Unhandled Rejection (`feat-checkin.spec.ts`: der Test „0 arrivals“ endet vor der Antwort). Der Port behandelt „abgebrochen“ als „nichts geladen“: A mit `defaultValue: []`, B mit `!response`.
- Bundle: `main` 217 → 242 kB (HttpClient-Stack + generierter Service), keine msw/vitest-Spuren (Verify: 14 Dateien, 0 Treffer). `dist/libs/**/generated/<client>/{types,api,core}` ist gebaut wie jede Lib. `pet-client` taucht im App-Bundle nicht auf, weil ihn niemand importiert.

## Beweise (ausgeführt, eigener Nx-Cache, `NX_DAEMON=false`)

| Befehl | Ergebnis |
|---|---|
| `nx run-many -t build lint test typecheck` | grün, 43 Projekte + 2 `generate` |
| `pnpm verify:boundaries` | 100/100, Tag-Schema 42 Libs, Clients 2/6 Teile/33 Dateien 0 Probleme, Config-Dateien 0, Bundle 0 |
| Fresh Clone: `git clone` → `pnpm install --frozen-lockfile` → `nx run-many -t build lint typecheck test` (leerer Cache) | grün, 131 Tasks, generiert automatisch (`hey-api → 1/3/12`, `openapi-tools → 2/2/7`) |
| `git clean -fdX libs` → `nx run-many -t generate` | aus dem Cache wiederhergestellt |
| Spec geändert → `generate` | nur dieser Client läuft neu |
| Spec-Property umbenannt → `booking-api:typecheck` | rot (vor dem Fix: grün aus Cache) |
| 2× `generate --skip-nx-cache`, Hash über `src/generated/**` | identisch |
| `nx run generated-pet-client:update-spec` | „unverändert“. Lokal verändert → „aktualisiert“, danach `git diff` leer |
| Adapter-Tausch (4 Varianten) | jeweils `run-many -t build lint test typecheck` grün |
| Folgelauf | 129/131 aus dem Cache |

## Limitierungen

| Limitierung | Umgang |
|---|---|
| Gitignored Code ist für Nx unsichtbar (Hash, Kanten, peerDependencies) | `dependentTasksOutputFiles`-Input + `implicitDependencies`, im Verify geprüft. peerDependencies der generierten dist offen |
| Änderung der Client-Optionen in `nx.json` invalidiert den ganzen Cache | selten; Alternative `x-blueprint-client` in der Spec |
| Erster `generate` mit openapi-tools braucht Netz (Jar-Download in `node_modules`) und Java | `storageDir` in `openapitools.json` oder CI-Cache; hey-api braucht beides nicht |
| Teil-Libs müssen committet sein (`src/index.ts`). Liefert ein Adapter Dateien für einen fehlenden Teil → Fehler mit Hinweis. Ein `core` ohne Dateien bekommt `export {}` | ein `client`-Generator legt alle drei an |
| `data`/`feature` dürfen generierte Services laut Matrix direkt nutzen | Konvention „nur über Port“ oder eigenes Type-Tag (offen) |
| hey-api 0.83 statt aktuell 0.99 (Node 22.16) | bei Node ≥ 22.18 anheben; Klassifizierung prüfen (0.99 legt Angular-Code in `@angular/common.gen.ts`) |
| `nx-plugin-openapi` bringt `@nx/devkit` 19 mit | Peer-Warnung, funktional ok |
| Deep-Import-Liste im ESLint-Config filtert jetzt auf Projekte mit Alias; ohne den Filter hätte `@blueprint/generated/pet-client/**` die Teil-Aliase gesperrt | umgesetzt |

## Empfehlung für `packages/tooling`

1. **Konvention in `lib-conventions.ts`:** `generated`-Pfade (`libs/generated/<c>/<teil>`, `libs/<d>/generated/<c>/<teil>`) mit Teil ∈ `types|api|core` (später `testing`). Tags wie oben. Die neue Scope-Liste des Plugins muss `generated` als reservierten Ordner kennen, er ist kein Scope.
2. **Plugin:** Client-Projekt aus `openapi.yaml` + Optionen (`defaultAdapter`, `clients`) im selben Plugin-Eintrag wie die Libs. An allen Lib-Targets `^generate` + `dependentTasksOutputFiles`, an den Teil-Libs die Kanten.
3. **Executoren** `generate`/`update-spec` + Facade + Adapter nach `packages/tooling/src/openapi/`. Adapter als Registry, die Adapterpakete als optionale Peers.
4. **Generator `client`:** `--name`, `--domain` (oder shared), `--url` bzw. `--spec <datei>`, `--adapter`. Er legt `openapi.yaml` an (lädt einmal von der URL), dazu `types|api|core/src/index.ts` und den Eintrag in `nx.json`.
5. **Verify:** die Fälle und der Check „Generierte Clients“ aus `tools/verify-boundaries.mjs` übernehmen.
6. **Default-Adapter:** hey-api, wenn Java vermieden werden soll (Node-only, sauberere Typen, kein Jar/Netz). openapi-tools, wenn Observable-Services im Angular-DI-Stil gewünscht sind. Der Port kapselt beides.

## Offene Entscheidungen

- Default-Adapter: openapi-tools (Stand) oder hey-api?
- `data`/`feature` → generierte Services: per Matrix erlaubt lassen oder eigenes Tag (nur Port)?
- Client-Optionen: `nx.json` (Cache-Invalidierung) oder `x-blueprint-client` in der Spec?
- shared Clients: Pflicht-Wrapper im api-Layer?
- hey-api 0.83 → aktuell, sobald Node ≥ 22.18?
