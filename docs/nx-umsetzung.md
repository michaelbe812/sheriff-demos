# Blueprint mit reinen Nx-Mitteln

> **Branch `feat/nx-reduced-blueprint`: reduziertes Regelwerk.** Layer nur `types`/`utils`/`data`/`ui`/`feature` (+ `testing`), keine Ports (`port`/`feat-port`), keine Cross-Slice- und Geschwister-Feat-Imports, Auth in `shared/data`. Was sich gegenüber dem Text unten ändert (Lib-Struktur, Tag-Schema, depConstraints, Generator-Optionen, Verify-Fälle), steht in [`nx-reduziert.md`](./nx-reduziert.md). Build, Cache, Testing & MSW, OpenAPI-Clients, Namensschema und Tooling-Aufbau sind unverändert. Das Dokument ist auf den reduzierten Stand gebracht. Abschnitte mit Messwerten aus früheren Branches (Dateizählung, Cache-Experimente, Adapter-Tauschbeweis) sind als solche markiert.

Branch `feat/nx-blueprint-explicit-config` (abgezweigt von `feat/nx-blueprint` bei `8578b83`): das Regelwerk aus [`architecture.md`](./architecture.md) (Ausgangs-Blueprint, ohne `infra/`), aber **ohne Sheriff**. Die Grenzen erzwingen nur Nx-Libs, Tags und `@nx/enforce-module-boundaries` (Nx 23.1). Sheriff wird auch für Regeln *innerhalb* einer Lib nicht gebraucht (Begründung in [Entscheidung: Feat-Buckets als eigene Libs](#entscheidung-feat-buckets-als-eigene-libs)).

## Variante explizite Config

Dieser Branch ist `feat/nx-blueprint` **ohne Crystal-Magie**: kein lokales Nx-Plugin inferiert Projekte oder Targets, jede Lib trägt ihre Config-Dateien wieder selbst. Regelwerk, Libs, Tags, Constraints, Testing/MSW und OpenAPI-Clients sind unverändert, dist ist byte-identisch (580 Dateien, Snapshot unverändert).

**Unterschiede zu `feat/nx-blueprint`:**

| | `feat/nx-blueprint` (Zero-Config) | dieser Branch (explizit) |
|---|---|---|
| Projekte, Tags, Targets | Crystal-Plugins `@blueprint/tooling-workspace` + `@blueprint/tooling-openapi` in `nx.json` → `plugins` | `project.json` pro Lib (Name, Tags, `implicitDependencies`), Target-Bodies in `nx.json` → `targetDefaults`; keine `plugins` |
| Build | `@blueprint/tooling-ng-lib:build` erzeugt `ng-package.json`/`package.json`/tsconfig temporär | `@nx/angular:ng-packagr-lite` mit den Dateien der Lib |
| App gegen dist | `@blueprint/tooling-ng-lib:application` schreibt dist-Paths selbst | `@nx/angular:application` (`buildLibsFromSource: false`): Nx mappt den Alias über `name` der lib-`package.json` auf dist (Marker-Test grün) |
| Test | `@blueprint/tooling-ng-lib:test` mappt Build-Target + verengt spec-tsconfig | `@blueprint/tooling-ng-lib:test` reicht nur noch an `@nx/angular:unit-test` durch; bleibt wegen `--ui` (watch + headed + Hasher „nie aus dem Cache“) |
| typecheck | `typecheck-lib.mjs` verengt `libs/tsconfig.json` im Speicher | `tsc -p {projectRoot}/tsconfig.json` |
| `tsconfig.base.json` | ein Wildcard `@blueprint/*` | ein exakter Eintrag pro Lib (47) + Tooling (5); Deep-Import-Verbot daraus generiert |
| Scope-Liste | Plugin-Option in `nx.json`, Graph-Fehler bei Tippfehler | `lib-scopes.json`, `tooling-verify:verify` prüft Tags ↔ Pfad ↔ Liste |
| OpenAPI-Clients | Client-Projekte, Kanten und Testing-`generate` vom Plugin | `project.json` des Clients (`generate`, `update-spec`) und der Teil-Libs (Kanten, Testing-`generate`), vom Generator geschrieben |
| Config-Wächter | jede Config-Datei in `libs/` ist rot | jede fehlende oder falsche ist rot |
| component/service | eigene Templates (Nx findet inferierte Projekte nicht) | dünne Vorbelegung für `@nx/angular:component` / `@schematics/angular:service` |
| Namensregeln | Lib-Ordner (Layer, Scope, kebab-case) per Plugin (`libPathError`) → Graph-Fehler; Datei-/Symbolnamen per ESLint | Lib-Ordner per `tooling-verify:verify` (Ordnerregel im Tag-Schema) + Generatoren; ESLint-Regeln identisch. Lint-Inputs (`eslint-rules/src/**`, `lib-conventions.ts`) in `nx.json` → `targetDefaults` statt im Plugin, siehe [Namensschema](#namensschema) |

**Dateien pro Lib** (von den Generatoren geschrieben, Vorlage `packages/tooling/conventions/src/lib-files.ts`, von `verify` geprüft):

| Datei | wer | Inhalt |
|---|---|---|
| `project.json` | alle | Name (Pfad mit `-`), Tags aus dem Pfad, `targets` `{ build?, lint, typecheck, test? }` (leer, Bodies in `targetDefaults`), bei Client-Teilen `implicitDependencies` |
| `tsconfig.json` | alle | `extends` `tsconfig.base.json`, strict, es2022, `module: preserve`, `include: src/**/*.ts` (IDE + `typecheck`) |
| `package.json` | buildable (nicht `testing`) | `name` = Alias, `private`, `peerDependencies` = npm-Imports des Produktionscodes, `sideEffects: false` |
| `ng-package.json` | buildable | `dest` `dist/<root>`, `entryFile` `src/index.ts` |
| `tsconfig.lib.json`, `tsconfig.lib.prod.json` | buildable | Build ohne Specs, production ohne `declarationMap` |
| `tsconfig.spec.json` | Libs mit Specs | nur `src/**/*.spec.ts` + `*.d.ts` |

Dazu pro Client-Ordner `libs/[<d>/]generated/<client>/project.json`. Summe: 267 Dateien (47 Libs + 3 Client-Projekte) statt 0, `tsconfig.base.json` 52 statt 6 `paths`.

**Vorteile:**
- Keine Nx-Interna mehr für Build und App: Standard-Executoren, keine temporären Dateien; `@nx/angular:component` und `@schematics/angular:service` funktionieren wieder.
- Sichtbar: Tags und Targets stehen in der Lib (`project.json`), IDE, Nx Console und fremde Tools (`tsc -p`, ng-packagr) finden die Dateien, die sie erwarten.
- Keine Graph-Berechnung durch eigenen Code (kein Plugin-Worker, kein Dateisystem-Scan pro Lib); ein Tippfehler im Ordner bricht nicht mehr den ganzen Graph.
- Feiner für `affected`/Cache: Generatoren und Plugins sind kein Input der Lib-Tasks mehr (`lint` hing vorher an beiden Plugins); `lib-conventions.ts` nur noch für `lint` (Namensregeln), nicht für `build`/`test`/`typecheck`.
- Einzelne Lib kann abweichen (eigene Compiler-Optionen, zusätzliches Target), ohne Plugin-Option.

**Nachteile:**
- 267 Dateien Boilerplate, fast alle gleich; Pflege über Generatoren (`move`/`rename`/`remove` ziehen Name, Tags, Alias, relative Pfade, `paths`, `implicitDependencies` nach).
- Tags sind wieder handeditierbar: Tippfehler fängt nicht mehr der Graph, sondern erst `tooling-verify:verify` (Tags ↔ Pfad ↔ `lib-scopes.json`).
- `peerDependencies` sind statisch: der Generator leitet sie einmal aus den Imports ab, danach prüft `verify` die Übereinstimmung (rot statt still veraltet).
- Adapterwechsel eines Clients = `openapi-clients.json` + Adapter-Inputs in `project.json` (verify meldet die Abweichung).
- Nx liest die lib-`package.json` mit: jede buildable Lib trägt zusätzlich das Tag `npm:private` (ohne Constraint, harmlos).
- Neue Lib nur per Generator bequem; von Hand müssen alle Dateien + `paths`-Eintrag stimmen.

## Lib-Struktur: eine Lib pro Slice × Layer

```
apps/client/src/            type:app            dünne Shell: main.ts, app.ts, app.config.ts, app.routes.ts
libs/
  <slice>/                  booking, checkin (Domains) · layout (nur von der App komponiert)
    types/ utils/ data/ ui/                 scope:<slice> type:<layer> feat:none   (data = HTTP + Stores + Events)
    shell/                                  type:feature + entry   routes/providers/shell = Slice-Root
    feat-<feat>/
      feature/                              scope:<slice> type:feature feat:<feat>
      data/ ui/ …                           feat:<feat>   (kein feat-port)
  shared/types|utils|data|ui                scope:shared type:<layer> feat:none   (shared/data: ApiHttp, PetApi, AuthStore)
  <domain>/testing, shared/testing          scope:<d>|shared type:testing feat:none   nur für Specs, siehe Testing & MSW
  generated/<client>/types|api|core|testing           scope:shared      ┐ generierte OpenAPI-Clients, Marker `generated`,
  <domain>/generated/<client>/types|api|core|testing  scope:<domain>    ┘ api/core = type:data, nur index.ts committet, siehe OpenAPI-Clients
```

- Jede Lib = Ordner + `src/index.ts` als **einzige** öffentliche API, daneben ihre Config-Dateien (`project.json`, `tsconfig*.json`, bei buildable Libs `package.json` + `ng-package.json`, siehe [Explizite Config pro Lib](#explizite-config-pro-lib)). `tooling-verify:verify` meldet jede fehlende oder falsche Datei.
- Neue Domains, Libs und Feats legen die Generatoren an (siehe [Tooling & Generatoren](#tooling--generatoren)).
- Alias: `@blueprint/<pfad-unter-libs>`, z.B. `@blueprint/booking/data` oder `@blueprint/checkin/feat-checkin/data`. Ein exakter Eintrag pro Lib in `tsconfig.base.json` (`@blueprint/booking/data` → `./libs/booking/data/src/index.ts`), kein Wildcard.
- Projektname = Pfad mit `-` (`booking-feat-check-booking-data`), steht in `project.json`.
- `booking.routes.ts`/`checkin.routes.ts` exportieren jetzt benannt (`bookingRoutes`), weil `export *` keinen Default re-exportiert.
- Ein lib-privater Ordner `internal/` (z.B. `checkin/data/src/internal/checkin.mapper.ts`) ist bloße Konvention. Privat ist die Datei, weil `index.ts` sie nicht exportiert.

**Kosten:** 23 Libs (booking 9, checkin 8, layout 2, shared 4; vor der Reduktion 32) statt 2, dazu 3 Testing-Libs und 12 Libs der 3 Beispiel-Clients (je types/api/core/testing, nur `index.ts` committet). Pro Lib 2–7 Config-Dateien, Zählung siehe [Dateizählung](#dateizählung).

## Buildable Libs

Jede Lib außer den Testing-Libs hat ein `build`-Target: `@nx/angular:ng-packagr-lite` (`ng-packagr` ~22.0, incremental buildable). Die Target-Config steht in `nx.json` → `targetDefaults.build` (`dependsOn: ["^build", "^generate"]`, cache, Output `dist/{projectRoot}`, `project: {projectRoot}/ng-package.json`, `tsConfig: {projectRoot}/tsconfig.lib.json`, production → `tsconfig.lib.prod.json`), die `project.json` der Lib trägt nur `"build": {}`.

- **Dateien der Lib:** `ng-package.json` (`dest`, `entryFile`), `package.json` (`name` = Alias, `private`, `peerDependencies`, `sideEffects: false`), `tsconfig.lib.json` (erweitert `tsconfig.json`, Declarations, ohne Specs), `tsconfig.lib.prod.json` (ohne `declarationMap`).
- **Alias → dist:** Nx (`@nx/js` `calculateProjectBuildableDependencies`) nimmt den Import-Namen einer Abhängigkeit aus deren `package.json` (`metadata.js.packageName`). Beim Lib-Build und beim App-Build mit `buildLibsFromSource: false` schreibt Nx die Paths der gebauten Abhängigkeiten deshalb selbst auf `dist/` um. Auf `feat/nx-blueprint` fehlte die lib-`package.json`, dafür gab es die Wrapper `ng-lib:build`/`:application`; hier entfallen sie.
- **peerDependencies nur aus Produktionscode:** der Generator leitet sie aus den Imports der Quellen ohne Specs ab (`^<major>.0.0` der Root-`package.json`, ohne `tslib`), `verify` prüft die Übereinstimmung bei jedem Lauf (sonst stand z.B. `vitest` aus Spec-Imports drin). Generierte Client-Teile haben keine (gitignored Code, dist wie vorher).
- **dist ist byte-identisch** zu `feat/nx-blueprint` (580 Dateien, Snapshot `packages/tooling/verify/nx-internals/dist-hashes.json` unverändert), inkl. der `package.json` in dist (gleiche Schlüsselreihenfolge und peers).
- **Incremental:** Beim Lib-Build schreibt Nx die Pfade abhängiger Libs auf `dist/` um. Ohne gebaute Abhängigkeit schlägt der Build fehl (`TS2307`), `dependsOn: ^build` sorgt für die Reihenfolge.
- **App:** `client:build` nutzt `@nx/angular:application` mit `buildLibsFromSource: false`, bündelt also die gebauten Libs aus `dist/`. Beleg (Marker-Test, auch in `verify:nx-internals`): Text in `dist/libs/layout/ui/esm2022/nav-bar.js` ersetzt, `nx run client:build --skip-nx-cache --exclude-task-dependencies` → Marker im `main-*.js`, nicht in den Quellen. `serve` (`@angular/build:dev-server`) baut weiterhin aus den Sources. Für `serve` gegen `dist/` bräuchte es `@nx/angular:dev-server` und damit `@angular-devkit/build-angular`, deshalb bewusst nicht umgesetzt.
- **Source-Aliase bleiben:** `tsconfig.base.json` zeigt weiter auf `src/index.ts` (IDE, `typecheck`, Lint).
- **Output:** `ng-packagr-lite` erzeugt `esm2022/` (eine Datei pro Quelldatei) + `.d.ts`, in *full compilation mode*, ohne FESM-Bundle. Das reicht für das App-Bundling, ist aber nicht publizierbar (deshalb `private: true`). Publizierbar wäre `@nx/angular:package` (FESM2022 + partial compilation).
- **`enforceBuildableLibDependency`** bleibt an. Jede Lib außer den Testing-Libs hat `build`, die Regel greift also bei Imports von Testing-Libs in Produktionscode.

## Explizite Config pro Lib

Jede Lib trägt ihre Config selbst, kein Plugin leitet etwas ab. Eine neue Lib legt ein Generator an:

```sh
nx g @blueprint/tooling-workspace:layer checkin utils
# → libs/checkin/utils/src/{index.ts,checkin.utils.ts}
#   + project.json (checkin-utils, Tags scope:checkin type:utils feat:none, Targets build/lint/typecheck),
#     package.json, ng-package.json, tsconfig.json, tsconfig.lib.json, tsconfig.lib.prod.json
#   + tsconfig.base.json paths["@blueprint/checkin/utils"]
```

Von Hand geht es auch: alle Dateien wie in einer Nachbar-Lib, Tags passend zum Pfad, Scope in `lib-scopes.json`, `paths`-Eintrag. Specs dazulegen (`src/**/*.spec.ts`) braucht zusätzlich `tsconfig.spec.json` + `"test": {}` (der Domain-Generator macht das für die Beispiel-Spec). Ein Ordner `testing` statt eines Layers ist eine Testing-Lib (`type:testing`, kein `build`, keine Build-Dateien). `tooling-verify:verify` beweist bei jedem Lauf mit zwei temporären Libs in `libs/booking/feat-tmpverify/` (`ui`, `types`, mit den Dateien der Generatoren): Projekt, Tags und Targets stimmen, 8 Lint-Fälle gegen und von ihnen greifen; eine dritte Lib nur mit `src/index.ts` meldet der Config-Wächter (7 Meldungen). Danach wird alles entfernt und `tsconfig.base.json` wiederhergestellt.

### Bausteine

| Baustein | Aufgabe |
|---|---|
| `libs/**/project.json` | Name, Tags, `implicitDependencies` (Client-Teile), Targets als leere Einträge |
| `nx.json` → `targetDefaults` | Bodies von `lint`, `typecheck`, `build`, `test` (per Target-Name) und `@nx/angular:application` (App): Executor, Optionen mit `{projectRoot}`, Inputs, `dependsOn` inkl. `^generate`, Cache |
| `tsconfig.base.json` | ein exakter `paths`-Eintrag pro Lib (47) und pro Tooling-Export (5) |
| `lib-scopes.json` | Scope-Liste (`{ "scopes": [...] }`), gegen Ordner-Tippfehler, von den Generatoren gepflegt, von `verify` geprüft. Eigene Datei statt `nx.json`: jede `nx.json`-Änderung invalidiert den ganzen Cache |
| `packages/tooling/conventions/src/lib-files.ts` | Vorlage aller Config-Dateien (`libConfigFiles`), Umzug (`relocateConfig`); `src/tree.ts` schreibt sie samt `paths` (`writeLibConfig`, `relocateLibConfig`, `removeLibPaths`, `updateImplicitDependencies`) |
| `packages/tooling/ng-lib/src/test.js` | einziger verbliebener Executor-Wrapper: `@nx/angular:unit-test` + Vitest UI per `--ui` (unten) |
| `eslint.config.mjs` | Tags aus dem Projekt-Graph (= `project.json`), Deep-Import-Verbot aus den `paths` |

`targetDefaults` per Target-Name gelten für jedes Projekt mit gleichnamigem Target, aber nur, wenn Executor/Kommando kompatibel sind: `client:build` (`@nx/angular:application`), `sheriff-blueprint:build` (`nx:run-commands`) und die `test`-Targets der Tooling-Libs bleiben unberührt. Die `typecheck`-Targets der Tooling-Libs sind ebenfalls `nx:run-commands`; Nx mischt dort `dependsOn` hinein, deshalb setzen sie `"dependsOn": []` explizit.

Targets (Bodies in `targetDefaults`):

| Target | Executor | Wann |
|---|---|---|
| `lint` | `nx:run-commands` → `eslint .` im Lib-Ordner | immer |
| `typecheck` | `nx:run-commands` → `tsc -p {projectRoot}/tsconfig.json` | immer |
| `build` | `@nx/angular:ng-packagr-lite` | nicht für `testing` |
| `test` | `@blueprint/tooling-ng-lib:test` (→ `@nx/angular:unit-test`, headless, einmalig, gecacht). Vitest UI über dasselbe Target: `nx run <lib>:test --ui` | nur Libs mit `*.spec.ts` (`tsconfig.spec.json`) |

Es gibt genau ein Test-Target. **Vitest UI** ist ein Flag, keine Configuration: `--ui` schaltet im Executor watch und headed Chromium ein (`chromiumHeadless` → `chromium`, `--headless` erzwingt weiter headless). Eine Configuration `test:ui` wäre eine zweite Optionsmenge pro Lib im Graphen; das Flag hält die UI-Logik an einer Stelle (Executor). **Cache:** Nx hasht Overrides mit, ein `--ui`-Lauf trifft also nie den Eintrag des normalen `test` (und umgekehrt). Beendet man die UI regulär (Vitest `q`), meldet der Builder aber Erfolg, und Nx cachte den Lauf unter dem UI-Hash, der nächste `--ui`-Aufruf spielte nur die alte Ausgabe ab. Dagegen hat der Executor einen eigenen Hasher (`executors.json` → `hasher`, `src/test-hasher.js`): mit `ui` ein einmaliger Hash (nie ein Treffer), ohne `ui` unverändert der Nx-Hash. `verify:nx-internals` prüft, dass Nx den Hasher lädt.

### Executor-Wrapper (`packages/tooling/ng-lib`)

Von den drei Wrappern auf `feat/nx-blueprint` bleibt einer:

| Wrapper auf `feat/nx-blueprint` | hier | Grund |
|---|---|---|
| `build` (temporäre `ng-package.json`, `package.json`, tsconfig mit dist-Paths) | entfernt → `@nx/angular:ng-packagr-lite` | die Dateien liegen in der Lib, den dist-Remap macht Nx über die lib-`package.json` |
| `application` (tsconfig mit dist-Paths der Libs) | entfernt → `@nx/angular:application` | Nx kennt den Alias aus der lib-`package.json`, Marker-Test grün |
| `test` (Build-Target als `@angular/build:ng-packagr` im Builder-Context, spec-tsconfig pro Lib) | geschrumpft auf Durchreichen + `--ui` | echte `ng-package.json` und `tsconfig.spec.json`; `@nx/angular:unit-test` mappt `ng-packagr-lite` selbst. Ein Hasher lässt sich nur an einen eigenen Executor hängen, deshalb bleibt der Wrapper für die UI |
| Skript `typecheck-lib.mjs` | entfernt → `tsc -p` | lib-eigene `tsconfig.json` |

`@nx/angular:unit-test` direkt einzutragen geht (getestet, Tests grün); dann wäre die UI `nx run <lib>:test --ui --watch --browsers=chromium --skip-nx-cache` und ein regulär beendeter UI-Lauf landete im Cache.

Browser Mode, MSW-Worker und die Workarounds in `vitest-base.config.mts` sind unberührt (`runnerConfig` wie bisher).

### Cache-Inputs

Gemeinsame Dateien liegen außerhalb von `{projectRoot}` und stehen deshalb explizit in den Inputs (`targetDefaults`); die lib-eigenen Config-Dateien sind über `default`/`production` dabei:

| Target | zusätzliche Inputs |
|---|---|
| `lint` (Libs) | `eslint.config.mjs`, `tsconfig.base.json` (Deep-Import-Verbot aus den `paths`), `packages/tooling/conventions/src/lib-conventions.ts` + `packages/tooling/eslint-rules/src/**` ohne Specs (Namensregeln), `eslint`, `angular-eslint`, `typescript-eslint` |
| `@nx/eslint:lint` (`client`, Tooling) | `eslint.config.mjs`, dieselben Namensregel-Inputs (die Config lädt die Regeln für jeden Lint-Lauf) |
| `typecheck` | `tsconfig.base.json`, `typescript` |
| `build` | `production`, `^production`, `tsconfig.base.json`, `ng-packagr`, `@angular/compiler-cli`, `typescript` |
| `test` | `default`, `^production`, `tsconfig.base.json`, `vitest-base.config.mts`, `packages/tooling/ng-lib/src/**`, `vitest`, `@vitest/browser-playwright`, `msw`, `openapi-msw`, `@faker-js/faker`, `@angular/build` |
| `client:build` (`targetDefaults`) | `production`, `^production`, `tsconfig.base.json` |
| `tooling-verify:verify` | `libs/**`, `apps/**`, `eslint.config.mjs`, `nx.json`, `openapi-clients.json`, `lib-scopes.json`, `tsconfig.base.json`, Skript, Output von `client:build` (dependsOn), `eslint`, `@nx/eslint-plugin`, `nx` |

Alle Lib-Targets hashen zusätzlich den generierten Code ihrer Abhängigkeiten (`dependentTasksOutputFiles`, siehe [OpenAPI-Clients](#targets-und-abhängigkeiten)). `production` schließt `tsconfig.spec.json` aus. Die Plugins sind kein Input mehr: Tags stehen in `project.json` (Input über `default`). `lib-conventions.ts` ist nur `lint`-Input, weil die Namensregeln daraus lesen. `nx show target booking-data:test --inputs` zeigt die aufgelösten Inputs.

### Dateizählung

| | explizit vor dem Plugin (`2857237`) | `feat/nx-blueprint` (Zero-Config) | dieser Branch |
|---|---|---|---|
| Config-Dateien in `libs/` außerhalb `src/` | 202 (35 Libs: 35 `project.json`, 35 `tsconfig.json`, 32 `package.json`, 32 `ng-package.json`, 32 `tsconfig.lib.json`, 32 `tsconfig.lib.prod.json`, 4 `tsconfig.spec.json`) | 0 (+ 3 gemeinsame `libs/tsconfig*.json`) | 267 (47 Libs + 3 Client-Projekte: 50 `project.json`, 47 `tsconfig.json`, 41 `package.json`, 41 `ng-package.json`, 41 `tsconfig.lib.json`, 41 `tsconfig.lib.prod.json`, 6 `tsconfig.spec.json`) |
| `paths` in `tsconfig.base.json` | 35 | 1 Wildcard + 5 Tooling | 47 + 5 Tooling |
| lokale Nx-Plugins / Executor-Wrapper | 0 / 0 | 2 / 3 (+ typecheck-Skript) | 0 / 1 (`test`, nur für `--ui`) |
| Tasks `run-many -t build lint test typecheck` | 111 | 157 + 6 `generate` | 157 + 6 `generate` (dieselben) |
| dist (32 Libs + 12 Client-Libs + App) | – | 580 Dateien | byte-identisch |

### Kosten und Trade-offs

- **Boilerplate:** 267 fast gleiche Dateien. Generatoren schreiben und pflegen sie (`move`/`rename` ziehen Name, Tags, Alias, `dest`, relative `extends`, Pfade in Client-Targets, `paths` und `implicitDependencies` anderer Projekte nach; `remove` nimmt `paths` und Kanten mit). Von Hand bearbeitet, hält `verify` sie ehrlich.
- **Weniger Nx-Interna:** nur noch `@nx/angular/src/executors/unit-test/unit-test.impl` (Import im Test-Wrapper) und das Laden eines Executor-`hasher`. Build und App laufen über die öffentlichen Executoren.
- **Nach jedem `nx migrate` (und Angular-Update) die Beweise neu laufen lassen:** `pnpm verify:nx-internals` (run-many mit `--skip-nx-cache`, dist-Äquivalenz gegen Snapshot oder `--reference`, Marker-Test App-gegen-dist, MSW-Probe fehlender Handler, MSW-Worker aus dem msw-Paket, UI-Hasher, `tooling-verify:verify`), siehe [Tooling & Generatoren](#tooling--generatoren).
- **Nx-Standardgeneratoren funktionieren wieder:** `@nx/angular:component` findet die Lib über `project.json`, `@schematics/angular:service` mit `--project`. Die eigenen `component`/`service` sind nur noch Vorbelegung + Layer-Prüfung, siehe [Tooling & Generatoren](#tooling--generatoren).
- **Tags wieder in Dateien:** Tippfehler (`scope:bookng`, `libs/bokking/…`) bricht nicht mehr den Graph, sondern `tooling-verify:verify` (CI, Probe: 5 Meldungen für Tag-Tippfehler, fehlenden `paths`-Eintrag, fehlende peers, Scope nicht in der Liste, veralteten Listeneintrag). `nx lint` erkennt ihn nicht als Tippfehler: `scope:bookng` wäre einfach ein neuer Scope mit eigener generierter Constraint.
- **`npm:private`:** Nx liest die lib-`package.json` mit und vergibt jeder buildable Lib zusätzlich dieses Tag. Keine Constraint nutzt es.
- `typecheck` prüft Specs mit (wie vorher mit `include: src/**/*.ts`).

## Tag-Schema

| Achse | Tags | Wo |
|---|---|---|
| Scope | `scope:<slice>`, `scope:shared` | jede Lib |
| Type | `type:types\|utils\|data\|ui\|feature`, `type:app`, `type:tooling`, `type:testing` | jede Lib/App/Package |
| Feat | `feat:<feat>` bzw. `feat:none` | jede Lib |
| Marker | `entry`, `generated` | Slice-shell, generierte Client-Libs (siehe [OpenAPI-Clients](#openapi-clients)). Keine Ports |
| Tooling | `tooling:conventions\|workspace\|openapi\|ng-lib\|verify` | Tooling-Libs in `packages/tooling/*` (siehe [Tooling & Generatoren](#tooling--generatoren)) |

## depConstraints (`eslint.config.mjs`)

Nx wendet **alle** Constraints an, die auf die Tags der Quelle passen, und verknüpft sie mit UND. Innerhalb einer Constraint reicht **ein** passendes Ziel-Tag (ODER). Das ist dieselbe Semantik wie bei den Sheriff-depRules. Marker-Tags brauchen deshalb keine transparente `anyTag`-Regel: für ein Tag ohne Constraint gilt einfach nichts.

```js
// Layer-Matrix (reduziert: kein api, kein events — beides in data)
type:types   -> types                      + bannedExternalImports ['*']   (Scope-Regeln gelten: shared → shared, Domain → eigene + shared)
type:utils   -> types, utils
type:data    -> types, utils, data         (HTTP, Stores, Events; generierte api/core sind type:data)
type:ui      -> types, utils, ui
type:feature -> alle Produktions-Layer     (kein `type:*`-Glob mehr, er träfe type:testing)
type:app     -> entry, scope:shared        UND nur Produktions-Layer
type:testing -> types, testing, scope:shared
// sameTag-Ersatz, generiert aus den vorhandenen Tags — ohne Ports
scope:shared -> scope:shared
scope:<s>    -> scope:<s>, scope:shared                 (je Slice: nie ein fremder Slice)
feat:<f>     -> feat:<f>, feat:none                     (je Feat: nie ein Geschwister-Feat)
// Nx-Extra
utils|ui|feature: bannedExternalImports ['@angular/common/http']
Produktions-Layer + app:      bannedExternalImports [msw, msw/*, vitest, vitest/*, @vitest/*, @testing-library/*, playwright, playwright/*]
// Override für *.spec.ts, *.test.ts, test-setup.ts: Layer-Constraints + type:testing; scope:*/feat:* unverändert (kein fremdes testing)
```

**Wie wird `sameTag` ausgedrückt?** Gar nicht direkt: Nx kann aus einem Ziel-Tag nicht auf das Quell-Tag zurückverweisen. Deshalb gibt es eine Constraint pro Scope und eine pro Feat. `sameTagConstraints()` in `eslint.config.mjs` liest dazu die Tags aller Projekte aus dem Projekt-Graph (= die Tags der `project.json`) und erzeugt die Constraints aus den vorhandenen `scope:*`- und `feat:*`-Tags. Ein neuer Slice ist abgedeckt, sobald die `project.json` seiner ersten Lib den Tag trägt. Eine Liste muss niemand pflegen.

Zusätzlich verbietet `no-restricted-imports` Deep-Imports: generiert aus den exakten Lib-Einträgen der `tsconfig.base.json`-Paths (Ziel unter `./libs/`), Muster `<alias>/**`.

## Mapping Sheriff-Regel → Nx

| Sheriff (architecture.md) | Nx-Konstrukt |
|---|---|
| Layer-Matrix `type:*` | `onlyDependOnLibsWithTags` je `type:*` |
| `type:feature` → alle `type:` | explizite Liste der Produktions-Layer (Glob `type:*` träfe `type:testing`) |
| `domain:*`: eigene Domain, fremde nur `port`, `shared` (`sameTag`) | generierte Constraint je `scope:<s>`: eigener Scope + `scope:shared`, **kein Port** (reduziert) |
| Shared-Features (`sharedFeatures`-Liste) | `layout` ist ein normaler Slice (`scope:layout`), nur von der App komponiert. Auth liegt ohne Ports in `shared/data` |
| `shared` → nur shared | `scope:shared` → `scope:shared` |
| `feat:*`: eigenes Feat, alles außerhalb `feat-*`, Geschwister nur `feat-port` (`sameTag` + Pfad-Guard `inAnyFeat`) | generierte Constraint je `feat:<f>`: eigenes Feat + `feat:none`, **kein feat-port** (reduziert). „Außerhalb `feat-*`“ wird zum positiven Marker `feat:none` |
| `app:*`/`root`: nur entry, port, shared | `type:app` → `entry, scope:shared` (main.ts und app/ sind ein Projekt) |
| App-Isolation `sameApp` (pfadbasiert) | Nx-Builtin: Apps sind nicht importierbar (`noImportsOfApps`, relative/absolute Imports über Projektgrenzen verboten) |
| `noTag: noDependencies` | Nx-Builtin `projectWithoutTagsCannotHaveDependencies` |
| Barrel-less + Encapsulation `internal/` | `index.ts` = Public API. TS-Paths lösen nur `index.ts` auf, dazu `noRelativeOrAbsoluteImportsAcrossLibraries` und `no-restricted-imports` gegen Deep-Imports |
| Intra-Modul-Imports ungeprüft (lokaler Store im ui-Bucket) | intra-Lib-Imports ungeprüft, identisch |
| `entryPoints` / `sheriff verify` | entfällt: `nx lint` prüft jede Datei jeder Lib, nicht nur die erreichbaren |
| `checkDynamicDependenciesExceptions` | entfällt: die App importiert Shells nur lazy. Der statische Import einer lazy geladenen Lib wird korrekt geblockt |

## Entscheidung: Feat-Buckets als eigene Libs

`feat-<x>/data` und `/ui` sind **eigene Libs**. Sie sind nicht bloß Ordner einer Feat-Lib, deren Innenleben Sheriff regeln müsste. Gründe:

- Die Layer-Matrix gilt im Feat genauso (feat-ui darf feat-data nicht importieren). Innerhalb einer Lib sieht Nx nichts; dafür bräuchte man Sheriff als zweite Regelsprache.
- Mit eigenen Libs gibt es keine Sheriff-Abhängigkeit und keinen Build-Zwang für das Config-Package. Eine Regelsprache genügt.
- Preis: +3 Libs im Beispiel (`feat-check-booking/data|ui`, `feat-checkin/data`). Pro Feat kostet jeder genutzte Bucket eine Lib.

Alternative, falls die Lib-Anzahl stört: eine Lib pro Feat, dazu Sheriff nur mit `modules` für die Buckets innerhalb von `libs/*/feat-*/src`. Verworfen, weil dann wieder zwei Regelwerke parallel gepflegt würden.

## Was Nx besser kann

- **Cache/affected pro Layer:** Eine Änderung in `booking/ui` betrifft nur `ui`, `feature`, `shell` und die App, nicht `data`.
- **Zyklen** zwischen Libs werden erkannt (`noCircularDependencies`). Im Sheriff-Setup wurden sie nicht geprüft.
- **`bannedExternalImports`:** npm-Regeln pro Tag, z.B. `types` framework-frei, HTTP nur in `data`. Sheriff Upstream kann das nicht, dafür bräuchte man den Fork (`externalRules`).
- **Lazy-Load-Schutz:** Ein statischer Import einer lazy geladenen Lib würde das Lazy Loading still aushebeln. Nx meldet ihn im Lint.
- **Kein Config-Build:** Sheriff musste das Blueprint-Package gebaut in `node_modules` haben. Nx liest schlichtes `eslint.config.mjs`.
- **Public API durch TypeScript:** Ein Deep-Import ist nicht nur ein Lint-Fehler, er lässt sich gar nicht erst auflösen.
- Graph-Visualisierung (`nx graph`) und Nx Console.

## Limitierungen und Lösungen

| Limitierung | Lösung |
|---|---|
| Kein `sameTag`, keine Rückreferenz Quelle→Ziel | Constraints je Scope/Feat aus den Graph-Tags generiert (Workaround) |
| Keine Negation („kein `feat-*`“); `notDependOnLibsWithTags` ist **transitiv** (prüft alle erreichbaren Libs) und taugt deshalb nicht für „nur direkt verboten“ | Positiver Marker `feat:none` auf allen Nicht-Feat-Libs (Konvention, im Verify-Skript geprüft) |
| Tag-Tippfehler (`scope:bookng`) würde still einen neuen Scope erzeugen; Nx prüft Tags nicht gegen Ordner | `packages/tooling/verify/scripts/verify-boundaries.mjs` leitet die Tags unabhängig aus dem Pfad ab und vergleicht sie mit der `project.json` jeder Lib (Scope, Type, Feat, `entry`, `generated`), prüft den Scope gegen `lib-scopes.json` (Ordner-Tippfehler `libs/bokking/…`), dass jede `src/index.ts` ein Projekt ist und die Liste keine Einträge ohne Lib hat. Die Generatoren schreiben die Tags aus dem Pfad (`deriveTags`), von Hand muss niemand Tags tippen |
| Die Regel erkennt Deep-Imports über einen Alias nicht (`@blueprint/checkin/data/src/…` passiert die Tag-Prüfung) | `no-restricted-imports` generiert aus den `paths` (`@blueprint/<lib>/**`); TS löst den Import ohnehin nicht auf |
| Zyklen werden **vor** Tags geprüft: ein Aufwärts-Import im Slice (utils→data) meldet sich oft als „Circular dependency“ statt als Layer-Verstoß | geblockt ist er trotzdem, nur mit anderer Meldung. Das Verify-Skript testet beide Varianten |
| Ohne gecachten Projekt-Graph **überspringt** die Nx-Regel still (nur eine Warnung), z.B. bei `eslint` direkt oder in der IDE nach frischem Clone/`nx reset` | `nx lint` baut den Graph selbst. Für alle anderen Aufrufer baut `eslint.config.mjs` ihn per `ensureProjectGraph()` (top-level `await`), falls er fehlt. Geprüft: echter Verstoß in `booking-ui`, leeres `workspace-data`, `eslint <datei>` → Fehler statt Skip |
| App-interne Slices (Phase 1 des Sheriff-Blueprints) sind nicht prüfbar: eine App ist ein Projekt | alles, was Regeln braucht, lebt in Libs, die App ist dünne Shell (Konvention) |
| Domain-shared → Feat-Lib (z.B. `booking/data` → `feat-check-booking/data`) ist erlaubt, wie bei Sheriff | bewusst 1:1 übernommen. Härtung wäre möglich per `allSourceTags: ['feat:none', 'type:data']` → `feat:none` |
| Die Generatoren des `sheriff-blueprint`-Packages erzeugen das Sheriff-Layout (Ordner statt Libs). `@nx/angular:library` erzeugt `project.json`, `tsconfig*.json`, `ng-package.json` usw., aber nicht nach der Blueprint-Konvention (Tags, Pfad, `paths`, Scope-Liste, vitest-Setup) | eigene Generatoren in `packages/tooling` (domain, layer, feat, testing, move, rename, remove, store; component/service als Vorbelegung für die Nx-/Angular-Generatoren), siehe [Tooling & Generatoren](#tooling--generatoren) |

## Paket `packages/sheriff-blueprint`

> **Veraltet auf diesem Branch.** Die Generatoren `@berger-engineering/sheriff-blueprint:domain|feat|shared-feature` erzeugen das Sheriff-Layout (Ordner in einer Lib, `project.json`, Wildcard-Alias `@blueprint/domains/<d>/*`) und passen nicht zu einer Lib pro Slice × Layer. Stattdessen `@blueprint/tooling-workspace` / `@blueprint/tooling-openapi` benutzen, siehe [Tooling & Generatoren](#tooling--generatoren).

Das Paket bleibt unverändert, samt `createSheriffConfig`, `nxModuleBoundariesOptions` und Generatoren. In diesem Workspace wird es aber nicht mehr benutzt: `sheriff.config.ts` und `@softarc/eslint-plugin-sheriff` sind entfernt. Die e2e-Specs laufen nur, wenn es im Workspace eine `sheriff.config.ts` gibt (`describe.skipIf`). Unit- und Generator-Tests laufen weiter, seit dem Testing-Umbau auf Vitest 4 (23 passed, 6 skipped).

## Testing & MSW

Unit- und Komponententests laufen **nur im Vitest Browser Mode** (Chromium headless über Playwright), kein jsdom. HTTP mockt [MSW](https://mswjs.io/docs/recipes/vitest-browser-mode/) per Service Worker: Die echte `BookingApi` (HttpClient) bzw. `ApiHttp` (`fetch`) schickt den Request, MSW beantwortet den Request im Browser.

### Struktur

```
libs/shared/testing/          scope:shared  type:testing  feat:none   kein build-Target
  src/network.ts                `worker` (setupWorker aus msw/browser) + `test` mit Auto-Fixture `worker` (+ `faker.seed(FAKER_SEED)` pro Test)
libs/<domain>/testing/        scope:<domain> type:testing feat:none   kein build-Target
  src/fixtures/                 Builder: aBooking(), aCheckinDto(), anArrival()
  src/handlers/                 <domain>Handlers (Normalfall), <domain>Scenarios (empty, serverError, with…)
vitest-base.config.mts        runnerConfig: msw-Prebundle-Fix, Browser-Conditions (msw 3); Worker serviert Vitest selbst
```

- Domain-Testing-Libs importieren nur `msw` (nicht `msw/browser`), `type:types` und `shared/testing`. Deshalb liegen `CheckinDto` und `Arrival` in `checkin/types`, nicht in `checkin/data`. Ein Spec nutzt nur das eigene und das shared testing, nie das eines fremden Slices.
- `test`-Target (`"test": {}` in `project.json`, Body in `targetDefaults`) hat jede Lib, deren `src/` eine `*.spec.ts` enthält (heute `booking-data`, `checkin-data`, `checkin-feat-checkin-feature`, `shared-data`), dazu `tsconfig.spec.json`. Executor `@blueprint/tooling-ng-lib:test` (reicht an `@nx/angular:unit-test` durch, `--ui` für Vitest UI), `browsers: ["chromiumHeadless"]`, `runnerConfig: vitest-base.config.mts`, `tsConfig: {projectRoot}/tsconfig.spec.json`, `watch: false`. `verify` prüft: `test` genau bei Libs mit Specs.
- Einmalig: `pnpm exec playwright install chromium`.

### So sieht ein Test aus

Nah am [MSW-Rezept für Vitest Browser Mode](https://mswjs.io/docs/recipes/vitest-browser-mode/): Fixture `worker`, Default-Handler per `beforeEach`, Abweichungen im Test.

```ts
import { bookingHandlers, bookingScenarios } from '@blueprint/booking/testing';
import { test, worker } from '@blueprint/shared/testing';
import { beforeEach, describe, expect } from 'vitest';

describe('BookingStore', () => {
  beforeEach(() => worker.use(...bookingHandlers));          // Default-Handler der Spec

  test('lädt über die echte BookingApi', async () => {
    const store = TestBed.inject(BookingStore);
    await store.load();
    expect(store.all()).toEqual(defaultBookings);
  });

  test('Fehlerfall', async ({ worker }) => {
    worker.use(bookingScenarios.serverError());             // nur für diesen Test
    await expect(TestBed.inject(BookingStore).load()).rejects.toThrow('500');
  });
});
```

- **Fixture `worker`** (`auto: true`): startet den Worker einmal (`onUnhandledFrame: 'error'`, msw 3; vorher `onUnhandledRequest`; Promise-Guard), `use(worker)`, danach `worker.resetHandlers()`. Kein `stop`, wie im Rezept. Abweichungen vom Rezept: `start` nur beim ersten Test (Rezept: `await worker.start()` pro Test; hier teilen sich alle Specs einer Lib die Seite, `isolate: false`) und `setupWorker()` ohne Happy-Path-Handler, die Defaults setzt jede Spec selbst.
- **Faker:** Die Fixture setzt vor jedem Test `faker.seed(FAKER_SEED)`. Die generierten Default-Handler der OpenAPI-Clients (orval + Faker) liefern damit in jedem Lauf dieselben Daten, unabhängig von der Reihenfolge der Tests.
- **Default-Handler: explizit im Spec** per `beforeEach(() => worker.use(...))`, `worker` kommt dafür als Modul-Export. Kein globales Setup-File: Welche Handler gelten, steht in der Spec.
- **Reihenfolge** (Vitest 4 löst Fixtures auch für `beforeEach` auf, Auto-Fixtures immer): Fixture-Setup (Worker läuft) → `beforeEach` (Defaults) → Test (`worker.use` wird vorangestellt, neuester Handler gewinnt) → Fixture-Teardown (`resetHandlers` entfernt Defaults und Overrides). Belegt per Probe-Spec (nicht eingecheckt): `fetch` im ersten `beforeEach` wird schon von MSW beantwortet; im Folgetest nach einem Override gilt wieder nur der Default (`listHandlers().length === 1`); ohne `resetHandlers` wird dieser Test rot (3 statt 1 Handler).
- Ohne `beforeEach` gibt es keine Handler. Ein nicht gemockter Request wird von MSW geloggt und mit 500 beantwortet, der Test wird rot (`booking-api.spec.ts` in `booking/data` prüft genau das).
- Komponententest `feat-checkin.spec.ts`: rendert `FeatCheckin` per TestBed in Chromium, klickt über `page` aus `vitest/browser` und prüft das DOM (`expect.element`). Die Buchungen kommen dabei cross-domain aus `@blueprint/booking/testing`.
- Mutationsproben: `beforeEach` mit den Default-Handlern in `booking.store.spec.ts` entfernt → `booking-data:test` rot (1 failed, `[MSW] Error: intercepted a request without a matching request handler`). Override gewinnt: die Tests mit `worker.use(...)` laufen trotz aktiver Defaults grün (`serverError` → 500, `withBookings` → nur `b-1`).

### Schutzschichten gegen Production-Leaks

| # | Schicht | Wo | Geprüft durch |
|---|---|---|---|
| 1 | depConstraints: Produktions-Layer kennen `type:testing` nicht, `type:feature`/`type:app` ohne Glob; `type:testing` → nur types, testing, shared | `eslint.config.mjs` | `nx lint`, verify-Fälle `testing: …` |
| 1b | Spec-Override (`*.spec.ts`, `*.test.ts`, `test-setup.ts`): dieselben Constraints + `type:testing`, auch fremde Domain. `scope:shared` und `type:types` bleiben unverändert | `eslint.config.mjs` → `specDepConstraints` | verify (`allowedInSpec`/`blockedInSpec`) |
| 2 | `bannedExternalImports` msw, vitest, @vitest, @testing-library, playwright, openapi-msw, @faker-js in Produktions-Layern + App | `eslint.config.mjs` | verify |
| 3 | Testing-Libs ohne `build`-Target und ohne Build-Dateien (`package.json`, `ng-package.json`, `tsconfig.lib*.json`). Import aus Produktionscode scheitert zusätzlich an `enforceBuildableLibDependency`, im Spec-Override ist die Regel aus | `project.json`, Config-Wächter, Spec-Override | verify (Test-Isolation aus dem Graph + Config-Wächter + Fälle) |
| 4 | Die Build-tsconfig (`build.options.tsConfig` = `{projectRoot}/tsconfig.lib.json`) schließt `src/**/*.spec.ts` aus, `build`-Inputs sind `production`, `production` schließt `**/*.spec.ts` und `tsconfig.spec.json` aus, `peerDependencies` nur aus Produktionscode | `tsconfig.lib.json` jeder Lib, `nx.json` | verify (Test-Isolation liest Targets aus dem Graph, Config-Wächter prüft peers) |
| 5 | Kein `mockServiceWorker.js` im Repo: Vitest serviert ihn nur bei Testläufen aus dem msw-Paket. Kein App-Asset | `vitest-base.config.mts` | verify (keine committete Worker-Datei, keine testing/msw-Referenz in App-`project.json`) |
| 6 | `nx build client` + Scan des Bundles auf `msw`, `mockServiceWorker`, `setupWorker`, `vitest`, `faker` | `packages/tooling/verify/scripts/verify-boundaries.mjs` | verify: 14 Dateien, 0 Treffer |
| 7 | Keine Zyklen, keine `ignoredCircularDependencies` (siehe unten) | Schnitt der Libs | `nx lint`, verify |

### Zyklen

Nx zählt Spec-Imports als Projekt-Kante: `booking-data → booking-testing`. Damit das zyklenfrei bleibt:

- Testing-Libs importieren nur `type:types`, `type:testing` und `scope:shared`. `types` importiert nur andere `types`, eine types-Spec gegen testing wäre ein Zyklus und ist blockiert (verify-Fall).
- `shared/testing` importiert keine Blueprint-Lib. So dürfen auch Specs in `shared/*` es nutzen.
- Import einer Testing-Lib in eine Lib, die schon Specs gegen diese Testing-Lib hat → Nx meldet „Circular dependency“ vor der Tag-Regel (verify: `testing -> data`).
- `^build`: Testing-Libs haben kein `build`, Nx überspringt sie. `test` hat kein `dependsOn`. `run-many -t build` läuft ohne Task-Zyklus.

### Runner-Entscheidung: `@nx/angular:unit-test`

Gewünscht war `@angular/build:unit-test`. Direkt eingetragen scheitert er für die Libs, **Beleg** (`nx run booking-data:test`):

```
The 'buildTarget' is configured to use '@nx/angular:ng-packagr-lite', which is not supported.
The 'unit-test' builder is designed to work with '@angular/build:application' or '@angular/build:ng-packagr'.
Could not load build target options for "booking-data:build:development". … no schema with key or ref "https://json-schema.org/schema"
```

Mit `buildTarget: client:build:development` gleiche Warnung für `@nx/angular:application`, dazu koppelt es jede Lib an die App.

`@nx/angular:unit-test` (Nx 23.1) ist **kein anderer Runner**. Es ist ein dünner Wrapper, der `executeUnitTestBuilder` aus `@angular/build` aufruft. Vorher mappt er `@nx/angular:ng-packagr-lite` → `@angular/build:ng-packagr` im Builder-Context. Vitest, Browser-Provider, TestBed-Init und `runnerConfig` bleiben also Angulars Builder. Der Fallback `@nx/vitest` + `@analogjs/vitest-angular` war damit nicht nötig. Mit echter `ng-package.json` pro Lib braucht er keine Hilfe mehr; `@blueprint/tooling-ng-lib:test` davor reicht nur durch und ergänzt `--ui` (siehe [Executor-Wrapper](#executor-wrapper-packagestoolingng-lib)).

### Limitierungen

| Limitierung | Umgang |
|---|---|
| Angular pre-bundelt `msw` (`optimizeDeps.include`), Vitest Browser schließt es aus → esbuild: „The entry point "msw" cannot be marked as external“ | Plugin `blueprint:msw-not-prebundled` in `vitest-base.config.mts` entfernt die Überschneidung aus `include` |
| Der Builder mischt seine Resolve-Conditions (`browser`, …) in die Node-Defaults von Vitest, das Browser-Projekt löst also auch mit `node` auf. msw 3 mappt `msw/browser` unter `node` auf `null` → „No known conditions for "./browser" specifier in "msw" package“ | Plugin `blueprint:browser-conditions` in `vitest-base.config.mts` entfernt `node` aus den Client-Conditions, wenn `browser` gesetzt ist |
| Vitest Browser serviert `/mockServiceWorker.js` selbst aus dem msw-Paket (`vitest:browser:resolve-virtual` → `msw/mockServiceWorker.js`) | seit msw 3 genutzt: kein `publicDir`, keine committete Kopie, kein `msw init`/`msw.workerDirectory`. Beleg per Probe-Spec: ohne beides serviert der Dev-Server `/mockServiceWorker.js` mit `PACKAGE_VERSION 3.0.0`, Checksumme = `node_modules/msw/lib/mockServiceWorker.js` (12 754 Bytes + Inline-Sourcemap), alle Tests grün. Weil das ein Vitest-Interna ist, prüft `pnpm verify:nx-internals` es bei jedem Update (Schritt „MSW worker“). `msw/vite` (`mode: 'worker-only'`) ist damit nicht nötig |
| Spec-Imports sind Graph-Kanten: `nx graph`/`affected` zeigen `booking-data → booking-testing`, `^production` von `booking-data:build` enthält die Testing-Lib | Build-Output unberührt (tsconfig.lib, Bundle-Check). Cache-Invalidierung etwas breiter als nötig |
| Buildable Lib → Testing-Lib meldet zuerst `enforceBuildableLibDependency`, die Tag-Meldung erscheint erst danach | verify prüft die Tag-Constraints zusätzlich isoliert (`tags only`) |
| `type:types`-Libs können keine Testing-Libs in Specs nutzen (Zyklus) | reine Interfaces, nichts zu testen |
| `@angular/build` 22 verlangt `vitest ^4`, deshalb nicht Vitest 5 | beim nächsten Update prüfen |
| msw 3: `@vitest/mocker` (optionaler Peer) verlangt `msw ^2.4.9` | `package.json` → `pnpm.peerDependencyRules.allowedVersions.msw = "3"`; alle Browser-Tests grün |
| Angular-Default `isolate: false`: alle Spec-Dateien einer Lib teilen sich die Seite | Worker startet einmal (Promise-Guard), `resetHandlers` nach jedem Test |
| Parallele `test`-Tasks belegen je einen Vitest-Port | Vitest weicht automatisch aus („Port 63315 is in use, trying another one“) |

### Neue `<domain>/testing` anlegen

```sh
nx g @blueprint/tooling-workspace:testing <d>     # für eine bestehende Domain; `domain` legt testing + Beispiel-Spec gleich mit an
```

1. Erzeugt `libs/<d>/testing/src/fixtures/<d>.fixture.ts` (Builder `a<D>()`), `src/handlers/<d>.handlers.ts` (`<d>Handlers`, `<d>Scenarios`: `withItems`, `empty`, `serverError`), `src/index.ts`, `project.json` (`<d>-testing`, `scope:<d>`, `type:testing`, `feat:none`, Targets `lint` + `typecheck`, **kein** `build`), `tsconfig.json` und den `paths`-Eintrag `@blueprint/<d>/testing`.
2. Importiert nur `msw`, `@blueprint/<d>/types` und `@blueprint/shared/testing`. Exportiert `<d>/types` kein `<D>`, deklariert die Fixture die Backend-Form selbst (Hinweis im Kommentar: nach `<d>/types` verschieben).
3. Specs: `*.spec.ts` in `src/` einer Lib ablegen, dazu `tsconfig.spec.json` + `"test": {}` in `project.json` (sonst meldet `verify` beides). Vorlage: `libs/<d>/data/src/<d>.store.spec.ts` aus dem Domain-Generator, der auch die Spec-Config schreibt.
4. `tooling-verify:verify` prüft Tag-Schema, dass das Testing-Projekt kein `build` hat und `test` genau bei Libs mit Specs existiert.

## OpenAPI-Clients

HTTP-Clients werden aus OpenAPI-Specs generiert. Der Code-Generator ist austauschbar und steckt hinter einer Facade in `packages/tooling/openapi`. Die Facade legt fest, wo der Code liegt, und teilt ihn in Nx-Libs auf. Generierter Code wird **nicht committet**: pro Lib ist nur `src/index.ts` (`export * from './generated';`) im Repo, alles unter `src/generated/` ist gitignored und entsteht per `generate`-Target. Grundlage: Spike S1 (Facade, Branch `tmp/openapi-spike`), S2 (nx-plugin-openapi), S3 (MSW-Testing).

### Architektur

```
openapi-clients.json (Root)            ein Eintrag pro Client: url?, adapter?, options?
libs/[<domain>/]generated/<client>/
  openapi.yaml | openapi.json          committet, einzige Quelle für generate (die url dient nur update-spec)
        │
        ▼  <client>:generate (gecacht) = @blueprint/tooling-openapi:generate
 facade.mjs ── adapters/registry.json ──▶ adapter.generate(ctx) ──▶ tmp/openapi/<pfad>/raw/**
        │                                 adapter.classify(ctx)  ──▶ { models, apis, core, entries }
        ▼
 split.mjs   Struktur pro Teil, relative Imports über Teilgrenzen → @blueprint/<pfad>/<teil> (TS-AST)
 barrel.mjs  src/generated/index.ts aus den Entries (Namenskonflikte per TS-Checker aufgelöst)
 Header      /* eslint-disable */ /* eslint-enable @nx/enforce-module-boundaries, no-restricted-imports */
        ▼
  types/src/generated/**   type:types      Models
  api/src/generated/**     type:data       Services
  core/src/generated/**    type:data       Runtime (Configuration, BASE_PATH, provideApi …, importiert HTTP)
  testing/src/generated/** type:testing    eigenes generate: openapi-typescript + orval (msw, faker) + openapi-msw
        ▼
 Wrapper in <slice>/data bzw. shared/data ── mappt DTO → Modell, Promise statt Observable ──▶ Stores, Feats
```

| Datei | Aufgabe |
|---|---|
| `packages/tooling/openapi/src/facade/contract.d.ts` | Vertrag `ClientDefinition`, `GeneratorAdapter` (`generate`, `classify`), `Classification`, `AdapterRegistration` |
| `…/openapi/facade.mjs`, `split.mjs`, `barrel.mjs` | `resolveClient` (Eintrag + Ordner → Definition), `generateClient`, `updateSpec`, Aufteilen, Barrel, Header |
| `…/openapi/adapters/*.mjs`, `registry.json` | 3 Adapter, Registry mit Cache-Inputs je Adapter (Pakete, `openapitools.json`, `java -version`) |
| `…/openapi/testing/testing.mjs` | Testing-Lib aus der Spec |
| `…/executors/openapi/*` | `openapi-generate`, `openapi-generate-testing`, `openapi-update-spec` (Option nur `client`) |
| `…/openapi/project-config.ts`, `conventions/lib-files.ts`, `lib-conventions.ts` | `project.json` der Clients (`generate`, `update-spec`) und Teil-Libs (Kanten, Testing-`generate`), Tags, Pfad-Konvention |
| `…/generators/client`, `…/openapi/clients.ts` | Generator `client`, Pflege von `openapi-clients.json` und Client-`project.json` in `move`/`rename`/`remove` |
| `openapitools.json` | Jar-Version 7.25.0, `storageDir: ./node_modules/.cache/openapi-generator-cli` |

### Ablage, Projekte, Tags

```
libs/generated/<client>/                   scope:shared    Client-Projekt generated-<client> (project.json: nur Targets, kein Code, kein Alias)
libs/<domain>/generated/<client>/          scope:<domain>  Client-Projekt <domain>-generated-<client> (project.json)
  openapi.yaml|json                        committet
  types/src/index.ts     → Lib …-types     scope:<s> type:types   feat:none generated
  api/src/index.ts       → Lib …-api       scope:<s> type:data    feat:none generated
  core/src/index.ts      → Lib …-core      scope:<s> type:data    feat:none generated
  testing/src/index.ts   → Lib …-testing   scope:<s> type:testing feat:none generated   (kein build)
  <teil>/src/generated/**                  gitignored (.gitignore: **/src/generated/**)
```

- **`generated` ist ein reservierter Ordner**, kein Scope und kein Layer. `libs/generated/…` gehört zu `shared`, die Scope-Liste bleibt unverändert. `domain generated` wird abgelehnt, einen falschen Pfad (`libs/generated/x/ui`) lehnen Generatoren ab und `verify` meldet ihn (Tags passen zu keinem Teil).
- **Domain-Client ist slice-privat:** `booking/generated/**` sieht nur booking. Fremde Domains kommen nie heran (keine Ports).
- **`api` und `core` sind `type:data`**, weil HTTP Aufgabe von `data` ist (die Runtime importiert `@angular/common/http`, in `utils`/`ui`/`feature` verboten).
- `type:types` → `type:types` gilt (Domain-Types dürfen generierte Models nutzen). `data`/`feature` dürfen generierte Services laut Matrix direkt nutzen, Konvention bleibt „über den Wrapper in `data`“.
- **Wrapper:** `BookingApi`, `BookingNotifications` (`booking/data`), `CheckinNotifications` (`checkin/data`), `PetApi` (`shared/data`).
- Config-Wächter: im Client-Ordner liegen nur `project.json` und die Spec; `openapi.(yaml|json)` an jeder anderen Stelle in `libs/` meldet `tooling-verify:verify` als Config-Datei außerhalb einer Lib.

### `openapi-clients.json`

```json
{
  "$schema": "./packages/tooling/openapi/openapi-clients.schema.json",
  "defaultAdapter": "openapi-tools",
  "clients": {
    "generated/pet-client": { "url": "https://petstore3.swagger.io/api/v3/openapi.json" },
    "generated/notification-client": {},
    "booking/generated/booking-client": {}
  }
}
```

| Feld | Bedeutung |
|---|---|
| Schlüssel | Client-Pfad unter `libs/` |
| `adapter` | `openapi-tools` (Default), `hey-api`, `nx-plugin-openapi` |
| `url` | nur für `update-spec` |
| `options` | Adapter-Optionen, über die Adapter-Defaults gemergt (z.B. `{ "plugin": "hey-api" }` für nx-plugin-openapi) |

Die Datei liest zur Laufzeit die Executoren (`resolveClient`), beim Anlegen der Generator und `tooling-verify:verify`. Die `project.json` des Clients und seiner Teile schreibt der Generator `client` (Vorlage `packages/tooling/openapi/src/project-config.ts`): Client-Projekt mit `generate` + `update-spec`, Teil-Libs mit `implicitDependencies` und die Testing-Lib mit eigenem `generate` (`lint`/`typecheck` mit `dependsOn: ['generate', '^generate']`). Eintrag, Ordner und Spec müssen zusammenpassen: `tooling-verify:verify` prüft Eintrag ↔ Ordner ↔ eine Spec ↔ vier Libs, Adapter-Inputs in `project.json` ↔ Adapter des Eintrags, Kanten und dass die vier `index.ts` genau `export * from './generated';` enthalten.

**Warum eine eigene Datei statt `nx.json`:** Jede Änderung an `nx.json` invalidiert den ganzen Cache (Spike S1, belegt).

**Warum der Eintrag in der eigenen Datei bleibt und keine Target-Option wird** (auch in der expliziten Variante): Nx hasht in `^default`/`^production` die `ProjectConfiguration` jeder Abhängigkeit mit (Hash-Plan von `shared-data:typecheck` enthält `generated-pet-client:ProjectConfiguration`). Stünde der Eintrag in den `options` von `generate`, liefe nach jeder Eintragsänderung alles neu, was vom Client abhängt, auch wenn der generierte Code gleich bleibt. Deshalb:

- Target-Optionen sind nur `{ "client": "<pfad>" }`, die Executoren lesen den Eintrag zur Laufzeit (`resolveClient`).
- Der Eintrag ist ein **`json`-Input** von `generate`: `{ "json": "{workspaceRoot}/openapi-clients.json", "fields": ["defaultAdapter", "clients.<pfad>"] }`.
- `update-spec` gibt es für jeden Client (ohne `url` bricht es ab), damit eine neue `url` die Projekt-Config nicht ändert.
- Ein Adapterwechsel ändert die Inputs (`externalDependencies` des Adapters) und damit die Projekt-Config: `openapi-clients.json` **und** die Adapter-Inputs im `generate` der Client-`project.json` anpassen (`verify` meldet die Abweichung mit den erwarteten Inputs). Die Abhängigen laufen dann neu, was sie wegen des neuen Codes ohnehin müssten.
- Alternativ Adapter + Optionen in die Target-Optionen: sichtbarer, aber jede Optionsänderung invalidiert alle Abhängigen (Cache-Befund oben), und Facade, Tests und Generator lesen die Datei. Deshalb verworfen.

**Cache-Probe** (eigener Cache, `run-many -t build lint test typecheck generate`, 155 Tasks, Ausgangslage 153/155 aus dem Cache; die 2 übrigen sind `sheriff-blueprint:build/test` ohne Cache):

| Änderung | neu gelaufen |
|---|---|
| pet-client: `"options": { "providedIn": "root" }` (= Default, gleicher Code) | nur `generated-pet-client:generate` (152/155) |
| notification-client: `url` ergänzt | nur `generated-notification-client:generate` (152/155) |
| pet-client: `"options": { "enumPropertyNaming": "original" }` (anderer Code) | pet-client (generate, Teile, testing), `shared-api` und dessen Abhängige (`checkin-api`, `checkin-data`, `checkin-feat-*`, `checkin-shell`); booking, notification, layout, auth aus dem Cache (116/155). *Messung auf explicit-config, Lib-Namen von dort* |
| booking-client-Spec: `description` am Schema | booking-client, booking-Libs, `checkin-feat-*`, `checkin-shell`, `client:build` (106/155) |
| zurück | 153/155 |

Vor dem Umbau auf den `json`-Input liefen im ersten Fall 41 Tasks neu (Messung explicit-config: `shared-api`, `checkin-*`, `client:build` …), obwohl der generierte Code byte-gleich war.

### Targets und Abhängigkeiten

| Projekt | Target | Konfiguration |
|---|---|---|
| Client (`project.json`) | `generate` | `@blueprint/tooling-openapi:generate`, gecacht. Inputs: Spec, eigener Eintrag (`json`-Input), die drei `index.ts`, Facade-Code (ohne `testing/`), Executoren, Adapter-Inputs aus `registry.json` (`externalDependencies` der Adapter-Pakete + `typescript`, `yaml`; bei Java-Adaptern `openapitools.json` und Runtime `java -version 2>&1`). Outputs: `{types,api,core}/src/generated` |
| Client | `update-spec` | `@blueprint/tooling-openapi:update-spec`, nicht gecacht: lädt die `url`, schreibt YAML/JSON normalisiert (danach Prettier wie `formatFiles`) |
| `…/testing` (`project.json`) | `generate` | `@blueprint/tooling-openapi:generate-testing`, gecacht. Inputs: Spec, Testing-Pipeline, `openapi-typescript`, `orval`, `yaml`. Output `src/generated`. `lint`/`typecheck` hängen zusätzlich an `generate` |
| jede Lib (`targetDefaults`) | `lint`, `typecheck`, `build`, `test` | `dependsOn: ['^generate']` (build: `['^build', '^generate']`), Input `{ dependentTasksOutputFiles: '**/src/generated/**/*.ts', transitive: true }` |
| Teil-Lib (`project.json`) | `implicitDependencies` | Client-Projekt; `api` → `core`, `types`; `core` → `types` |
| `client:build` | Input (`targetDefaults`) | ebenfalls `dependentTasksOutputFiles` (die App bündelt die Libs aus `dist`) |

- **Gitignored = für Nx unsichtbar.** Nx hasht keine gitignored Dateien und analysiert ihre Imports nicht. Deshalb der `dependentTasksOutputFiles`-Input (sonst kämen Konsumenten nach einer Spec-Änderung aus einem veralteten Cache) und die impliziten Kanten (sonst kein `affected` und keine Build-Reihenfolge). Beleg: Property `guestName` in der booking-Spec umbenannt → `booking-api:typecheck` rot (damals; heute `booking-data`); `description` ergänzt → auch `client:build` läuft neu (vor dem Fix blieb es im Cache).
- `^generate` reicht über den ganzen Graph: `nx run booking-data:typecheck` generiert vorher den booking-client. Specs, die eine Testing-Lib importieren, sind Graph-Kanten, `^generate` erzeugt also auch die Testing-Libs.
- **`nx affected`**: Spec-Änderung → Client, Teile, Wrapper in `data`, Konsumenten, App (per impliziter Kante). Eine Änderung an `openapi-clients.json` gehört keinem Projekt; sie ist Input von `update-spec` (nicht gecacht, also nur für `affected`) → alle Clients + Abhängige. Der Cache von `generate` bleibt pro Eintrag.
- **IDE:** `pnpm openapi:generate` (= `nx run-many -t generate`) nach dem Checkout, sonst meldet die IDE `Cannot find module './generated'`. Kein `postinstall`: `pnpm install` bräuchte dann Java und Netz. Build, Lint, Typecheck und Test generieren selbst.
- Deterministisch: zweimal `generate --skip-nx-cache` ergibt byte-gleiche Dateien, die dist der Client-Libs steht im Snapshot von `verify:nx-internals`.

### Generator `client`

```sh
nx g @blueprint/tooling-openapi:client <name> [--domain=<d>] --spec=<datei|url> [--url=<url>] [--adapter=openapi-tools|hey-api|nx-plugin-openapi]
```

- legt `libs/[<d>/]generated/<name>/` an: Spec (Datei unverändert als `openapi.yaml|json`; URL einmal geladen und wie `update-spec` normalisiert), `types|api|core|testing/src/index.ts`, `project.json` des Clients, Config-Dateien der vier Libs (Testing ohne Build-Dateien), vier `paths`-Einträge, Eintrag in `openapi-clients.json` (`url` = `--url` oder die Spec-URL; `adapter` nur, wenn er vom `defaultAdapter` abweicht)
- prüft: kebab-case, Domain existiert, Client neu, OpenAPI 3.x mit mindestens einem Pfad, Adapter bekannt
- `move`/`rename`: Eintrag wird mitgezogen (auch beim Verschieben einer ganzen Domain), Aliase umgeschrieben, `project.json` von Client und Teilen nachgezogen (Name, Scope-Tag, Spec-Input, `json`-Feld, Option `client`, `implicitDependencies`), `paths` umbenannt, bei `rename` auch die generierten Testing-Namen (`demoClientHttp` → `thingClientHttp`). `remove`: Eintrag, `paths` und Kanten raus, bricht ab, solange Code den Client importiert. Ein `remove` direkt nach `client` stellt den Ausgangszustand exakt wieder her (Spec im Tooling-Test, E2E: `git status` leer)
- `component`/`service`/`store` lehnen generierte Libs ab

### Adapter

| | openapi-tools (Default) | hey-api | nx-plugin-openapi |
|---|---|---|---|
| Paket | `@openapitools/openapi-generator-cli` 2.41.0 + Jar 7.25.0 | `@hey-api/openapi-ts` **0.83.1** (gepinnt) | `@nx-plugin-openapi/core`, `plugin-openapi`, `plugin-hey-api` 1.0.0, Backend über `options.plugin` |
| Java | ja (JRE 11+, CI: Temurin 17). Jar-Download beim ersten `generate` nach `node_modules/.cache/openapi-generator-cli` | nein | je nach Backend |
| Ausgabe → Teile | `model/*` → types, `api/*` → api, Root-Dateien → core; verworfen `index.ts`, `api.module.ts` | `types.gen.ts` → types, `sdk.gen.ts` + `@angular/**` → api, `client.gen.ts`, `client/**`, `core/**` → core | wie das Backend |
| Service-API | `BookingsService.listBookings(): Observable<Booking[]>`, `providedIn: 'root'`, `provideApi()` | `listBookings({ httpClient }): Promise<{ data, error, response }>` | wie das Backend |
| Models | `interface` + `namespace` (Enums als `const … as const`) | `type` mit Literal-Unions | wie das Backend |

**Tausch-Beweis** am booking-client (Eintrag in `openapi-clients.json` + Wrapper `booking/data/src/booking-api.ts`, gemessen auf `feat/nx-blueprint`, `run-many -t build lint test typecheck`, 50 Projekte):

| Eintrag | Dateien types/api/core | Wrapper | Ergebnis |
|---|---|---|---|
| `{}` (openapi-tools) | 3/2/7 | Variante A | grün |
| `{ "adapter": "hey-api" }` | 1/3/12 | Variante B | grün |
| `{ "adapter": "nx-plugin-openapi", "options": { "plugin": "hey-api" } }` | 1/3/12 | Variante B | grün |
| `{ "adapter": "nx-plugin-openapi" }` (Backend openapi-tools) | 3/2/7 | Variante A | grün |

`git status` zeigte jeweils nur `openapi-clients.json` und den Wrapper `booking-api.ts` (damals in `booking/api`, hier `booking/data`; hier kommen die Adapter-Inputs in `libs/booking/generated/booking-client/project.json` dazu). Alle Konsumenten (data, feature, checkin, Tests, MSW-Handler) blieben unverändert:

```ts
// A (openapi-tools): Observable + HttpErrorResponse
private readonly bookings = inject(BookingsService);
return (await firstValueFrom(this.bookings.listBookings(), { defaultValue: [] })).map(toBooking);

// B (hey-api): Promise + Fehler als Wert
private readonly http = inject(HttpClient);
const { data, response } = await listBookings({ httpClient: this.http });
if (!response) return []; // abgebrochen
if (!response.ok) throw new Error(`GET /api/bookings failed: ${response.status}`);
return (data ?? []).map(toBooking);
```

Die Testing-Lib hängt nicht am Adapter (nur an der Spec), ein Tausch lässt sie im Cache.

### Testing-Lib pro Client

`<client>/testing` (`type:testing`, gleicher Scope wie der Client) entsteht nur aus der Spec:

| Datei in `src/generated/` | Werkzeug | Inhalt |
|---|---|---|
| `schema.ts` | openapi-typescript 7.13 | `paths`, `components`, `operations` |
| `mocks.ts`, `model/**` | orval 8.38 (nur msw-Mocks, `useExamples`, Faker) | `get<Op>MockHandler(override?)`, `get<Op>ResponseMock()` je Operation |
| `http.ts` | openapi-msw 2.0 | `<client>Http = createOpenApiHttp<paths>({ baseUrl: servers[0].url })`, `<client>BaseUrl` |
| `handlers.ts` | – | `<client>Handlers`: ein Default-Handler je Operation (Spec-`example`s, Faker füllt den Rest) |

```ts
import { bookingClientHandlers, bookingClientHttp } from '@blueprint/booking/generated/booking-client/testing';

beforeEach(() => worker.use(...bookingClientHandlers));                        // generierte Defaults
worker.use(bookingClientHttp.get('/bookings', ({ response }) => response(200).json([aBooking()])));
worker.use(bookingClientHttp.get('/bookings', ({ response }) => response('default').json({ message: 'boom' }, { status: 500 })));
// Compile-Fehler: unbekannter Pfad, nicht dokumentierter Status, falscher Body
```

- **Faker deterministisch:** Die `worker`-Fixture in `shared/testing` ruft vor jedem Test `faker.seed(FAKER_SEED)`. `PetApi`-Spec belegt: zweimal geladen mit neuem Seed → gleiche Daten.
- **Specs pflegen:** `example` an jedem Property der eigenen Specs, dann liefern die generierten Handler lesbare Daten (`'Booking b-101 confirmed'` statt Zufallstext).
- **Grenzen:** Testing-Libs haben kein `build`. `openapi-msw` und `@faker-js/*` stehen in den `bannedExternalImports` der Produktions-Layer, der Bundle-Scan von `tooling-verify:verify` sucht zusätzlich nach `faker` (0 Treffer).
- `booking/testing` baut `bookingHandlers`/`bookingScenarios` jetzt auf `bookingClientHttp`: eine Spec-Änderung bricht die handgeschriebenen Handler beim Typecheck.
- pnpm: `peerDependencyRules.allowedVersions` für `openapi-msw>msw` (3), `openapi-typescript>typescript` (6), `msw` (3, `@vitest/mocker`) und `@nx/devkit>nx` (23, von nx-plugin-openapi).

### Beispiele

| Client | Spec | Konsum | Tests |
|---|---|---|---|
| `libs/generated/pet-client` (shared) | Petstore 3, `update-spec` von `https://petstore3.swagger.io/api/v3/openapi.json` | `PetApi` in `shared/data` (`availablePets()`) | `shared/data/src/pet-api.spec.ts`: generierte Handler + Seed, typisiertes Szenario (`status=available`), dokumentierter 400 |
| `libs/generated/notification-client` (shared) | selbst geschrieben: `GET /notifications?topic=`, `POST /notifications/{id}/read` | `BookingNotifications` (`booking/data`) und `CheckinNotifications` (`checkin/data`), Modelle in `booking/types`, `checkin/types` | je 4 Tests: Default-Handler, Topic-Filter per `notificationClientHttp` mit generierter Factory, `markRead`, 404 |
| `libs/booking/generated/booking-client` (booking) | selbst geschrieben: `GET /bookings` (Model wie `booking/types`, `default`-Fehler) | `BookingApi` (`booking/data`) | `booking-api.spec.ts` (unbehandelter Request, generierte Handler), `booking.store.spec.ts` über die typisierten `bookingHandlers`/`bookingScenarios` (checkin nutzt booking nicht mehr) |

`HttpClient`: Angular 22 stellt ihn `providedIn: 'root'` mit `FetchBackend` bereit, MSW sieht die Requests ohne Provider im Test. In der App steht `provideHttpClient(withFetch())` explizit. Ein beim TestBed-Reset abgebrochener Request endet ohne Wert, die Wrapper behandeln das als „nichts geladen“ (`defaultValue: []`).

### CI

`.github/workflows/ci.yml`: `actions/setup-java@v4` (Temurin 17) und `actions/cache@v4` für `node_modules/.cache/openapi-generator-cli` (Key: Hash von `openapitools.json`), sonst unverändert. `generate` läuft über `^generate` in `run-many`/`affected` mit. `update-spec` läuft nur manuell (`nx run <client>:update-spec`), das Ergebnis kommt per normalem PR.

### Verify

`tooling-verify:verify`: 155 Fälle (140 Boundary + 15 Namensregeln), davon 46 für generierte Clients:

| Fälle | erwartet |
|---|---|
| Domain-data → eigener Client (api, types, core), Domain-/`shared/data` → shared Client | erlaubt |
| fremde Domain (data, types, feat-data) → `booking/generated/**`, shared → Domain-Client | blockiert (`scope:checkin`, `scope:shared`) |
| ui → Client api/core (Domain + shared), utils → Client api, Domain-types → Client api, app → Domain-Client, Deep-Import | blockiert |
| ui → Client types, data/feature → Client api (Matrix), types → types | erlaubt |
| Produktion/App → Client-testing, testing → Client api, fremdes testing → Domain-Client-testing, `openapi-msw`/`@faker-js/faker` in Produktion | blockiert |
| Spec → eigenes/shared Client-testing, Domain-testing → eigenes Client-testing | erlaubt; shared-Spec und fremder Spec → Domain-Client-testing blockiert |
| aus generiertem Code (mit Header): types → api/core desselben Clients, types → `@angular/core`, shared → Domain-Client, api → data (Zyklus), api → ui, Deep-Import, testing → api | blockiert; api → core, api/core → `@angular/common/http`, testing → `openapi-msw` erlaubt |

Dazu der Check „Generierte Clients“: Eintrag ↔ Ordner ↔ eine Spec ↔ vier Libs, `index.ts`-Inhalt, `generate`-Optionen nur `{ client }` + `json`-Input, Adapter-Inputs in `project.json` ↔ Adapter des Eintrags (`registry.json`), `update-spec` vorhanden, Kanten Teil → Client (→ Teile darunter) exakt, `^generate` + `dependentTasksOutputFiles` an jedem Lib-Target und an `client:build`, Testing-`generate` gecacht und vor `lint`/`typecheck`, nichts unter `src/generated/` committet, alles gitignored.

### Limitierungen

| Limitierung | Umgang |
|---|---|
| Gitignored Code ist für Nx unsichtbar (Hash, Kanten, `peerDependencies` der dist) | `dependentTasksOutputFiles` + implizite Kanten, im Verify geprüft. `peerDependencies` der Client-dist bleiben leer (harmlos, `private`) |
| Adapterwechsel ändert die Projekt-Config des Clients (zwei Dateien: Eintrag + Adapter-Inputs in `project.json`) | `verify` meldet eine Abweichung; Abhängige laufen neu, was sie für den neuen Code ohnehin müssen |
| `nx affected` sieht eine Änderung an `openapi-clients.json` für alle Clients, nicht nur den geänderten | nur `affected`; der Cache von `generate` ist pro Eintrag |
| openapi-tools braucht Java und beim ersten `generate` Netz (Jar) | CI: setup-java + Cache; lokal JRE 11+. hey-api braucht beides nicht |
| hey-api 0.83 statt aktuell (ab 0.96 Node ≥ 22.13, ab 0.98 ≥ 22.18) | bei Node ≥ 22.18 anheben, Klassifizierung prüfen |
| orval 8.38 verlangt laut `engines` Node ≥ 22.18, läuft aber lokal unter 22.16 | CI nutzt Node 22 aktuell; bei Problemen Node anheben |
| `nx-plugin-openapi` bringt `@nx/devkit` 19 mit | `peerDependencyRules` (`@nx/devkit>nx: 23`), funktional ok |
| `formatFiles` von Nx ignoriert `.prettierignore` (übergibt kein `ignorePath`) | Specs und `openapi-clients.json` sind Prettier-formatiert, `update-spec` formatiert genauso nach |
| `type:testing` → `scope:shared` erlaubt auch shared Client-api in Testing-Libs | bestehende Regel (für `shared/testing`), nicht verschärft |
| `data`/`feature` dürfen generierte Services laut Matrix nutzen | Konvention „über den Wrapper in `data`“, bewusst so gelassen |
| generierte `api`/`core` sind `type:data`: Client-Code → Domain-`data` blockt nur der Zyklus, nicht die Layer-Regel | generierter Code importiert nie Domain-Code; Verify-Fall „client api -> domain data“ deckt es ab |

## Namensschema

Die Namen der Libs, Dateien und Symbole sind keine Kosmetik: Tags, Aliase, Projektnamen und die Routen-Registrierung hängen daran, die Generatoren erzeugen sie. Erzwungen wird jede Regelart dort, wo sie am billigsten und präzisesten prüfbar ist. Die ESLint-Regeln lesen Layer, Scope und Feat aus derselben Quelle wie die Generatoren (`parseLibPath` in `@blueprint/tooling-conventions`), keine doppelte Logik. Einziger Unterschied zu `feat/nx-blueprint`: die **Ordnerregel** prüft kein Plugin beim Graph-Aufbau, sondern `tooling-verify:verify` (siehe unten).

### Inventar (aus Code und Generatoren abgeleitet)

| Regelart | Schema | Beispiel | Mechanismus | Status |
|---|---|---|---|---|
| Lib-Ordner | `libs/<scope>/<layer>`, `libs/<scope>/feat-<feat>/<layer>`, `libs/[<d>/]generated/<client>/{types,api,core,testing}`; Layer aus `KNOWN_LAYERS`, Scope aus `lib-scopes.json`, alles kebab-case | `libs/booking/feat-check-booking/data` | Generatoren (`libPathError`, `assertKebabCase`) lehnen ab; von Hand angelegt (`project.json`) meldet `tooling-verify:verify` die Lib (Ordnerregel im Tag-Schema: Form, Layer, kebab-case für Scope/Feat/Client, unabhängig vom Konventions-Code abgeleitet wie die Tags). Neu: kebab-case auch für Feat- und Client-Ordner (`feat-CheckIn` rutschte vorher durch) | umgesetzt |
| Nx-Projektname | Pfad unter `libs/` mit `-` | `booking-feat-check-booking-data` | Generatoren schreiben ihn in `project.json` (`projectNameFor`), `verify` (Config-Wächter) prüft | besteht |
| Import-Alias | `@blueprint/<pfad>` | `@blueprint/booking/data` | exakter `paths`-Eintrag pro Lib + `package.json`-Name (`aliasFor`), von den Generatoren geschrieben, `verify` prüft | besteht |
| Public API | nur `src/index.ts`, `internal/` wird nicht exportiert | `checkin/data/src/internal/checkin.mapper.ts` | Deep-Import: `no-restricted-imports` (besteht). `internal/` in `index.ts`: `blueprint/no-internal-export` | umgesetzt |
| Ordner unter `src/` | kebab-case | `fixtures/`, `internal/` | `blueprint/lib-file-naming` | umgesetzt |
| Dateinamen je Layer | `<name>.ts` (Komponente, Service, HTTP-Wrapper) oder `<name>.<kind>.ts`; Kind nur im Layer: model/dto → types, utils → utils, events/mapper/store → data, store → ui/feature, routes/providers/shell → shell, fixture/handlers → testing (in `fixtures/`/`handlers/`); Slice-`types`/`utils` nur mit Kind; Specs wie die Datei + `.spec` | `booking.store.ts`, `booking-card.ts`, `layout.shell.ts` | `blueprint/lib-file-naming` (Tabelle `FILE_KINDS` in den Konventionen) | umgesetzt |
| Store | `<n>.store.ts` → `<N>Store`, `*Store` nur in `.store.ts` | `CheckinDeskStore` | `blueprint/layer-symbol-naming` | umgesetzt |
| HTTP-Klasse | `<n>-api.ts` → `<N>Api`, `*Api`-Klasse nur in `-api.ts` | `BookingApi` | `blueprint/layer-symbol-naming` | umgesetzt |
| Feat-Container | feature-Lib: `feat-<feat>.ts` → `Feat<Feat>` des Feats der Lib | `FeatCheckBooking` | `blueprint/layer-symbol-naming` | umgesetzt |
| Komponente | Klasse `<N>` (oder `<Prefix><N>`), Selektor `<prefix>-<n>`, Präfix `app` | `booking-card.ts` → `BookingCard`, `app-booking-card` | Präfix + Stil: `@angular-eslint/component-selector`/`directive-selector` (Libs + App). Klasse/Selektor ↔ Datei: `blueprint/layer-symbol-naming` | umgesetzt |
| Shell | `<scope>.routes.ts` → `<scope>Routes`, `<scope>.providers.ts` → `provide<X>()` | `bookingRoutes`, `provideBooking` | `blueprint/layer-symbol-naming` | umgesetzt |
| Testing | Fixture `a<X>()`/`an<X>()`, `<n>.handlers.ts` → `<n>Handlers`/`<n>Scenarios` | `aBooking`, `checkinHandlers` | `blueprint/layer-symbol-naming` | umgesetzt |
| Testing generierter Clients | `<client>Http`, `<client>Handlers` | `petClientHttp` | Generator (openapi), Code in `src/generated/**` ausgenommen | besteht |
| Schreibweise | Typen PascalCase, Funktionen/Variablen camelCase, Konstanten auch UPPER_CASE; DTO-Properties frei (`booking_id`) | `FAKER_SEED` | `@typescript-eslint/naming-convention` | umgesetzt |

Ausnahmen, bewusst: Shared-Buckets dürfen in `types`/`utils` Einzeldateien ohne Kind haben (`format-date.ts`, `entity-id.ts`: ein Helfer pro Datei). Komponenten dürfen den Selektor-Präfix im Klassennamen tragen (`AppButton` in `button.ts`), wenn der Name allein zu generisch ist. Daten-Services ohne `Store` bleiben erlaubt (`service`-Generator in `data`). Generierter Code (Client-Libs, `src/generated/**`) ist ausgenommen.

### Mechanismen: Bewertung

| Mechanismus | Präzision | IDE | Autofix | Laufzeit / Cache | Bewertung |
|---|---|---|---|---|---|
| Eigene ESLint-Regeln (`packages/tooling/eslint-rules`, `RuleCreator`, ohne Typinfo) | hoch: kennt Layer/Scope/Feat aus den Konventionen | ja | für Namen exportierter Symbole nicht sinnvoll (Importeure), Dateien kann ESLint nicht umbenennen; Vorschläge für Komponentenklasse/Selektor | +~45 ms pro Lint-Prozess, `nx lint`-Cache (Regelquellen sind Input) | **umgesetzt** für Datei- und Symbolnamen, Public API |
| `nx g @nx/eslint:workspace-rule` | gleich | ja | – | – | **verworfen**: fester Ordner `tools/eslint-rules`, `project.json` + Jest, Präfix `@nx/workspace-`. Die Lademechanik dahinter (`loadWorkspaceRules`, swc, kein Build) wird genutzt |
| `@angular-eslint` (`component-selector`, `directive-selector`) | Präfix + Stil | ja | nein | +~65 ms pro Lint-Prozess (Plugin-Import) | **umgesetzt**: Standard-Regeln, auch für `apps/`. `component-class-suffix` **verworfen** (Style Guide ohne Suffix) |
| `@typescript-eslint/naming-convention` | Schreibweise, kennt keine Layer | ja | nein | vernachlässigbar | **umgesetzt** als Grundnetz |
| `eslint-plugin-check-file` | Globs, kein Layer-Wissen | ja | nein | neue Abhängigkeit | **verworfen**: Layer-Liste müsste als Glob-Tabelle dupliziert werden |
| `ls-lint` | Datei-/Ordnernamen per Pfad-Glob, sehr schnell | nein (eigenes CLI) | nein | eigenes Target | **verworfen**: kein Editor-Feedback, dupliziert Layer-Liste, Ordner deckt `verify` ab |
| `eslint-plugin-boundaries` | Element-Typen per Pfad | ja | nein | – | **verworfen**: redundant zu Tags + `depConstraints` |
| `verify`: Ordnerregel im Tag-Schema | Lib-Ordner, Scope, Layer, kebab-case | nein | nein | gecacht, CI | **umgesetzt** statt Crystal-Plugin (gibt es hier nicht): Pfad jeder Lib (`project.json` mit `src/index.ts`) wird geprüft. Ein falscher Ordner bricht den Graphen nicht, `nx lint` läuft normal; rot wird erst `verify` |
| Sync-Generator (`nx sync`) | – | – | ja | – | **verworfen** für Namen: Umbenennen ist keine idempotente Reparatur. Bleibt für Routen |
| `verify` | Verdrahtung | nein | nein | gecacht | **umgesetzt**: 14 Fälle `naming: …` beweisen, dass die Regeln in der echten Config greifen (Loader, `files`/`ignores`, Präfix, Ausnahme generierter Code). Die Regellogik testen die RuleTester-Specs |
| Nx Conformance (`@nx/conformance`) | Workspace-weite Regeln gegen den Graph | nein | nein | eigenes Kommando | **verworfen**: Nx Powerpack/Enterprise (Lizenz), kein Editor-Feedback, Ordner/Tags deckt `verify` ab |
| Generatoren | erzeugen korrekte Namen | – | – | – | **Quelle**, validieren den Pfad vorab (`libPathError`, kebab-case: `feat booking CheckIn` → *Feat "CheckIn" must be kebab-case*). Beweis: `domain payment` + `feat payment checkout --api --data --ui` + `layer payment events`/`utils` + `component`/`store`/`service` → `nx lint` (13 Projekte + `client`) und `verify` grün, danach `remove payment` → `git status` unverändert |
| TypeScript (Template-Literal-Typen) | – | ja | – | – | **verworfen**: Dateinamen unerreichbar, Symbolnamen nur mit Typ-Gymnastik pro Datei |

### Laufzeit

`nx run-many -t lint --skip-nx-cache` (55 statt 54 Projekte, neu: `tooling-eslint-rules`; inkl. 6 `generate`), frischer Clone, je dreimal abwechselnd: vorher (`7e042d9`) 20,3–22,3 s, nachher 24,7–26,0 s (**+~4 s, ~18 %**; auf `feat/nx-blueprint` gemessen: +2,5 s). Gecachte Läufe: unverändert.

### Limitierungen

- Der Selektor-Präfix `app` steht in `eslint.config.mjs` (`selectorPrefix`), in `apps/client/project.json` und in den Generator-Templates. Ein Präfix pro Scope wäre per `files`-Block pro Scope möglich, hieße aber alle Selektoren und Templates umzubenennen; nicht umgesetzt.
- Dateien ohne Kind (`<name>.ts`) sind in den meisten Layern erlaubt, die Regel prüft dort nur kebab-case. Ob `booking-notifications.ts` wirklich ein HTTP-Wrapper ist, weiß sie nicht.
- `blueprint/layer-symbol-naming` sieht nur `export class|function|const` direkt am Symbol, nicht `export { X }` am Dateiende.
- **Ordnerregel nur in `verify`:** kein Editor-Feedback, kein Graph-Fehler; eine von Hand angelegte Lib `libs/booking/feat-CheckIn/feature` lintet und baut, bis `pnpm verify` (lokal oder CI) rot wird. Auf `feat/nx-blueprint` bricht das Plugin sofort jeden Nx-Befehl.
- **Konventionen sind wieder `lint`-Input:** die Namensregeln importieren `lib-conventions.ts` (`FILE_KINDS`, `parseLibPath`), deshalb steht die Datei neben `eslint-rules/src/**` in den `lint`-Inputs (`nx.json` → `targetDefaults`, `lint` und `@nx/eslint:lint`). Eine Änderung an den Konventionen betrifft per `affected` wieder jedes Projekt (nur `lint`; `build`/`test`/`typecheck` nicht).
- **Specs der Regeln:** aus dem Hash ausgenommen (`!…/*.spec.ts`, Cache-Treffer), aber `nx affected` ignoriert negierte Inputs: eine Spec-Änderung markiert trotzdem alle Projekte.
- Die Regeln laufen per `loadWorkspaceRules` (öffentlicher Export von `@nx/eslint-plugin`, intern swc). Ändert Nx das, meldet ESLint *Could not find "blueprint/…"* (laut, nicht still).

## Tooling & Generatoren

Das Werkzeug liegt in **`packages/tooling`**, aufgeteilt in sechs Nx-Libs (je eigenes Projekt und Workspace-Paket, `type:tooling` + `tooling:<lib>`). Details, Optionen und Begründungen: [`packages/tooling/README.md`](../packages/tooling/README.md) und die README jeder Lib.

| Lib (Paket) | Inhalt |
|---|---|
| `conventions` (`@blueprint/tooling-conventions`) | Pfad → Name/Tags/Alias, `generated`, Client-Pfade, Scope-Liste (`lib-scopes.json`), Vorlage der Config-Dateien (`lib-files.ts`), Tree-Helfer (schreiben/verschieben Config + `paths`), Spec-Fixture |
| `workspace` (`@blueprint/tooling-workspace`) | Generatoren, Sync-Generator `app-routes` (`nx.json` → `sync.globalGenerators`) |
| `openapi` (`@blueprint/tooling-openapi`) | `project.json`-Vorlagen der Clients (`project-config.ts`), Facade, Adapter, Testing-Pipeline, Executoren `generate`/`generate-testing`/`update-spec`, Generator `client` |
| `ng-lib` (`@blueprint/tooling-ng-lib`) | Executor `test` (durchgereicht, Vitest UI per `--ui` + Hasher) |
| `verify` (`@blueprint/tooling-verify`) | `verify` (Nx-Target `tooling-verify:verify`, gecacht), `verify:nx-internals`, dist-Snapshot |
| `eslint-rules` (`@blueprint/tooling-eslint-rules`) | ESLint-Regeln des [Namensschemas](#namensschema), geladen von `eslint.config.mjs` |

Abhängigkeiten (Paket-Imports, `depConstraints` + 20 Verify-Fälle, zyklenfrei): `openapi` → `conventions`; `eslint-rules` → `conventions`; `workspace` → `conventions`, `openapi` (move/remove pflegen `openapi-clients.json` und Client-`project.json`); `conventions`, `ng-lib`, `verify` → nichts. `workspace` → `ng-lib` ist entfallen (keine inferierten Targets mehr).

**Kein Build-Schritt:** Nx lädt Generatoren und Executoren als TypeScript/JS aus den Quellen (eigener swc-Transpiler), aufgelöst über die Workspace-Links in der Root-`package.json` (`@blueprint/tooling-workspace`, `-openapi`, `-ng-lib`) und in den `package.json` der Libs. Jeder importierte Tooling-Export hat einen exakten `paths`-Eintrag (`verify` prüft `exports` ↔ `paths`). Kein Plugin mehr, das bei jeder Graph-Berechnung geladen wird.

### Anleitungen

```sh
# neue Domain: types, data, ui, shell + testing + Beispiel-Spec, je mit Config-Dateien + paths, Lazy-Route, Scope in lib-scopes.json
nx g @blueprint/tooling-workspace:domain payment
# neue Lib in bestehender Domain (Layer-Liste aus den Konventionen)
nx g @blueprint/tooling-workspace:layer payment utils
# neues Feat: feature-Container + optional data, ui; Lazy-Route in den Shell-Routes
nx g @blueprint/tooling-workspace:feat payment checkout --data --ui
# testing-Gerüst für eine bestehende Domain
nx g @blueprint/tooling-workspace:testing checkin
# generierter OpenAPI-Client (shared oder --domain), Spec als Datei oder URL
nx g @blueprint/tooling-openapi:client weather-client --spec=https://example.org/openapi.json
nx g @blueprint/tooling-openapi:client billing-client --domain=booking --spec=./specs/billing.yaml --adapter=hey-api
# verschieben / umbenennen (Importe inkl. import() in Routes, Route-Pfade, Scope-Liste, project.json/package.json/tsconfig, paths)
nx g @blueprint/tooling-workspace:move booking/feat-rebook checkin/feat-rebook
nx g @blueprint/tooling-workspace:rename payment billing
# löschen (bricht bei Importen ab, außer --force; Routen, paths, Kanten + Scope raus)
nx g @blueprint/tooling-workspace:remove billing
# Komponente / Service / Store in einer Lib
nx g @blueprint/tooling-workspace:component libs/booking/ui/src/booking-badge   # → @nx/angular:component
nx g @nx/angular:component libs/booking/ui/src/booking-badge --export          # geht jetzt auch direkt (ohne Layer-Prüfung)
```

`@nx/angular:component` funktioniert mit `project.json` wieder (getestet: erzeugt `booking-badge.ts` und exportiert es aus `index.ts`). Nx hat keinen Service-Generator; `@schematics/angular:service` läuft über Nx' Angular-CLI-Adapter mit `--project booking-data --path libs/booking/data/src` (getestet). Die Blueprint-Generatoren `component`/`service` bleiben als **dünne Vorbelegung**: Layer-Prüfung (component nur in ui/feature/shell, service in data/feature/shell, nie in generierten Clients), Pfad statt Projekt + Name, inline Template/Styles, `app`-Präfix, ohne Spec, Export aus `index.ts`, dann delegieren sie an den Nx- bzw. Angular-Generator (Templates von dort, z.B. Angular 22 `@Service()`). `store` behält sein Template (Nx kennt keinen Signal-Store-Generator). `nx.json` → `generators["@nx/angular:component"].style` ist gesetzt, sonst schreibt der Nx-Generator ihn beim ersten Aufruf in `nx.json` (Cache-Invalidierung).

### Wächter

- **Config pro Lib:** `tooling-verify:verify` meldet jede fehlende oder falsche Datei (`project.json`, `tsconfig.json`, bei buildable Libs `package.json`, `ng-package.json`, `tsconfig.lib*.json`, bei Specs `tsconfig.spec.json`; Name, `sourceRoot`, Targets, Alias, `dest`, `extends`, peers), Build-Dateien in Testing-Libs, Config-Dateien außerhalb einer Lib/eines Client-Ordners, fehlende/falsche/veraltete `paths`-Einträge und einen Wildcard.
- **Tags + Scope-Liste:** Tags jeder `project.json` = aus dem Pfad abgeleitete Tags, Scope in `lib-scopes.json`, keine Listeneinträge ohne Lib. `domain`, `move`/`rename`, `remove` pflegen die Liste.
- **Namen:** Lib-Ordner (Form, Layer, kebab-case für Scope/Feat/Client) → `tooling-verify:verify` (Ordnerregel), Generatoren lehnen ab; Datei-, Ordner- und Symbolnamen in den Libs → `nx lint` (`blueprint/*`, `@angular-eslint/*-selector`, `@typescript-eslint/naming-convention`), siehe [Namensschema](#namensschema).
- **Routen:** `nx sync:check` (globaler Sync-Generator `@blueprint/tooling-workspace:app-routes`): jede Slice-Shell mit `Routes` ist in `app.routes.ts` registriert, keine Lazy-Route zeigt auf eine fehlende Lib. `nx sync` repariert.

### CI

`.github/workflows/ci.yml` (Push auf `main`/`feat/nx-blueprint`/`feat/nx-blueprint-explicit-config`, PRs): `pnpm install --frozen-lockfile`, Java 17 (Temurin) + Jar-Cache für openapi-tools, `playwright install --with-deps chromium`, `nx sync:check`, dann bei PRs `nx affected -t build lint test typecheck` (Basis per `nrwl/nx-set-shas`), bei Pushes `run-many`, zuletzt `nx run tooling-verify:verify`. Kein Tooling-Fallback: jede Tooling-Datei, die eine Lib-Task nutzt, ist `{workspaceRoot}`-Input dieser Task, `affected` folgt Inputs (ng-lib → alle Libs mit `test` + Abhängige, Facade → Clients + Abhängige). Generatoren betreffen nur noch die Tooling-Libs (auf `feat/nx-blueprint` waren die Plugins `lint`-Input aller Libs); `lib-conventions.ts` und `eslint-rules/src/**` sind `lint`-Input aller Projekte (Namensregeln). `verify` probt das (`nx show projects --affected --files=…`, 9 Proben, auch negativ: `ng-lib/src/test.js` betrifft `booking-types` nicht).

### Nach `nx migrate`

`pnpm verify:nx-internals` vor dem Commit der Migration (und nach Angular-Updates): run-many mit `--skip-nx-cache` in frisches `dist/`, dist-Äquivalenz gegen `packages/tooling/verify/nx-internals/dist-hashes.json` (oder `--reference <kopie-von-dist-vorher>`), Marker-Test „App baut gegen dist“ (Remap über lib-`package.json`), MSW-Probe „fehlender Handler → Test rot“, MSW-Worker „von Vitest aus dem msw-Paket serviert“, Vitest UI „`test --ui` nie aus dem Cache“ (Nx lädt den Hasher), `tooling-verify:verify`. Ändert das Update den Output bewusst: Unterschiede prüfen, dann `--update-snapshot`.

## Verifikation

```sh
pnpm exec nx run-many -t build lint test typecheck   # 46 Projekte + 6 generate grün, inkl. tooling-openapi:test (Unit + Integration, Java)
pnpm verify                                           # nx run tooling-verify:verify: 155/155 Fälle (140 Boundary + 15 Namensregeln) + Config-Wächter + Tag-Schema/Ordnerregel/Scope-Liste + Test-Isolation + neue Lib + generierte Clients + affected + client-Bundle
pnpm exec nx sync:check                               # app.routes.ts ↔ Slice-Shells
pnpm verify:nx-internals                              # nach nx migrate, siehe Tooling & Generatoren
```

Beweise für den reduzierten Stand (tatsächlich ausgeführt, `NX_DAEMON=false`, Branch `feat/nx-reduced-blueprint`):

- `run-many -t build lint test typecheck`: 46 Projekte + 6 `generate` grün.
- `pnpm verify`: 155/155, Config-Wächter 38 Libs, Tag-Schema 40 Libs (keine `port`/`feat-port`-Tags, keine `api`/`events`-Ordner), Test-Isolation, neue Lib, 6 Tooling-Libs, 9 Affected-Proben, 3 Clients (94 generierte Dateien, alle gitignored), client-Bundle ohne msw/vitest/faker — 0 Probleme.
- `pnpm verify:nx-internals --update-snapshot`: 7/7 grün. dist-Snapshot neu geschrieben (511 statt 580 Dateien, weil 9 Libs weniger), Marker „App baut gegen dist“, MSW „fehlender Handler → `booking-data:test` rot“, MSW-Worker aus dem msw-Paket, Vitest-UI-Hasher, `verify`.
- `nx sync:check` grün.
- **Mutationsprobe Boundaries:** Scope- und Feat-Constraints um alle Slices/Feats erweitert (= Ports durch die Hintertür) → 22 Fälle rot (`133/155`), Exit 1, danach zurückgesetzt.
- **Generator-E2E:** `domain payment` (types, data, ui, shell, testing + Store-Spec), `feat payment checkout --data --ui`, `layer payment utils`, `component libs/payment/ui/src/payment-badge`, `service libs/payment/data/src/payment-cache`, `store libs/payment/feat-checkout/ui/src/checkout-filter`, `client things-client --domain=payment` (Facade, Tags `type:data`) + Nutzung von `ThingsService` in `payment/data` → `run-many` der payment-Projekte + `client`, `verify` (47 Libs), `sync:check` grün; `remove payment --force` → `git status` wie vorher.
- **App im Browser** (`nx run client:serve`, Chrome):
  - `/bookings`: Karten aus dem `BookingStore`, Karte aufklappen → „Confirm“ → Status `confirmed`, „Last confirmed booking: b1“ (ui gibt die ID heraus, der Container erzeugt `bookingConfirmed`, der Store verarbeitet es).
  - `/bookings/manage`: bestätigte Buchungen + „Booking b2 checked at …“ (`describeCheck` aus `booking/utils`).
  - `/checkin`: „Agent: Michael“ (`AuthStore` aus `shared/data`), „Walk-in guest“ → „Checked in today (1)“ (ui gibt `Arrival` heraus, der Container erzeugt `guestArrived`).
  - `/checkin/history`: „Desk clear — no open arrivals“ (`describeDesk` aus `checkin/utils`).
  - Keine Konsolenfehler beim Laden. „Load arrivals“ wirft `SyntaxError: Unexpected token '<'`: Die Demo hat kein Backend, der Dev-Server beantwortet `/api/arrivals` mit `index.html`. Das ist kein Regelproblem. Auf dem Vorgänger-Branch verhielt sich `/api/bookings` genauso.

`packages/tooling/verify/scripts/verify-boundaries.mjs` lintet für jeden Fall eine virtuelle Datei (`ESLint#lintText` mit `filePath` in der echten Lib) gegen die echte Config.

| Regel | erwartet | Ergebnis |
|---|---|---|
| layer: ui → data (booking, checkin), utils → data (shared, Domain) | blockiert | ✅ `type:ui` / `type:utils` (Domain: auch Zyklus) |
| layer: types → types (eigener Scope, shared) | erlaubt | ✅ |
| layer: types → utils, types → fremde Domain-types, shared types → Domain-types | blockiert | ✅ `type:types` / `scope:<s>` / `scope:shared` |
| layer: data → ui, data → shell | blockiert | ✅ `type:data` (shell: auch Zyklus) |
| layer: ui → utils, data → utils, Feat-data → Slice-data, feature → ui | erlaubt | ✅ |
| scope: fremde Domain data/types/utils/entry (auch aus einem Feat), layout → Domain, shared → Domain | blockiert | ✅ `scope:<s>` / `scope:shared` |
| scope: Domain → shared, feature → `shared/data` (Auth) | erlaubt | ✅ |
| feat: Geschwister data/feature/ui, fremdes Feat | blockiert | ✅ `feat:<f>` / `scope:<s>` |
| feat: eigene Interna, Geschwister teilen über Slice-Root (`checkin/utils`) | erlaubt | ✅ |
| app: Shell → ui / data, statischer Import einer lazy entry, Lib → App | blockiert | ✅ `type:app` / lazy-loaded / relative Import |
| app: Shell → entry, → `shared/data` | erlaubt | ✅ |
| encapsulation: relativ in fremde Lib / Deep-Alias | blockiert | ✅ Nx-Builtin / `no-restricted-imports` |
| nx: HTTP in ui / feature / utils, types → `@angular/core`, Zyklus data ↔ feat-data, Lib ohne Tags | blockiert | ✅ `bannedExternalImports` / Circular / `without tags` |
| nx: HTTP in data | erlaubt | ✅ |
| testing: Produktion → testing (Lib / Feature / App), msw/vitest in Produktion | blockiert | ✅ non-buildable bzw. `type:app`; nur Tags: `type:data`/`type:feature` |
| testing: Spec → eigenes testing / shared/testing, testing → types / shared/testing, msw in testing/Spec | erlaubt | ✅ |
| testing: Spec → fremdes Domain-testing / fremde Domain-data, shared-Spec → Domain-testing, types-Spec → testing, Spec ui → data | blockiert | ✅ `scope:<s>` / `scope:shared` / Circular / `type:ui` |
| testing: testing → data (Zyklus), → ui, → fremdes testing | blockiert | ✅ Circular / `type:testing` / `scope:<s>` |
| neue Lib (`booking/feat-tmpverify/ui`, Dateien der Generatoren): ui → data, → fremdes Feat, Geschwister-Feat → neue Lib, fremder Slice → neue Lib, Deep-Alias | blockiert | ✅ `type:ui` / `feat:tmpverify` / `feat:check-booking` / `scope:checkin` / `no-restricted-imports` |
| neue Lib → shared | erlaubt | ✅ |

Generierte Clients und Tooling-Libs: siehe [OpenAPI-Clients → Verify](#verify) und [Tooling & Generatoren](#tooling--generatoren). Die Kommentare `// boundary-violation-example: …` in den Quellen markieren weitere Verstöße zum Einkommentieren (z.B. `checkin-desk.store.ts` → `booking/data`).

Negativproben Namensschema (je `nx lint <projekt>` rot, danach zurückgebaut):

| Verstoß | Projekt | Meldung |
|---|---|---|
| `booking.store.ts` in `booking/utils` | `booking-utils` | `blueprint/lib-file-naming`: belongs into a data/ui/feature lib |
| `export class Bookings` in `booking/data/src/bookings.store.ts` | `booking-data` | `blueprint/layer-symbol-naming`: must be named "BookingsStore" |
| Selektor `bk-booking-card` | `booking-ui` | `@angular-eslint/component-selector`: should start with … "app" |
| `export * from './internal/checkin.mapper'` in `index.ts` | `checkin-data` | `blueprint/no-internal-export`: internal/ is lib-private |
| Lib-Ordner `booking/feat-CheckIn/feature` (Kopie einer Feature-Lib, `project.json`, Tags und `paths` passend) | – | Graph und `nx lint` laufen; `tooling-verify:verify` rot: *folder "CheckIn" must be kebab-case*. Der Generator lehnt `feat booking CheckIn` ab. (`checkin/feat-CheckIn` geht auf macOS nicht: APFS ist case-insensitiv, `feat-checkin` existiert) |

## Selbst ausprobieren

Voraussetzungen: Node 22 (≥ 22.16), pnpm 10, Java 11+ (`java -version`, für den Adapter openapi-tools), Netz beim ersten Lauf (Jar-Download, Petstore-URL).

```sh
# 1. frischer Checkout
git clone <repo-url> sheriff-blue-print && cd sheriff-blue-print
git checkout feat/nx-reduced-blueprint
pnpm install
pnpm exec playwright install chromium          # einmalig, Browser für die Tests

# 2. generieren (optional: build/lint/test/typecheck generieren selbst; hilft der IDE)
pnpm openapi:generate                           # = nx run-many -t generate, 6 Tasks
git status                                      # leer: generierter Code ist gitignored
ls libs/booking/generated/booking-client/*/src/generated

# 3. bauen, testen, prüfen
pnpm exec nx run-many -t build lint test typecheck
pnpm verify                                     # nx run tooling-verify:verify, 155 Fälle + Checks
pnpm exec nx sync:check

# 4. ansehen
pnpm exec nx graph                              # Projekte generated-*, Kanten Teil → Client
pnpm exec nx show project booking-generated-booking-client   # Targets generate/update-spec, Inputs (aus libs/booking/generated/booking-client/project.json)
cat libs/booking/data/project.json                # Tags + leere Targets, Bodies: nx.json → targetDefaults
pnpm exec nx show projects --affected --files libs/generated/notification-client/openapi.yaml
pnpm exec nx graph --focus=tooling-workspace     # Tooling-Libs: workspace → conventions, openapi; openapi → conventions
pnpm exec nx run-many -t lint test typecheck -p 'tooling-*'   # Specs der Tooling-Libs
pnpm exec nx show projects --affected --files packages/tooling/ng-lib/src/test.js    # Libs mit test + Abhängige
pnpm exec nx show projects --affected --files packages/tooling/conventions/src/lib-conventions.ts   # nur Tooling (Tags stehen in project.json)

# 5. Tests interaktiv: Vitest UI (watch, headed Chromium mit Browser-Vorschau, MSW läuft wie im Test), bis Strg+C oder q
pnpm test:ui booking-data                       # = nx run booking-data:test --ui → http://localhost:51204/__vitest__/
pnpm exec nx run booking-data:test --ui --headless   # UI ohne Browserfenster (Tests laufen headless, Ergebnis in der UI)
pnpm exec nx run booking-data:test --browsers=chromium --watch   # nur headed, ohne UI

# 6. neuen Client anlegen (Datei oder URL), nutzen, wieder entfernen
cat > /tmp/demo.yaml <<'YAML'
openapi: 3.0.3
info: { title: Demo API, version: 1.0.0 }
servers: [{ url: /api }]
paths:
  /greetings:
    get:
      operationId: listGreetings
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Greeting" } }
components:
  schemas:
    Greeting:
      type: object
      required: [id, text]
      properties:
        id: { type: string, example: g-1 }
        text: { type: string, example: Hello }
YAML
pnpm exec nx g @blueprint/tooling-openapi:client demo-client --spec=/tmp/demo.yaml   # shared; Domain: --domain=checkin, Adapter: --adapter=hey-api
pnpm exec nx run-many -t build lint test typecheck
#   nutzen: @blueprint/generated/demo-client/api im data-Layer, in Specs
#   import { demoClientHandlers, demoClientHttp } from '@blueprint/generated/demo-client/testing'
pnpm exec nx g @blueprint/tooling-workspace:remove generated/demo-client
git status                                      # wieder leer

# 7. Adapter tauschen (booking-client)
#   openapi-clients.json: "booking/generated/booking-client": { "adapter": "hey-api" }
#   libs/booking/generated/booking-client/project.json: generate-Inputs auf hey-api (pnpm verify nennt die erwarteten)
#   libs/booking/data/src/booking-api.ts: Variante B (siehe Abschnitt Adapter)
pnpm exec nx run-many -t build lint test typecheck
git checkout openapi-clients.json libs/booking/data/src/booking-api.ts libs/booking/generated/booking-client/project.json

# 8. Spec aktualisieren (nur Clients mit url)
pnpm exec nx run generated-pet-client:update-spec   # "unchanged" oder "updated"
git diff libs/generated/pet-client/openapi.yaml

# 9. Cache pro Client
#   openapi-clients.json: "generated/pet-client": { "url": "…", "options": { "providedIn": "root" } }
pnpm exec nx run-many -t build lint test typecheck generate   # nur generated-pet-client:generate läuft neu
git checkout openapi-clients.json

# 10. Negativprobe Boundaries
printf "import { BookingsService } from '@blueprint/booking/generated/booking-client/api';\nexport const x = BookingsService;\n" > libs/booking/ui/src/probe.ts
pnpm exec nx lint booking-ui                    # rot: type:ui darf kein type:data
mv libs/booking/ui/src/probe.ts libs/checkin/data/src/probe.ts
pnpm exec nx lint checkin-data                  # rot: scope:checkin nie ein fremder Slice
rm libs/checkin/data/src/probe.ts

# 11. Negativprobe fehlender Handler
#   in libs/booking/data/src/booking-notifications.spec.ts die Zeile
#   beforeEach(() => worker.use(...notificationClientHandlers)); auskommentieren
pnpm exec nx test booking-data                  # rot: [MSW] … without a matching request handler
git checkout libs/booking/data/src/booking-notifications.spec.ts
```
