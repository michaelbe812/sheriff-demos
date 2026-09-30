# Blueprint mit reinen Nx-Mitteln

Branch `feat/nx-blueprint`: das Regelwerk aus [`architecture.md`](./architecture.md) (Ausgangs-Blueprint, ohne `infra/`), aber **ohne Sheriff**. Die Grenzen erzwingen nur Nx-Libs, Tags und `@nx/enforce-module-boundaries` (Nx 23.1). Sheriff wird auch für Regeln *innerhalb* einer Lib nicht gebraucht (Begründung in [Entscheidung: Feat-Buckets als eigene Libs](#entscheidung-feat-buckets-als-eigene-libs)).

## Lib-Struktur: eine Lib pro Slice × Layer

```
apps/client/src/            type:app            dünne Shell: main.ts, app.ts, app.config.ts, app.routes.ts
libs/
  <slice>/                  booking, checkin (Domains) · auth, layout (Shared-Features)
    types/ utils/ events/ data/ ui/         scope:<slice> type:<layer> feat:none
    api/                                    + port        öffentliche API des Slices
    shell/                                  type:feature + entry   routes/providers/shell = Slice-Root
    feat-<feat>/
      feature/                              scope:<slice> type:feature feat:<feat>
      api/                                  + feat-port   öffentliche API für Geschwister-Feats
      data/ ui/ …                           feat:<feat>
  shared/types|utils|api|ui                 scope:shared type:<layer> feat:none
  <domain>/testing, shared/testing          scope:<d>|shared type:testing feat:none   nur für Specs, siehe Testing & MSW
  generated/<client>/types|api|core|testing           scope:shared      ┐ generierte OpenAPI-Clients, Marker `generated`,
  <domain>/generated/<client>/types|api|core|testing  scope:<domain>    ┘ nur index.ts committet, siehe OpenAPI-Clients
```

- Jede Lib = Ordner + `src/index.ts` als **einzige** öffentliche API. Außerhalb von `src/` gibt es pro Lib **keine Datei**: kein `project.json`, `package.json`, `ng-package.json`, `tsconfig*.json`. Projekt, Tags und Targets leitet das lokale Nx-Plugin `@blueprint/tooling-workspace` aus dem Pfad ab (siehe [Libs ohne Config-Dateien](#libs-ohne-config-dateien)), `tooling-verify:verify` meldet jede solche Datei rot.
- Neue Domains, Libs und Feats legen die Generatoren an (siehe [Tooling & Generatoren](#tooling--generatoren)).
- Alias: `@blueprint/<pfad-unter-libs>`, z.B. `@blueprint/booking/api` oder `@blueprint/checkin/feat-checkin/api`. Ein einziger Wildcard-Eintrag in `tsconfig.base.json` deckt alle Libs ab: `@blueprint/*` → `./libs/*/src/index.ts`.
- Projektname = Pfad mit `-` (`booking-feat-check-booking-data`).
- `booking.routes.ts`/`checkin.routes.ts` exportieren jetzt benannt (`bookingRoutes`), weil `export *` keinen Default re-exportiert.
- Ein lib-privater Ordner `internal/` (z.B. `checkin/data/src/internal/checkin.mapper.ts`) ist bloße Konvention. Privat ist die Datei, weil `index.ts` sie nicht exportiert.

**Kosten:** 32 Libs (booking 12, checkin 11, auth 3, layout 2, shared 4) statt 2, dazu 3 Testing-Libs und 12 Libs der 3 Beispiel-Clients (je types/api/core/testing, nur `index.ts` committet). Pro Lib nur noch `src/index.ts` als Pflichtdatei. Ein neuer Bucket bedeutet einen neuen Lib-Ordner mit `src/index.ts`. Die Konfiguration ist zentral (`packages/tooling`, `libs/tsconfig*.json`), Dateizählung siehe [Libs ohne Config-Dateien](#libs-ohne-config-dateien).

## Buildable Libs

Jede Lib hat ein `build`-Target mit dem lokalen Executor `@blueprint/tooling-ng-lib:build` (incremental buildable). Er delegiert unverändert an `@nx/angular:ng-packagr-lite` (`ng-packagr` ~22.0). Die Target-Config inferiert das Plugin `packages/tooling/workspace/src/plugin/blueprint-libs.ts` (`dependsOn: ["^build"]`, cache, Output `dist/{projectRoot}`, Inputs siehe unten). Testing-Libs bekommen kein `build`.

**Keine Build-Dateien pro Lib.** Der Executor erzeugt pro Lauf in `tmp/ng-lib/<projectRoot>/<target>/`:

| Datei | Inhalt | warum nötig |
|---|---|---|
| `ng-package.json` | `dest` = `dist/<projectRoot>`, `entryFile` = `<projectRoot>/src/index.ts` (absolut) | ng-packagr (`forProject`) liest die Config nur aus einer Datei |
| `package.json` | `name` = Alias (`metadata.js.packageName` vom Plugin), `private`, `sideEffects: false`, `peerDependencies` = npm-Pakete, die der Produktionscode importiert (Graph-Kanten ∩ Imports ohne Specs) | ng-packagr verlangt sie neben der ng-package.json (`Cannot discover package sources … 'package.json' was not found`) |
| `tsconfig.json` | `extends` gemeinsame `libs/tsconfig.lib.json`, `paths` der Abhängigkeiten auf `dist/` | siehe unten |

- **Gemeinsame tsconfig** `libs/tsconfig.lib.json`. ng-packagr kompiliert nur `entryFile` (rootNames), `include` muss nur irgendeine Datei treffen (sonst TS18003). `production` = Option `compilerOptions: { declarationMap: false }`, statt einer eigenen prod-tsconfig.
- **Warum die Paths selbst umgeschrieben werden:** Nx (`@nx/js` `calculateProjectBuildableDependencies`) nimmt den Import-Namen einer Abhängigkeit aus deren lib-`package.json`, sonst den Projektnamen (`booking-data`). Ohne lib-`package.json` bliebe `@blueprint/booking/data` auf den Quellen. Beim Lib-Build scheitert das laut, die **App baut aber still aus Source**. Deshalb gibt es auch `@blueprint/tooling-ng-lib:application` (Wrapper um `@nx/angular:application`), der dieselben dist-Paths setzt. Alias-Quelle: `metadata.js.packageName` des Projekts, sonst exakter oder Wildcard-`paths`-Eintrag.
- **Inputs:** `libs/tsconfig.lib.json`, `libs/tsconfig.json`, `tsconfig.base.json` und `packages/tooling/ng-lib/src/**` sind explizite Build-Inputs, weil sie außerhalb der Libs liegen.
- **peerDependencies nur aus Produktionscode:** Die Graph-Kanten enthalten auch Imports aus Specs. Ohne Filter stand nach dem MSW-Umbau `vitest` in der dist-`package.json` von 4 Libs (und der Build-Output hing an Spec-Dateien, die nicht in den `production`-Inputs sind).
- **dist ist byte-identisch** zum Setup mit Dateien pro Lib (alle 32 Libs + App, 346 Dateien, `diff -r`) und nach dem Umzug nach `packages/tooling` (Snapshot `packages/tooling/verify/nx-internals/dist-hashes.json`).
- **Incremental:** Beim Lib-Build schreibt Nx die Pfade abhängiger Libs auf `dist/` um. Ohne gebaute Abhängigkeit schlägt der Build fehl (`TS2307`), `dependsOn: ^build` sorgt für die Reihenfolge.
- **App:** `client:build` nutzt `@blueprint/tooling-ng-lib:application` (→ `@nx/angular:application`) mit `buildLibsFromSource: false`, bündelt also die gebauten Libs aus `dist/`. Die Chunks sind identisch zum Source-Build (main ~217 kB, 8 Lazy-Chunks, `bookingRoutes`/`checkinRoutes` lazy). `serve` (`@angular/build:dev-server`) baut weiterhin aus den Sources. Für `serve` gegen `dist/` bräuchte es `@nx/angular:dev-server` und damit `@angular-devkit/build-angular`, deshalb bewusst nicht umgesetzt.
- **Source-Aliase bleiben:** `tsconfig.base.json` zeigt weiter auf `src/index.ts` (IDE, `typecheck`, Lint).
- **Output:** `ng-packagr-lite` erzeugt `esm2022/` (eine Datei pro Quelldatei) + `.d.ts`, in *full compilation mode*, ohne FESM-Bundle. Das reicht für das App-Bundling, ist aber nicht publizierbar (deshalb `private: true`). Publizierbar wäre `@nx/angular:package` (FESM2022 + partial compilation).
- **`enforceBuildableLibDependency`** bleibt an. Jede Lib außer den Testing-Libs bekommt `build` automatisch, die Regel greift also bei Imports von Testing-Libs in Produktionscode.

## Libs ohne Config-Dateien

Pro Lib gibt es außerhalb von `src/` **keine Datei**. Eine neue Lib ist ein Ordner mit `src/index.ts`, angelegt per Generator:

```sh
nx g @blueprint/tooling-workspace:layer booking events
# → libs/booking/events/src/{index.ts,booking.events.ts}: Projekt booking-events,
#   Tags scope:booking type:events feat:none, Targets build/lint/typecheck,
#   Alias @blueprint/booking/events, alle Constraints aktiv
```

Von Hand geht es weiterhin (`mkdir -p libs/<scope>/<layer>/src && echo 'export {};' > …/index.ts`), der Scope muss dann in der Scope-Liste stehen. Specs dazulegen (`src/**/*.spec.ts`) erzeugt das `test`-Target. Ein Ordner `testing` statt eines Layers ergibt eine Testing-Lib (`type:testing`, kein `build`). `tooling-verify:verify` beweist das bei jedem Lauf mit zwei temporären Libs in `libs/booking/feat-tmpverify/` (`ui`, `types`, nur `src/index.ts`): Projekt, Tags und Targets stimmen, 8 Lint-Fälle gegen und von ihnen greifen, danach werden sie entfernt.

### Bausteine

| Baustein | Aufgabe |
|---|---|
| `packages/tooling/workspace/src/plugin/blueprint-libs.ts` | lokales Crystal-Plugin (`createNodesV2`, in `nx.json` → `plugins` als `@blueprint/tooling-workspace` mit `options.scopes`). Marker `libs/**/src/index.ts`. Liefert `name` (Pfad mit `-`), `root`, `sourceRoot`, `projectType`, Tags aus dem Pfad, `metadata.js.packageName` = Alias und die Targets. Ein Pfad, der nicht `libs/<scope>/<layer>` bzw. `libs/<scope>/feat-<f>/<layer>` mit bekanntem Layer und gelistetem Scope ist, bricht den Graph ab, statt still eine Lib ohne Regeln zu erzeugen. Konventionen (Layer, Tags, Scope-Check) in `@blueprint/tooling-conventions`, geteilt mit dem OpenAPI-Plugin und den Generatoren |
| `tsconfig.base.json` | ein Wildcard-Pfad `@blueprint/*` → `./libs/*/src/index.ts` statt 35 Einträgen |
| `libs/tsconfig.json` | gemeinsame Compiler-Optionen (strict, es2022, `module: preserve`), IDE + `typecheck` |
| `libs/tsconfig.lib.json` | Build (erweitert `libs/tsconfig.json`, Declarations, ohne Specs) |
| `libs/tsconfig.spec.json` | Tests (erweitert `libs/tsconfig.json`, nur Specs) |
| `packages/tooling/ng-lib/scripts/typecheck-lib.mjs` | `typecheck`: `libs/tsconfig.json`, `include` per TS-API im Speicher auf `<lib>/src` verengt (`tsc -p` kann `include` nicht per CLI setzen) |
| `packages/tooling/ng-lib/src/` | lokale Executoren `ng-lib-build`, `ng-lib-application`, `ng-lib-test` (unten) |
| `eslint.config.mjs`, `packages/tooling/verify/scripts/verify-boundaries.mjs` | lesen Tags, Lib-Roots (Deep-Import-Aliase) und Targets aus dem Projekt-Graph statt aus `project.json`/`paths` |

Inferierte Targets:

| Target | Executor | Wann |
|---|---|---|
| `lint` | `nx:run-commands` → `eslint .` im Lib-Ordner | immer |
| `typecheck` | `nx:run-commands` → `node packages/tooling/ng-lib/scripts/typecheck-lib.mjs <root>` | immer |
| `build` | `@blueprint/tooling-ng-lib:build` | nicht für `testing` |
| `test` | `@blueprint/tooling-ng-lib:test` | nur wenn `src/` eine `*.spec.ts` enthält |
| `test-ui` | `@blueprint/tooling-ng-lib:test` mit `ui: true`, `watch: true`, `browsers: [chromium]` (headed): Vitest UI | wie `test`; `cache: false`, `continuous`, nie in CI (`run-many -t test` nimmt es nicht mit) |

Eine `project.json` in einer Lib würde Nx zwar über die inferierten Werte legen, `tooling-verify:verify` meldet sie aber rot (Wächter gegen Config-Dateien). `typecheck-lib.mjs` nimmt technisch weiter eine lib-eigene `tsconfig.json`, auch die ist vom Wächter verboten.

### Executor-Wrapper (`packages/tooling/ng-lib`)

Alle drei delegieren an den Nx-Executor und ergänzen nur, was sonst aus Dateien pro Lib käme. Temporäre Dateien liegen in `tmp/ng-lib/<root>/<target>/` (gitignored).

| Wrapper | delegiert an | ergänzt |
|---|---|---|
| `build` | `@nx/angular:ng-packagr-lite` | `ng-package.json`, `package.json`, tsconfig mit dist-Paths (siehe [Buildable Libs](#buildable-libs)) |
| `application` | `@nx/angular:application` | tsconfig mit dist-Paths der Libs. Ohne ihn baut die App **still aus Source**, weil Nx den Alias nur aus einer lib-`package.json` kennt |
| `test` | `@nx/angular:unit-test` | Build-Target als `@angular/build:ng-packagr` + spec-tsconfig pro Lib (unten) |

**`test` im Detail.** `@angular/build:unit-test` braucht keine Datei pro Lib (`tsConfig`, `runnerConfig`, `setupFiles`, `providersFile` sind Workspace-Pfade). Zwei Probleme blieben:

1. **Build-Target:** Der Angular-Builder liest die Optionen des `buildTarget` (Default `<lib>:build:development`) und kennt nur `@angular/build:application` und `@angular/build:ng-packagr`. `@nx/angular:unit-test` mappt nur `ng-packagr-lite`/`package` auf `ng-packagr`, und dieser Pfad liest `<root>/ng-package.json` (nur `styleIncludePaths`, `assets`, `inlineStyleLanguage`). Für `@blueprint/tooling-ng-lib:build` käme „not supported“ plus Schema-Fehler. Lösung: Nx' Builder-Context (`createBuilderContext`) liest Executor und Optionen jedes Targets aus `context.projectGraph`. Der Wrapper gibt `@nx/angular:unit-test` eine Kopie des Kontexts, in der das Build-Target `@angular/build:ng-packagr` mit einer temporären `ng-package.json` (nur `lib.entryFile`) ist. Kein Monkeypatching, der Rest des Graphen bleibt unverändert. Das ist derselbe Pfad wie vorher mit echter `ng-package.json` pro Lib.
2. **Spec-tsconfig:** Eine gemeinsame tsconfig mit `**/*.spec.ts` würde pro Lib alle 4 Spec-Dateien des Workspaces kompilieren. Der Wrapper schreibt eine tsconfig, die `libs/tsconfig.spec.json` erweitert und `include` auf `<root>/src/**/*.spec.ts` + `*.d.ts` setzt. Beleg: `tsc --listFilesOnly` zeigt für `booking-data` 1 Spec, für `libs/tsconfig.spec.json` allein 4.

Browser Mode, MSW-Worker und die Workarounds in `vitest-base.config.mts` sind unberührt (`runnerConfig` wie bisher).

### Cache-Inputs

Gemeinsame Dateien liegen außerhalb von `{projectRoot}` und stehen deshalb explizit in den Inputs:

| Target | zusätzliche Inputs |
|---|---|
| `lint` | `eslint.config.mjs`, `packages/tooling/{workspace,openapi}/src/plugin/**`, `packages/tooling/conventions/src/lib-conventions.ts` (Tags und Kanten im Graph bestimmen die Constraints), `eslint` |
| `typecheck` | `tsconfig.base.json`, `libs/tsconfig.json`, `packages/tooling/ng-lib/scripts/typecheck-lib.mjs`, `typescript` |
| `build` | `production`, `^production`, `tsconfig.base.json`, `libs/tsconfig.json`, `libs/tsconfig.lib.json`, `packages/tooling/ng-lib/src/**`, `ng-packagr`, `@angular/compiler-cli`, `typescript` |
| `test` | `default`, `^production`, `tsconfig.base.json`, `libs/tsconfig.json`, `libs/tsconfig.spec.json`, `packages/tooling/ng-lib/src/**`, `vitest-base.config.mts`, `vitest`, `@vitest/browser-playwright`, `msw`, `@angular/build` |
| `client:build` (`targetDefaults`) | `production`, `^production`, `tsconfig.base.json`, `packages/tooling/ng-lib/src/**` |
| `tooling-verify:verify` | `libs/**`, `apps/**`, `eslint.config.mjs`, `nx.json`, `tsconfig.base.json`, Skript + Plugin, Output von `client:build` (dependsOn), `eslint`, `@nx/eslint-plugin`, `nx` |

- Die Plugins (+ `lib-conventions.ts`) sind nur bei `lint` ein Input. Die Target-Config selbst hasht Nx ohnehin mit (Hash-Instruktion `ProjectConfiguration`). Beleg: Option im Plugin geändert → `lint` aller Libs, alle `test` und die betroffenen `build`/`typecheck` laufen neu.
- Beleg: Leerzeile in `libs/tsconfig.spec.json` → genau die 4 `test`-Tasks laufen neu, alles andere aus dem Cache.
- `nx show target booking-data:test --inputs` zeigt die aufgelösten Inputs.

### Dateizählung

| | vorher (`2857237`) | nachher |
|---|---|---|
| Dateien pro Lib außerhalb `src/` (35 Libs) | 202: 35 `project.json`, 35 `tsconfig.json`, 32 `package.json`, 32 `ng-package.json`, 32 `tsconfig.lib.json`, 32 `tsconfig.lib.prod.json`, 4 `tsconfig.spec.json` | **0** |
| `paths` in `tsconfig.base.json` | 35 | 1 (Wildcard) |
| gemeinsame Dateien | – | 3 unter `libs/` (`tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`), alles Weitere im Package `packages/tooling` (Plugin, Executoren, Generatoren, Skripte) |
| Tasks `run-many -t build lint test typecheck` | 111 | 111 (dieselben), seit `packages/tooling` 114 (+ `tooling:lint/test/typecheck`), seit dem Split in 5 Tooling-Libs 122 (+ `lint` aller 5, `test`/`typecheck` von conventions, workspace, openapi) |
| dist (32 Libs + App) | – | byte-identisch |

Seit msw 3 gibt es keinen committeten `mockServiceWorker.js` mehr: Vitest serviert den Worker aus dem msw-Paket (siehe [Testing & MSW](#testing--msw)).

### Kosten und Trade-offs

- **Abhängigkeit von Nx-Interna.** Keine öffentliche API, kann sich mit jedem Minor ändern:
  - `@nx/angular/src/executors/{ng-packagr-lite,application,unit-test}/*.impl` (direkt importiert)
  - `@nx/js/internal` → `calculateProjectBuildableDependencies` (dist-Paths)
  - Verhalten von `nx/src/adapter/ngcli-adapter` `createBuilderContext`: liest Executor/Optionen aus `context.projectGraph` (Grundlage des `test`-Wrappers)
  - Verhalten von `@nx/angular:unit-test`: mappt nur `ng-packagr-lite`/`package`, Default-`buildTarget` `::development`
  - Verhalten von `@angular/build:unit-test`: akzeptiert nur `application`/`ng-packagr`, liest `ng-package.json` über `project`
- **Nach jedem `nx migrate` (und Angular-Update) die Beweise neu laufen lassen:** `pnpm verify:nx-internals` (run-many mit `--skip-nx-cache`, dist-Äquivalenz gegen Snapshot oder `--reference`, Marker-Test App-gegen-dist, MSW-Probe fehlender Handler, MSW-Worker aus dem msw-Paket, `tooling-verify:verify`), siehe [Tooling & Generatoren](#tooling--generatoren).
- **Eigene Generatoren nötig.** `@nx/angular:library` erzeugt genau die Dateien, die hier fehlen sollen, `@nx/angular:component`/`service` finden die inferierten Projekte nicht. Deshalb bringt `packages/tooling` eigene Generatoren mit.
- **Weniger sichtbar.** Targets und Tags stehen in keiner Datei der Lib. Nachsehen per `nx show project <name>` oder Nx Console („inferred“ + Quelle `blueprint-libs.ts`).
- **Plugin kostet pro Graph-Berechnung** einen Dateisystem-Scan pro Lib (Spec-Suche). Bei 35 Libs nicht messbar.
- **Tippfehler im Ordnernamen** eines Scopes (`libs/bookng/…`) oder eines Layers bricht den Graph ab: Scopes stehen in einer Liste (`nx.json`, Plugin-Option `scopes`), die die Generatoren pflegen.
- `typecheck` prüft Specs mit (wie vorher mit `include: src/**/*.ts`).

## Tag-Schema

| Achse | Tags | Wo |
|---|---|---|
| Scope | `scope:<slice>`, `scope:shared` | jede Lib |
| Type | `type:types\|utils\|events\|api\|data\|ui\|feature`, `type:app`, `type:tooling`, `type:testing` | jede Lib/App/Package |
| Feat | `feat:<feat>` bzw. `feat:none` | jede Lib |
| Marker | `port`, `feat-port`, `entry`, `generated` | Slice-api, Feat-api, Slice-shell, generierte Client-Libs (siehe [OpenAPI-Clients](#openapi-clients)) |
| Tooling | `tooling:conventions\|workspace\|openapi\|ng-lib\|verify` | Tooling-Libs in `packages/tooling/*` (siehe [Tooling & Generatoren](#tooling--generatoren)) |

## depConstraints (`eslint.config.mjs`)

Nx wendet **alle** Constraints an, die auf die Tags der Quelle passen, und verknüpft sie mit UND. Innerhalb einer Constraint reicht **ein** passendes Ziel-Tag (ODER). Das ist dieselbe Semantik wie bei den Sheriff-depRules. Marker-Tags brauchen deshalb keine transparente `anyTag`-Regel: für ein Tag ohne Constraint gilt einfach nichts.

```js
// Layer-Matrix
type:types   -> types                      + bannedExternalImports ['*']   (Scope-Regeln gelten: shared → shared, Domain → eigene + shared)
type:utils   -> types, utils
type:events  -> types, utils, events
type:api     -> types, utils, api
type:data    -> types, utils, api, data, events
type:ui      -> types, utils, ui, events
type:feature -> alle Produktions-Layer     (kein `type:*`-Glob mehr, er träfe type:testing)
type:app     -> entry, port, scope:shared  UND nur Produktions-Layer
type:testing -> types, testing, scope:shared
// sameTag-Ersatz, generiert aus den vorhandenen Tags
scope:shared -> scope:shared
scope:<s>    -> scope:<s>, port, scope:shared           (je Slice)
feat:<f>     -> feat:<f>, feat:none, feat-port          (je Feat)
// Nx-Extra
utils|events|data|ui|feature: bannedExternalImports ['@angular/common/http']
Produktions-Layer + app:      bannedExternalImports [msw, msw/*, vitest, vitest/*, @vitest/*, @testing-library/*, playwright, playwright/*]
// Override für *.spec.ts, *.test.ts, test-setup.ts: dieselben Constraints + type:testing (siehe Testing & MSW)
```

**Wie wird `sameTag` ausgedrückt?** Gar nicht direkt: Nx kann aus einem Ziel-Tag nicht auf das Quell-Tag zurückverweisen. Deshalb gibt es eine Constraint pro Scope und eine pro Feat. `sameTagConstraints()` in `eslint.config.mjs` liest dazu die Tags aller Projekte aus dem Projekt-Graph (die Lib-Tags liefert das Plugin) und erzeugt die Constraints aus den vorhandenen `scope:*`- und `feat:*`-Tags. Ein neuer Slice ist abgedeckt, sobald sein erster Lib-Ordner mit `src/index.ts` existiert. Eine Liste muss niemand pflegen.

Zusätzlich verbietet `no-restricted-imports` Deep-Imports: generiert aus den `tsconfig.base.json`-Paths, Muster `<alias>/**`.

## Mapping Sheriff-Regel → Nx

| Sheriff (architecture.md) | Nx-Konstrukt |
|---|---|
| Layer-Matrix `type:*` | `onlyDependOnLibsWithTags` je `type:*` |
| `type:feature` → alle `type:` | explizite Liste der Produktions-Layer (Glob `type:*` träfe `type:testing`) |
| `domain:*`: eigene Domain, fremde nur `port`, `shared` (`sameTag`) | generierte Constraint je `scope:<s>` |
| Shared-Features (`sharedFeatures`-Liste) | normale Slices mit `scope:auth`/`scope:layout`. Die Liste entfällt, das Tag genügt |
| `shared` → nur shared | `scope:shared` → `scope:shared` |
| `feat:*`: eigenes Feat, alles außerhalb `feat-*`, Geschwister nur `feat-port` (`sameTag` + Pfad-Guard `inAnyFeat`) | generierte Constraint je `feat:<f>`. „Außerhalb `feat-*`“ wird zum positiven Marker `feat:none` |
| `app:*`/`root`: nur entry, port, shared | `type:app` → `entry, port, scope:shared` (main.ts und app/ sind ein Projekt) |
| App-Isolation `sameApp` (pfadbasiert) | Nx-Builtin: Apps sind nicht importierbar (`noImportsOfApps`, relative/absolute Imports über Projektgrenzen verboten) |
| `noTag: noDependencies` | Nx-Builtin `projectWithoutTagsCannotHaveDependencies` |
| Barrel-less + Encapsulation `internal/` | `index.ts` = Public API. TS-Paths lösen nur `index.ts` auf, dazu `noRelativeOrAbsoluteImportsAcrossLibraries` und `no-restricted-imports` gegen Deep-Imports |
| Intra-Modul-Imports ungeprüft (lokaler Store im ui-Bucket) | intra-Lib-Imports ungeprüft, identisch |
| `entryPoints` / `sheriff verify` | entfällt: `nx lint` prüft jede Datei jeder Lib, nicht nur die erreichbaren |
| `checkDynamicDependenciesExceptions` | entfällt: Port und Shell sind getrennte Libs. Der statische Import einer lazy geladenen Lib wird jetzt korrekt geblockt |

## Entscheidung: Feat-Buckets als eigene Libs

`feat-<x>/api`, `/data` und `/ui` sind **eigene Libs**. Sie sind nicht bloß Ordner einer Feat-Lib, deren Innenleben Sheriff regeln müsste. Gründe:

- Die Layer-Matrix gilt im Feat genauso (feat-ui darf feat-data nicht importieren). Innerhalb einer Lib sieht Nx nichts; dafür bräuchte man Sheriff als zweite Regelsprache.
- `feat-port` wird ein Lib-Tag. Wäre das Feat eine einzige Lib, würde ihre `index.ts` Container **und** Port exportieren. Ein Geschwister-Feat käme dann auch an den Container.
- Mit eigenen Libs gibt es keine Sheriff-Abhängigkeit und keinen Build-Zwang für das Config-Package. Eine Regelsprache genügt.
- Preis: +7 Libs im Beispiel. Pro Feat kostet jeder genutzte Bucket eine Lib.

Alternative, falls die Lib-Anzahl stört: eine Lib pro Feat, dazu Sheriff nur mit `modules` für die Buckets innerhalb von `libs/*/feat-*/src`. Verworfen, weil dann wieder zwei Regelwerke parallel gepflegt würden.

## Was Nx besser kann

- **Cache/affected pro Layer:** Eine Änderung in `booking/ui` betrifft nur `ui`, `feature`, `shell` und die App, nicht `data`/`api`.
- **Zyklen** zwischen Libs werden erkannt (`noCircularDependencies`). Im Sheriff-Setup wurden sie nicht geprüft.
- **`bannedExternalImports`:** npm-Regeln pro Tag, z.B. `types` framework-frei, HTTP nur in `api`. Sheriff Upstream kann das nicht, dafür bräuchte man den Fork (`externalRules`).
- **Lazy-Load-Schutz:** Ein statischer Import einer lazy geladenen Lib würde das Lazy Loading still aushebeln. Nx meldet ihn im Lint.
- **Kein Config-Build:** Sheriff musste das Blueprint-Package gebaut in `node_modules` haben. Nx liest schlichtes `eslint.config.mjs`.
- **Public API durch TypeScript:** Ein Deep-Import ist nicht nur ein Lint-Fehler, er lässt sich gar nicht erst auflösen.
- Graph-Visualisierung (`nx graph`) und Nx Console.

## Limitierungen und Lösungen

| Limitierung | Lösung |
|---|---|
| Kein `sameTag`, keine Rückreferenz Quelle→Ziel | Constraints je Scope/Feat aus den Graph-Tags generiert (Workaround) |
| Keine Negation („kein `feat-*`“); `notDependOnLibsWithTags` ist **transitiv** (prüft alle erreichbaren Libs) und taugt deshalb nicht für „nur direkt verboten“ | Positiver Marker `feat:none` auf allen Nicht-Feat-Libs (Konvention, im Verify-Skript geprüft) |
| Tag-Tippfehler (`scope:bookng`) würde still einen neuen Scope erzeugen; Nx prüft Tags nicht gegen Ordner | Tags gibt es nicht mehr von Hand: das Plugin leitet sie aus dem Pfad ab, ein unbekannter Layer-Ordner oder ein Scope außerhalb der Scope-Liste (`nx.json`) bricht den Graph ab (`libs/bokking/ui: unknown scope "bokking" (did you mean "booking"?)`). `packages/tooling/verify/scripts/verify-boundaries.mjs` prüft die Plugin-Ausgabe unabhängig gegen den Pfad (Scope, Type, Feat, `entry`/`port`/`feat-port`), dass jede `src/index.ts` ein Projekt ist und die Scope-Liste keine Einträge ohne Lib hat |
| Die Regel erkennt Deep-Imports über einen Alias nicht (`@blueprint/checkin/data/src/…` passiert die Tag-Prüfung) | `no-restricted-imports` generiert aus den Lib-Roots im Graph (`@blueprint/<root>/**`); TS löst den Import ohnehin nicht auf |
| Zyklen werden **vor** Tags geprüft: ein Aufwärts-Import im Slice (api→data) meldet sich oft als „Circular dependency“ statt als Layer-Verstoß | geblockt ist er trotzdem, nur mit anderer Meldung. Das Verify-Skript testet beide Varianten |
| Ohne gecachten Projekt-Graph **überspringt** die Nx-Regel still (nur eine Warnung), z.B. bei `eslint` direkt oder in der IDE nach frischem Clone/`nx reset` | `nx lint` baut den Graph selbst. Für alle anderen Aufrufer baut `eslint.config.mjs` ihn per `ensureProjectGraph()` (top-level `await`), falls er fehlt. Geprüft: echter Verstoß in `booking-ui`, leeres `workspace-data`, `eslint <datei>` → Fehler statt Skip |
| App-interne Slices (Phase 1 des Sheriff-Blueprints) sind nicht prüfbar: eine App ist ein Projekt | alles, was Regeln braucht, lebt in Libs, die App ist dünne Shell (Konvention) |
| Domain-shared → Feat-Lib (z.B. `booking/data` → `feat-check-booking/data`) ist erlaubt, wie bei Sheriff | bewusst 1:1 übernommen. Härtung wäre möglich per `allSourceTags: ['feat:none', 'type:data']` → `feat:none` |
| Die Generatoren des `sheriff-blueprint`-Packages erzeugen das Sheriff-Layout (Ordner statt Libs). `@nx/angular:library` erzeugt `project.json`, `tsconfig*.json`, `ng-package.json` usw., `@nx/angular:component` findet inferierte Projekte nicht | eigene Generatoren in `packages/tooling` (domain, layer, feat, testing, move, rename, remove, component, service, store), siehe [Tooling & Generatoren](#tooling--generatoren) |

## Paket `packages/sheriff-blueprint`

> **Veraltet auf diesem Branch.** Die Generatoren `@berger-engineering/sheriff-blueprint:domain|feat|shared-feature` erzeugen das Sheriff-Layout (Ordner in einer Lib, `project.json`, Wildcard-Alias `@blueprint/domains/<d>/*`) und passen nicht zu den Libs ohne Config-Dateien. Stattdessen `@blueprint/tooling-workspace` / `@blueprint/tooling-openapi` benutzen, siehe [Tooling & Generatoren](#tooling--generatoren).

Das Paket bleibt unverändert, samt `createSheriffConfig`, `nxModuleBoundariesOptions` und Generatoren. In diesem Workspace wird es aber nicht mehr benutzt: `sheriff.config.ts` und `@softarc/eslint-plugin-sheriff` sind entfernt. Die e2e-Specs laufen nur, wenn es im Workspace eine `sheriff.config.ts` gibt (`describe.skipIf`). Unit- und Generator-Tests laufen weiter, seit dem Testing-Umbau auf Vitest 4 (23 passed, 6 skipped).

## Testing & MSW

Unit- und Komponententests laufen **nur im Vitest Browser Mode** (Chromium headless über Playwright), kein jsdom. HTTP mockt [MSW](https://mswjs.io/docs/recipes/vitest-browser-mode/) per Service Worker: Die echte `BookingApi`/`ApiHttp` ruft `fetch`, MSW beantwortet den Request im Browser.

### Struktur

```
libs/shared/testing/          scope:shared  type:testing  feat:none   kein build-Target
  src/network.ts                `worker` (setupWorker aus msw/browser) + `test` mit Auto-Fixture `worker` (+ `faker.seed(FAKER_SEED)` pro Test)
libs/<domain>/testing/        scope:<domain> type:testing feat:none   kein build-Target
  src/fixtures/                 Builder: aBooking(), aCheckinDto()
  src/handlers/                 <domain>Handlers (Normalfall), <domain>Scenarios (empty, serverError, with…)
vitest-base.config.mts        runnerConfig: msw-Prebundle-Fix, Browser-Conditions (msw 3); Worker serviert Vitest selbst
```

- Domain-Testing-Libs importieren nur `msw` (nicht `msw/browser`), `type:types` und `shared/testing`. Deshalb liegt `CheckinDto` jetzt in `checkin/types` statt in `checkin/api`.
- `test`-Target inferiert das Plugin für jede Lib, deren `src/` eine `*.spec.ts` enthält (heute `booking-api`, `booking-data`, `checkin-api`, `checkin-data`, `checkin-feat-checkin-feature`, `shared-api`). Executor `@blueprint/tooling-ng-lib:test` (Wrapper um `@nx/angular:unit-test`), `browsers: ["chromiumHeadless"]`, `runnerConfig: vitest-base.config.mts`, `tsConfig: libs/tsconfig.spec.json`, `watch: false`. Keine Datei pro Lib, siehe [Libs ohne Config-Dateien](#libs-ohne-config-dateien).
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
- Ohne `beforeEach` gibt es keine Handler. Ein nicht gemockter Request wird von MSW geloggt und mit 500 beantwortet, der Test wird rot (`booking-api.spec.ts` prüft genau das).
- Komponententest `feat-checkin.spec.ts`: rendert `FeatCheckin` per TestBed in Chromium, klickt über `page` aus `vitest/browser` und prüft das DOM (`expect.element`). Die Buchungen kommen dabei cross-domain aus `@blueprint/booking/testing`.
- Mutationsproben: `beforeEach` mit den Default-Handlern in `booking.store.spec.ts` entfernt → `booking-data:test` rot (1 failed, `[MSW] Error: intercepted a request without a matching request handler`). Override gewinnt: die Tests mit `worker.use(...)` laufen trotz aktiver Defaults grün (`serverError` → 500, `withBookings` → nur `b-1`).

### Schutzschichten gegen Production-Leaks

| # | Schicht | Wo | Geprüft durch |
|---|---|---|---|
| 1 | depConstraints: Produktions-Layer kennen `type:testing` nicht, `type:feature`/`type:app` ohne Glob; `type:testing` → nur types, testing, shared | `eslint.config.mjs` | `nx lint`, verify-Fälle `testing: …` |
| 1b | Spec-Override (`*.spec.ts`, `*.test.ts`, `test-setup.ts`): dieselben Constraints + `type:testing`, auch fremde Domain. `scope:shared` und `type:types` bleiben unverändert | `eslint.config.mjs` → `specDepConstraints` | verify (`allowedInSpec`/`blockedInSpec`) |
| 2 | `bannedExternalImports` msw, vitest, @vitest, @testing-library, playwright, openapi-msw, @faker-js in Produktions-Layern + App | `eslint.config.mjs` | verify |
| 3 | Testing-Libs ohne `build`-Target (Plugin: Ordner `testing` → `type:testing`, kein `build`). Import aus Produktionscode scheitert zusätzlich an `enforceBuildableLibDependency`, im Spec-Override ist die Regel aus | Plugin, Spec-Override | verify (Test-Isolation aus dem Graph + Fälle) |
| 4 | Die Build-tsconfig (`build.options.tsConfig` = `libs/tsconfig.lib.json`) schließt `**/*.spec.ts` aus, `build`-Inputs sind `production`, `production` schließt `**/*.spec.ts` aus, `peerDependencies` nur aus Produktionscode | `libs/tsconfig.lib.json`, Plugin, `nx.json`, `packages/tooling/ng-lib/src/build.js` | verify (Test-Isolation liest Targets aus dem Graph) |
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

`@nx/angular:unit-test` (Nx 23.1) ist **kein anderer Runner**. Es ist ein dünner Wrapper, der `executeUnitTestBuilder` aus `@angular/build` aufruft. Vorher mappt er `@nx/angular:ng-packagr-lite` → `@angular/build:ng-packagr` im Builder-Context. Vitest, Browser-Provider, TestBed-Init und `runnerConfig` bleiben also Angulars Builder. Der Fallback `@nx/vitest` + `@analogjs/vitest-angular` war damit nicht nötig. Seit den Libs ohne Config-Dateien steckt `@nx/angular:unit-test` hinter `@blueprint/tooling-ng-lib:test`, weil das Lib-Build-Target jetzt `@blueprint/tooling-ng-lib:build` ist (siehe [Executor-Wrapper](#executor-wrapper-packagestoolingng-lib)).

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

1. Erzeugt `libs/<d>/testing/src/fixtures/<d>.fixture.ts` (Builder `a<D>()`), `src/handlers/<d>.handlers.ts` (`<d>Handlers`, `<d>Scenarios`: `withItems`, `empty`, `serverError`) und `src/index.ts`. Das Plugin macht daraus `<d>-testing` mit `scope:<d>`, `type:testing`, `feat:none`, Targets `lint` + `typecheck`, **kein** `build`. Alias `@blueprint/<d>/testing` aus dem Wildcard-Pfad.
2. Importiert nur `msw`, `@blueprint/<d>/types` und `@blueprint/shared/testing`. Exportiert `<d>/types` kein `<D>`, deklariert die Fixture die Backend-Form selbst (Hinweis im Kommentar: nach `<d>/types` verschieben).
3. Specs: `*.spec.ts` in `src/` einer Lib ablegen, das `test`-Target entsteht automatisch. Vorlage: `libs/<d>/data/src/<d>.store.spec.ts` aus dem Domain-Generator.
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
  api/src/generated/**     type:api        Services
  core/src/generated/**    type:api        Runtime (Configuration, BASE_PATH, provideApi …, importiert HTTP)
  testing/src/generated/** type:testing    eigenes generate: openapi-typescript + orval (msw, faker) + openapi-msw
        ▼
 Port (booking/api, checkin/api) bzw. shared/api ── mappt DTO → Modell, Promise statt Observable ──▶ Konsumenten
```

| Datei | Aufgabe |
|---|---|
| `packages/tooling/openapi/src/facade/contract.d.ts` | Vertrag `ClientDefinition`, `GeneratorAdapter` (`generate`, `classify`), `Classification`, `AdapterRegistration` |
| `…/openapi/facade.mjs`, `split.mjs`, `barrel.mjs` | `resolveClient` (Eintrag + Ordner → Definition), `generateClient`, `updateSpec`, Aufteilen, Barrel, Header |
| `…/openapi/adapters/*.mjs`, `registry.json` | 3 Adapter, Registry mit Cache-Inputs je Adapter (Pakete, `openapitools.json`, `java -version`) |
| `…/openapi/testing/testing.mjs` | Testing-Lib aus der Spec |
| `…/executors/openapi/*` | `openapi-generate`, `openapi-generate-testing`, `openapi-update-spec` (Option nur `client`) |
| `…/plugin/openapi-clients.ts`, `blueprint-libs.ts`, `lib-conventions.ts` | Client-Projekte, Kanten, Tags, Pfad-Konvention |
| `…/generators/client`, `…/generators/shared/clients.ts` | Generator `client`, Pflege von `openapi-clients.json` in `move`/`rename`/`remove` |
| `openapitools.json` | Jar-Version 7.25.0, `storageDir: ./node_modules/.cache/openapi-generator-cli` |

### Ablage, Projekte, Tags

```
libs/generated/<client>/                   scope:shared    Client-Projekt generated-<client> (nur Targets, kein Code, kein Alias)
libs/<domain>/generated/<client>/          scope:<domain>  Client-Projekt <domain>-generated-<client>
  openapi.yaml|json                        committet
  types/src/index.ts     → Lib …-types     scope:<s> type:types   feat:none generated
  api/src/index.ts       → Lib …-api       scope:<s> type:api     feat:none generated   (kein port)
  core/src/index.ts      → Lib …-core      scope:<s> type:api     feat:none generated
  testing/src/index.ts   → Lib …-testing   scope:<s> type:testing feat:none generated   (kein build)
  <teil>/src/generated/**                  gitignored (.gitignore: **/src/generated/**)
```

- **`generated` ist ein reservierter Ordner**, kein Scope und kein Layer. `libs/generated/…` gehört zu `shared`, die Scope-Liste bleibt unverändert. `domain generated` wird abgelehnt, ein falscher Pfad (`libs/generated/x/ui`) bricht den Graph ab.
- **Kein `port`:** Ein generierter Client ist nie die öffentliche API eines Slices. Fremde Domains kommen nur über den Port an `booking/generated/**`.
- **`core` ist `type:api`**, weil die Runtime `@angular/common/http` importiert (in `utils` verboten).
- `type:types` → `type:types` gilt (Domain-Types dürfen generierte Models nutzen). `data`/`feature` dürfen generierte Services laut Matrix direkt nutzen, Konvention bleibt „über den Port“.
- **Kein Pflicht-Wrapper für shared Clients:** der Domain-Port ist der Wrapper (`BookingNotifications`, `CheckinNotifications`), für den pet-client ist es `PetApi` in `shared/api`.
- Config-Wächter: `openapi.(yaml|json)` ist nur im Client-Ordner erlaubt, an jeder anderen Stelle in `libs/` meldet `tooling-verify:verify` sie als Config-Datei.

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

Das Plugin `@blueprint/tooling-openapi` (zweiter Eintrag in `nx.json` → `plugins`, eigenes `createNodesV2`) liest die Datei und erzeugt pro Eintrag ein Client-Projekt. Die Teil-Libs inferiert `@blueprint/tooling-workspace` wie jede Lib; das OpenAPI-Plugin ergänzt dieselben Roots um Kanten und das `generate` der Testing-Lib (Nx mischt beide Ergebnisse, `dependsOn: ['generate', '...']`). Eintrag, Ordner und Spec müssen zusammenpassen: Eintrag ohne Spec, Teil-Lib ohne Eintrag, unbekannter Adapter oder Scope außerhalb der Scope-Liste brechen den Graph mit Hinweis ab. `tooling-verify:verify` prüft zusätzlich die Gegenrichtung (Client-Ordner ohne Eintrag) und dass die vier `index.ts` genau `export * from './generated';` enthalten.

**Warum eine eigene Datei statt `nx.json`:** Jede Änderung an `nx.json` invalidiert den ganzen Cache (Spike S1, belegt).

**Warum der Eintrag kein Target-Option ist:** Nx hasht in `^default`/`^production` die `ProjectConfiguration` jeder Abhängigkeit mit (Hash-Plan von `shared-api:typecheck` enthält `generated-pet-client:ProjectConfiguration`). Stünde der Eintrag in den `options` von `generate`, liefe nach jeder Eintragsänderung alles neu, was vom Client abhängt, auch wenn der generierte Code gleich bleibt. Deshalb:

- Target-Optionen sind nur `{ "client": "<pfad>" }`, die Executoren lesen den Eintrag zur Laufzeit (`resolveClient`).
- Der Eintrag ist ein **`json`-Input** von `generate`: `{ "json": "{workspaceRoot}/openapi-clients.json", "fields": ["defaultAdapter", "clients.<pfad>"] }`.
- `update-spec` gibt es für jeden Client (ohne `url` bricht es ab), damit eine neue `url` die Projekt-Config nicht ändert.
- Ein Adapterwechsel ändert die Inputs (`externalDependencies` des Adapters) und damit die Projekt-Config. Die Abhängigen laufen dann neu, was sie wegen des neuen Codes ohnehin müssten.

**Cache-Probe** (eigener Cache, `run-many -t build lint test typecheck generate`, 155 Tasks, Ausgangslage 153/155 aus dem Cache; die 2 übrigen sind `sheriff-blueprint:build/test` ohne Cache):

| Änderung | neu gelaufen |
|---|---|
| pet-client: `"options": { "providedIn": "root" }` (= Default, gleicher Code) | nur `generated-pet-client:generate` (152/155) |
| notification-client: `url` ergänzt | nur `generated-notification-client:generate` (152/155) |
| pet-client: `"options": { "enumPropertyNaming": "original" }` (anderer Code) | pet-client (generate, Teile, testing), `shared-api` und dessen Abhängige (`checkin-api`, `checkin-data`, `checkin-feat-*`, `checkin-shell`); booking, notification, layout, auth aus dem Cache (116/155) |
| booking-client-Spec: `description` am Schema | booking-client, booking-Libs, `checkin-feat-*`, `checkin-shell`, `client:build` (106/155) |
| zurück | 153/155 |

Vor dem Umbau auf den `json`-Input liefen im ersten Fall 41 Tasks neu (`shared-api`, `checkin-*`, `client:build` …), obwohl der generierte Code byte-gleich war.

### Targets und Abhängigkeiten

| Projekt | Target | Konfiguration |
|---|---|---|
| Client | `generate` | `@blueprint/tooling-openapi:generate`, gecacht. Inputs: Spec, eigener Eintrag (`json`-Input), die drei `index.ts`, Facade-Code (ohne `testing/`), Executoren, Adapter-Inputs aus `registry.json` (`externalDependencies` der Adapter-Pakete + `typescript`, `yaml`; bei Java-Adaptern `openapitools.json` und Runtime `java -version 2>&1`). Outputs: `{types,api,core}/src/generated` |
| Client | `update-spec` | `@blueprint/tooling-openapi:update-spec`, nicht gecacht: lädt die `url`, schreibt YAML/JSON normalisiert (danach Prettier wie `formatFiles`) |
| `…/testing` | `generate` | `@blueprint/tooling-openapi:generate-testing`, gecacht. Inputs: Spec, Testing-Pipeline, `openapi-typescript`, `orval`, `yaml`. Output `src/generated`. `lint`/`typecheck` hängen zusätzlich an `generate` |
| jede Lib | `lint`, `typecheck`, `build`, `test` | `dependsOn: ['^generate']` (build: `['^build', '^generate']`), Input `{ dependentTasksOutputFiles: '**/src/generated/**/*.ts', transitive: true }` |
| Teil-Lib | `implicitDependencies` | Client-Projekt; `api` → `core`, `types`; `core` → `types` |
| `client:build` | Input (`targetDefaults`) | ebenfalls `dependentTasksOutputFiles` (die App bündelt die Libs aus `dist`) |

- **Gitignored = für Nx unsichtbar.** Nx hasht keine gitignored Dateien und analysiert ihre Imports nicht. Deshalb der `dependentTasksOutputFiles`-Input (sonst kämen Konsumenten nach einer Spec-Änderung aus einem veralteten Cache) und die impliziten Kanten (sonst kein `affected` und keine Build-Reihenfolge). Beleg: Property `guestName` in der booking-Spec umbenannt → `booking-api:typecheck` rot; `description` ergänzt → auch `client:build` läuft neu (vor dem Fix blieb es im Cache).
- `^generate` reicht über den ganzen Graph: `nx run booking-data:typecheck` generiert vorher den booking-client. Specs, die eine Testing-Lib importieren, sind Graph-Kanten, `^generate` erzeugt also auch die Testing-Libs.
- **`nx affected`**: Spec-Änderung → Client, Teile, Port, Konsumenten, App (per impliziter Kante). Eine Änderung an `openapi-clients.json` gehört keinem Projekt; sie ist Input von `update-spec` (nicht gecacht, also nur für `affected`) → alle Clients + Abhängige. Der Cache von `generate` bleibt pro Eintrag.
- **IDE:** `pnpm openapi:generate` (= `nx run-many -t generate`) nach dem Checkout, sonst meldet die IDE `Cannot find module './generated'`. Kein `postinstall`: `pnpm install` bräuchte dann Java und Netz. Build, Lint, Typecheck und Test generieren selbst.
- Deterministisch: zweimal `generate --skip-nx-cache` ergibt byte-gleiche Dateien, die dist der Client-Libs steht im Snapshot von `verify:nx-internals`.

### Generator `client`

```sh
nx g @blueprint/tooling-openapi:client <name> [--domain=<d>] --spec=<datei|url> [--url=<url>] [--adapter=openapi-tools|hey-api|nx-plugin-openapi]
```

- legt `libs/[<d>/]generated/<name>/` an: Spec (Datei unverändert als `openapi.yaml|json`; URL einmal geladen und wie `update-spec` normalisiert), `types|api|core|testing/src/index.ts`, Eintrag in `openapi-clients.json` (`url` = `--url` oder die Spec-URL; `adapter` nur, wenn er vom `defaultAdapter` abweicht)
- prüft: kebab-case, Domain existiert, Client neu, OpenAPI 3.x mit mindestens einem Pfad, Adapter bekannt
- `move`/`rename`: Eintrag wird mitgezogen (auch beim Verschieben einer ganzen Domain), Aliase umgeschrieben, bei `rename` auch die generierten Testing-Namen (`demoClientHttp` → `thingClientHttp`). `remove`: Eintrag raus, bricht ab, solange Code den Client importiert. Ein `remove` direkt nach `client` stellt den Ausgangszustand exakt wieder her (Spec im Tooling-Test)
- `component`/`service`/`store` lehnen generierte Libs ab

### Adapter

| | openapi-tools (Default) | hey-api | nx-plugin-openapi |
|---|---|---|---|
| Paket | `@openapitools/openapi-generator-cli` 2.41.0 + Jar 7.25.0 | `@hey-api/openapi-ts` **0.83.1** (gepinnt) | `@nx-plugin-openapi/core`, `plugin-openapi`, `plugin-hey-api` 1.0.0, Backend über `options.plugin` |
| Java | ja (JRE 11+, CI: Temurin 17). Jar-Download beim ersten `generate` nach `node_modules/.cache/openapi-generator-cli` | nein | je nach Backend |
| Ausgabe → Teile | `model/*` → types, `api/*` → api, Root-Dateien → core; verworfen `index.ts`, `api.module.ts` | `types.gen.ts` → types, `sdk.gen.ts` + `@angular/**` → api, `client.gen.ts`, `client/**`, `core/**` → core | wie das Backend |
| Service-API | `BookingsService.listBookings(): Observable<Booking[]>`, `providedIn: 'root'`, `provideApi()` | `listBookings({ httpClient }): Promise<{ data, error, response }>` | wie das Backend |
| Models | `interface` + `namespace` (Enums als `const … as const`) | `type` mit Literal-Unions | wie das Backend |

**Tausch-Beweis** am booking-client (Eintrag in `openapi-clients.json` + Port, `run-many -t build lint test typecheck`, 50 Projekte):

| Eintrag | Dateien types/api/core | Port | Ergebnis |
|---|---|---|---|
| `{}` (openapi-tools) | 3/2/7 | Variante A | grün |
| `{ "adapter": "hey-api" }` | 1/3/12 | Variante B | grün |
| `{ "adapter": "nx-plugin-openapi", "options": { "plugin": "hey-api" } }` | 1/3/12 | Variante B | grün |
| `{ "adapter": "nx-plugin-openapi" }` (Backend openapi-tools) | 3/2/7 | Variante A | grün |

`git status` zeigte jeweils nur `openapi-clients.json` und `libs/booking/api/src/booking-api.ts`. Alle Konsumenten (data, feature, checkin, Tests, MSW-Handler) blieben unverändert:

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
| `libs/generated/pet-client` (shared) | Petstore 3, `update-spec` von `https://petstore3.swagger.io/api/v3/openapi.json` | `PetApi` in `shared/api` (`availablePets()`) | `shared/api/src/pet-api.spec.ts`: generierte Handler + Seed, typisiertes Szenario (`status=available`), dokumentierter 400 |
| `libs/generated/notification-client` (shared) | selbst geschrieben: `GET /notifications?topic=`, `POST /notifications/{id}/read` | Ports `BookingNotifications` (`booking/api`) und `CheckinNotifications` (`checkin/api`), Modelle in `booking/types`, `checkin/types` | je 4 Tests: Default-Handler, Topic-Filter per `notificationClientHttp` mit generierter Factory, `markRead`, 404 |
| `libs/booking/generated/booking-client` (booking) | selbst geschrieben: `GET /bookings` (Model wie `booking/types`, `default`-Fehler) | `BookingApi` (Port) | `booking-api.spec.ts` (unbehandelter Request, generierte Handler), `booking.store.spec.ts` und `feat-checkin.spec.ts` über die typisierten `bookingHandlers`/`bookingScenarios` |

`HttpClient`: Angular 22 stellt ihn `providedIn: 'root'` mit `FetchBackend` bereit, MSW sieht die Requests ohne Provider im Test. In der App steht `provideHttpClient(withFetch())` explizit. Ein beim TestBed-Reset abgebrochener Request endet ohne Wert, die Ports behandeln das als „nichts geladen“ (`defaultValue: []`).

### CI

`.github/workflows/ci.yml`: `actions/setup-java@v4` (Temurin 17) und `actions/cache@v4` für `node_modules/.cache/openapi-generator-cli` (Key: Hash von `openapitools.json`), sonst unverändert. `generate` läuft über `^generate` in `run-many`/`affected` mit. `update-spec` läuft nur manuell (`nx run <client>:update-spec`), das Ergebnis kommt per normalem PR.

### Verify

`tooling-verify:verify`: 134 Fälle, davon 46 für generierte Clients:

| Fälle | erwartet |
|---|---|
| Port → eigener Client (api, types, core), Port/`shared/api` → shared Client | erlaubt |
| fremde Domain (api, types, feat-data) → `booking/generated/**`, shared → Domain-Client | blockiert (`scope:checkin`, `scope:shared`) |
| ui → Client api/core (Domain + shared), utils → api, Domain-types → api, app → Domain-Client, Deep-Import | blockiert |
| ui → Client types, data/feature → Client api (Matrix), types → types | erlaubt |
| Produktion/App → Client-testing, testing → Client api, fremdes testing → Domain-Client-testing, `openapi-msw`/`@faker-js/faker` in Produktion | blockiert |
| Spec → eigenes/shared Client-testing, Domain-testing → eigenes Client-testing | erlaubt; shared-Spec → Domain-Client-testing blockiert |
| aus generiertem Code (mit Header): types → api/core desselben Clients, types → `@angular/core`, shared → Domain-Client, api → data/events, Deep-Import, testing → api | blockiert; api → core, api/core → `@angular/common/http`, testing → `openapi-msw` erlaubt |

Dazu der Check „Generierte Clients“: Eintrag ↔ Ordner ↔ eine Spec ↔ vier Libs, `index.ts`-Inhalt, `generate`-Optionen nur `{ client }` + `json`-Input, `update-spec` vorhanden, Kante Teil → Client, `^generate` + `dependentTasksOutputFiles` an jedem Lib-Target und an `client:build`, Testing-`generate` gecacht und vor `lint`/`typecheck`, nichts unter `src/generated/` committet, alles gitignored.

### Limitierungen

| Limitierung | Umgang |
|---|---|
| Gitignored Code ist für Nx unsichtbar (Hash, Kanten, `peerDependencies` der dist) | `dependentTasksOutputFiles` + implizite Kanten, im Verify geprüft. `peerDependencies` der Client-dist bleiben leer (harmlos, `private`) |
| Adapterwechsel ändert die Projekt-Config des Clients | Abhängige laufen neu, was sie für den neuen Code ohnehin müssen |
| `nx affected` sieht eine Änderung an `openapi-clients.json` für alle Clients, nicht nur den geänderten | nur `affected`; der Cache von `generate` ist pro Eintrag |
| openapi-tools braucht Java und beim ersten `generate` Netz (Jar) | CI: setup-java + Cache; lokal JRE 11+. hey-api braucht beides nicht |
| hey-api 0.83 statt aktuell (ab 0.96 Node ≥ 22.13, ab 0.98 ≥ 22.18) | bei Node ≥ 22.18 anheben, Klassifizierung prüfen |
| orval 8.38 verlangt laut `engines` Node ≥ 22.18, läuft aber lokal unter 22.16 | CI nutzt Node 22 aktuell; bei Problemen Node anheben |
| `nx-plugin-openapi` bringt `@nx/devkit` 19 mit | `peerDependencyRules` (`@nx/devkit>nx: 23`), funktional ok |
| `formatFiles` von Nx ignoriert `.prettierignore` (übergibt kein `ignorePath`) | Specs und `openapi-clients.json` sind Prettier-formatiert, `update-spec` formatiert genauso nach |
| `type:testing` → `scope:shared` erlaubt auch shared Client-api in Testing-Libs | bestehende Regel (für `shared/testing`), nicht verschärft |
| `data`/`feature` dürfen generierte Services laut Matrix nutzen | Konvention „über den Port“, bewusst so gelassen |

## Tooling & Generatoren

Das Werkzeug liegt in **`packages/tooling`**, aufgeteilt in fünf Nx-Libs (je eigenes Projekt und Workspace-Paket, `type:tooling` + `tooling:<lib>`). Details, Optionen und Begründungen: [`packages/tooling/README.md`](../packages/tooling/README.md) und die README jeder Lib.

| Lib (Paket) | Inhalt |
|---|---|
| `conventions` (`@blueprint/tooling-conventions`) | Pfad → Name/Tags/Alias, `generated`, Client-Pfade, Scope-Liste, Tree-Helfer, Spec-Fixture |
| `workspace` (`@blueprint/tooling-workspace`) | Crystal-Plugin der Libs + Scope-Liste (`nx.json` → `plugins[@blueprint/tooling-workspace].options.scopes`), Generatoren, Sync-Generator `app-routes` (`nx.json` → `sync.globalGenerators`) |
| `openapi` (`@blueprint/tooling-openapi`) | Plugin für `openapi-clients.json` (eigenes `createNodesV2`), Facade, Adapter, Testing-Pipeline, Executoren `generate`/`generate-testing`/`update-spec`, Generator `client` |
| `ng-lib` (`@blueprint/tooling-ng-lib`) | Executoren `build`, `application`, `test`, Skript `typecheck-lib` |
| `verify` (`@blueprint/tooling-verify`) | `verify` (Nx-Target `tooling-verify:verify`, gecacht), `verify:nx-internals`, dist-Snapshot |

Abhängigkeiten (Paket-Imports, `depConstraints` + 17 Verify-Fälle, zyklenfrei): `openapi` → `conventions`; `workspace` → `conventions`, `openapi` (move/remove pflegen `openapi-clients.json`), `ng-lib` (Executoren der Targets); `conventions`, `ng-lib`, `verify` → nichts.

**Kein Build-Schritt:** Nx lädt Plugins und Generatoren als TypeScript (eigener swc-Transpiler), aufgelöst über die Workspace-Links in der Root-`package.json` (`@blueprint/tooling-workspace`, `-openapi`, `-ng-lib`) und in den `package.json` der Libs. Weil der swc-Transpiler die `paths` der `tsconfig.base.json` anwendet und der Lib-Wildcard `@blueprint/*` sonst `@blueprint/tooling-…` nach `libs/` umbiegen würde, hat jeder importierte Tooling-Export dort einen exakten Eintrag (`verify` prüft `exports` ↔ `paths`). Kein veraltetes `dist/`, keine Henne-Ei-Frage beim Graph. Preis: in den Plugins nur `import type` aus `@nx/devkit`.

### Anleitungen

```sh
# neue Domain: types, api, data, ui, shell + testing + Beispiel-Spec, Lazy-Route in app.routes.ts, Scope in nx.json
nx g @blueprint/tooling-workspace:domain payment
# neue Lib in bestehender Domain (Layer-Liste aus dem Plugin)
nx g @blueprint/tooling-workspace:layer payment events
# neues Feat: feature-Container + optional api (feat-port), data, ui; Lazy-Route in den Shell-Routes
nx g @blueprint/tooling-workspace:feat payment checkout --api --data
# testing-Gerüst für eine bestehende Domain
nx g @blueprint/tooling-workspace:testing checkin
# generierter OpenAPI-Client (shared oder --domain), Spec als Datei oder URL
nx g @blueprint/tooling-openapi:client weather-client --spec=https://example.org/openapi.json
nx g @blueprint/tooling-openapi:client billing-client --domain=booking --spec=./specs/billing.yaml --adapter=hey-api
# verschieben / umbenennen (Importe inkl. import() in Routes, Route-Pfade, Scope-Liste)
nx g @blueprint/tooling-workspace:move booking/feat-rebook checkin/feat-rebook
nx g @blueprint/tooling-workspace:rename payment billing
# löschen (bricht bei Importen ab, außer --force; Routen + Scope raus)
nx g @blueprint/tooling-workspace:remove billing
# Komponente / Service / Store in einer Lib
nx g @blueprint/tooling-workspace:component libs/booking/ui/src/booking-badge
```

`@nx/angular:component` & Co. funktionieren hier nicht (getestet: *„does not exist under any project root“*, *„Project "booking-data" does not exist“*), weil sie das Projekt im Tree über `project.json` suchen. Deshalb die dünnen Wrapper `component`, `service`, `store`.

### Wächter

- **Scope-Liste:** unbekannter Scope-Ordner → Graph-Fehler mit Vorschlag. `domain`, `move`/`rename`, `remove` pflegen die Liste, `verify` meldet Einträge ohne Lib.
- **Config-Dateien:** `tooling-verify:verify` meldet jede `project.json`, `package.json`, `tsconfig*.json`, `ng-package.json`, `eslint.config.*` unter `libs/**` außerhalb von `src/` (Ausnahme `libs/tsconfig*.json`).
- **Routen:** `nx sync:check` (globaler Sync-Generator `@blueprint/tooling-workspace:app-routes`): jede Slice-Shell mit `Routes` ist in `app.routes.ts` registriert, keine Lazy-Route zeigt auf eine fehlende Lib. `nx sync` repariert.

### CI

`.github/workflows/ci.yml` (Push auf `main`/`feat/nx-blueprint`, PRs): `pnpm install --frozen-lockfile`, Java 17 (Temurin) + Jar-Cache für openapi-tools, `playwright install --with-deps chromium`, `nx sync:check`, dann bei PRs `nx affected -t build lint test typecheck` (Basis per `nrwl/nx-set-shas`), bei Pushes `run-many`, zuletzt `nx run tooling-verify:verify`. Einen Tooling-Fallback („bei Tooling-Änderung alles“) gibt es seit dem Split nicht mehr: jede Tooling-Datei, die eine Lib-Task nutzt, ist `{workspaceRoot}`-Input dieser Task, `affected` folgt Inputs (ng-lib → alle Libs mit build/test + App, Plugins/Konventionen → alle Libs, Facade → Clients + Abhängige, Generatoren → nur `tooling-workspace`). `verify` probt das für jeden Bereich (`nx show projects --affected --files=…`). Vorher meldete `affected` bei jeder Lib-Änderung auch `tooling` (Input von `verify`), die CI lief also im PR praktisch immer komplett.

### Nach `nx migrate`

`pnpm verify:nx-internals` vor dem Commit der Migration (und nach Angular-Updates): run-many mit `--skip-nx-cache` in frisches `dist/`, dist-Äquivalenz gegen `packages/tooling/verify/nx-internals/dist-hashes.json` (oder `--reference <kopie-von-dist-vorher>`), Marker-Test „App baut gegen dist“, MSW-Probe „fehlender Handler → Test rot“, MSW-Worker „von Vitest aus dem msw-Paket serviert“, `tooling-verify:verify`. Ändert das Update den Output bewusst: Unterschiede prüfen, dann `--update-snapshot`.

## Verifikation

```sh
pnpm exec nx run-many -t build lint test typecheck   # 54 Projekte, 157 Tasks + 6 generate grün (build 43, lint 54, typecheck 50, test 10)
pnpm verify                                           # nx run tooling-verify:verify: 134/134 Fälle + Config-Wächter + Tag-Schema/Scope-Liste + Test-Isolation + neue Lib + generierte Clients + client-Bundle
pnpm exec nx sync:check                               # app.routes.ts ↔ Slice-Shells
pnpm exec nx run tooling-openapi:test-integration    # OpenAPI-Lib: echte Adapter, msw, tsc, nx im Fixture-Workspace; Coverage ≥ 95 %
pnpm verify:nx-internals                              # nach nx migrate, siehe Tooling & Generatoren
```

Beweise für „Libs ohne Config-Dateien“ (tatsächlich ausgeführt, eigener Nx-Cache):

- `find libs -mindepth 2 -name '*.json' -not -path '*/src/*' -not -path '*/public/*'` → leer, nur `libs/tsconfig*.json` (Tiefe 1).
- `run-many` mit `--skip-nx-cache`: 111 Tasks grün, dieselben wie vorher; Tests 1+3+3+3 Browser + 23 `sheriff-blueprint` (6 skipped).
- `dist` (32 Libs + App, 346 Dateien) per `diff -r` identisch zum Stand `2857237`. Seit den OpenAPI-Clients 580 Dateien: +12 Client-Libs (dist der generierten types/api/core), geändert nur `booking/api`, `booking/types`, `checkin/api`, `checkin/types`, `shared/api` (neue Ports/Modelle) und die App-Chunks; alle anderen Libs byte-gleich. Snapshot bewusst per `--update-snapshot` erneuert, ein frischer Clone baut exakt diese 580 Dateien.
- App baut gegen dist: Text `Bookings` in `dist/libs/layout/ui/esm2022/nav-bar.js` durch einen Marker ersetzt, `nx run client:build --skip-nx-cache --exclude-task-dependencies` → Marker im App-Bundle (`main-*.js`), in den Quellen nicht vorhanden.
- Plain `eslint` mit leerem `NX_WORKSPACE_DATA_DIRECTORY` auf einem Verstoß in `booking/ui` (`→ @blueprint/booking/data`) → Fehler `type:ui`, Exit 1.
- MSW: Default-Handler (`beforeEach`) in `booking.store.spec.ts` entfernt → `booking-data:test` rot.
- Folgelauf ohne `--skip-nx-cache`: 109/111 aus dem Cache (die 2 übrigen: `sheriff-blueprint:build/test`, dort ohne `cache`, wie vorher).

Die 4 Lint-Warnungen in `sheriff-blueprint` (`no-non-null-assertion` in Tests) gab es schon vorher. Baseline vor dem Umbau: alles grün. `client:lint` scheiterte nur flaky, weil die Sheriff-e2e-Specs parallel temporäre Dateien in `apps/client` schrieben.

`packages/tooling/verify/scripts/verify-boundaries.mjs` lintet für jeden Fall eine virtuelle Datei (`ESLint#lintText` mit `filePath` in der echten Lib) gegen die echte Config. Mutationsprobe: `type:ui` testweise `type:data` erlaubt → Fall „ui -> data“ rot, Exit 1.

| Regel | erwartet | Ergebnis |
|---|---|---|
| layer: ui → data / ui → api | blockiert | ✅ `type:ui` |
| layer: utils → api (shared) | blockiert | ✅ `type:utils` |
| layer: types → types (eigener Scope, shared) | erlaubt | ✅ |
| layer: types → utils | blockiert | ✅ `type:types` |
| layer: types → fremde Domain-types, shared types → Domain-types | blockiert | ✅ `scope:<s>` / `scope:shared` |
| layer: events → data / api → data | blockiert | ✅ als Zyklus; ohne Zyklus `type:events`/`type:api` |
| layer: data → ui | blockiert | ✅ `type:data` |
| layer: ui → events, data → api, feature → ui | erlaubt | ✅ |
| scope: fremde Domain-Interna / Shared-Feature-Interna / fremder entry | blockiert | ✅ `scope:<s>` |
| scope: fremde Domain / Shared-Feature via port | erlaubt | ✅ |
| scope: shared → Domain | blockiert | ✅ `scope:shared` |
| scope: Domain → shared | erlaubt | ✅ |
| feat: Geschwister-Interna / Geschwister-Container | blockiert | ✅ `feat:<f>` |
| feat: Geschwister via feat-port, eigene Interna, Domain-shared | erlaubt | ✅ |
| feat: fremder feat-port (andere Domain) | blockiert | ✅ `scope:<s>` |
| app: Shell → ui / data | blockiert | ✅ `type:app` |
| app: Shell → entry / port | erlaubt | ✅ |
| app: statischer Import einer lazy entry | blockiert | ✅ lazy-loaded |
| app: Lib → App | blockiert | ✅ relative/absolute Import |
| encapsulation: relativ in fremde Lib / Deep-Alias | blockiert | ✅ Nx-Builtin / `no-restricted-imports` |
| nx: HTTP außerhalb api / types → `@angular/core` | blockiert | ✅ `bannedExternalImports` |
| nx: HTTP in api | erlaubt | ✅ |
| nx: Zyklus data ↔ feat-data | blockiert | ✅ Circular |
| nx: Lib ohne Tags | blockiert | ✅ `without tags` |
| testing: Produktion → testing (Lib / Feature / App) | blockiert | ✅ non-buildable bzw. `type:app`; nur Tags: `type:data`/`type:feature` |
| testing: Spec → eigenes / fremdes Domain-testing / shared/testing | erlaubt | ✅ |
| testing: shared-Spec → Domain-testing, types-Spec → testing, Spec ui → data | blockiert | ✅ `scope:shared` / Circular / `type:ui` |
| testing: testing → data (mit/ohne Zyklus), → api, → fremdes testing | blockiert | ✅ Circular / `type:testing` / `scope:<s>` |
| testing: testing → types / shared/testing | erlaubt | ✅ |
| testing: msw, msw/browser, vitest, @vitest/* in Produktion/App | blockiert | ✅ `bannedExternalImports` |
| testing: msw in testing-Lib / Spec | erlaubt | ✅ |
| neue Lib (nur `src/index.ts`, `booking/feat-tmpverify/ui`): ui → api, → fremdes Feat, Geschwister-Feat → neue Lib, fremder Slice → neue Lib, Deep-Alias | blockiert | ✅ `type:ui` / `feat:tmpverify` / `feat:check-booking` / `scope:checkin` / `no-restricted-imports` |
| neue Lib → shared | erlaubt | ✅ |

Zusätzlich wurden echte Verstöße in Quelldateien eingebaut, per `nx lint <projekt>` geprüft und danach zurückgebaut: `booking-ui`, `checkin-feat-history-feature`, `client` und `checkin-feat-checkin-data` schlugen jeweils mit `@nx/enforce-module-boundaries` fehl. Die Kommentare `// boundary-violation-example: …` in den Quellen markieren weitere Verstöße zum Einkommentieren.

## Selbst ausprobieren

Voraussetzungen: Node 22 (≥ 22.16), pnpm 10, Java 11+ (`java -version`, für den Adapter openapi-tools), Netz beim ersten Lauf (Jar-Download, Petstore-URL).

```sh
# 1. frischer Checkout
git clone <repo-url> sheriff-blue-print && cd sheriff-blue-print
git checkout feat/nx-blueprint
pnpm install
pnpm exec playwright install chromium          # einmalig, Browser für die Tests

# 2. generieren (optional: build/lint/test/typecheck generieren selbst; hilft der IDE)
pnpm openapi:generate                           # = nx run-many -t generate, 6 Tasks
git status                                      # leer: generierter Code ist gitignored
ls libs/booking/generated/booking-client/*/src/generated

# 3. bauen, testen, prüfen
pnpm exec nx run-many -t build lint test typecheck
pnpm verify                                     # nx run tooling-verify:verify, 134 Fälle + Checks
pnpm exec nx sync:check

# 4. ansehen
pnpm exec nx graph                              # Projekte generated-*, Kanten Teil → Client
pnpm exec nx show project booking-generated-booking-client   # Targets generate/update-spec, Inputs
pnpm exec nx show projects --affected --files libs/generated/notification-client/openapi.yaml
pnpm exec nx graph --focus=tooling-workspace     # Tooling-Libs: workspace → conventions, openapi, ng-lib; openapi → conventions
pnpm exec nx run-many -t lint test typecheck -p 'tooling-*'   # Specs der Tooling-Libs
pnpm exec nx show projects --affected --files packages/tooling/ng-lib/src/build.js   # alle Libs mit build/test + App

# 5. Tests interaktiv: Vitest UI (watch, headed Chromium mit Browser-Vorschau, MSW läuft wie im Test), bis Strg+C
pnpm test:ui booking-api                        # = nx test-ui booking-api → http://localhost:51204/__vitest__/
pnpm exec nx run booking-api:test-ui --headless # UI ohne Browserfenster (Tests laufen headless, Ergebnis in der UI)
pnpm exec nx run booking-api:test --browsers=chromium --watch   # nur headed, ohne UI

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
#   nutzen: @blueprint/generated/demo-client/api im api-Layer, in Specs
#   import { demoClientHandlers, demoClientHttp } from '@blueprint/generated/demo-client/testing'
pnpm exec nx g @blueprint/tooling-workspace:remove generated/demo-client
git status                                      # wieder leer

# 7. Adapter tauschen (booking-client)
#   openapi-clients.json: "booking/generated/booking-client": { "adapter": "hey-api" }
#   libs/booking/api/src/booking-api.ts: Variante B (siehe Abschnitt Adapter)
pnpm exec nx run-many -t build lint test typecheck
git checkout openapi-clients.json libs/booking/api/src/booking-api.ts

# 8. Spec aktualisieren (nur Clients mit url)
pnpm exec nx run generated-pet-client:update-spec   # "unchanged" oder "updated"
git diff libs/generated/pet-client/openapi.yaml

# 9. Cache pro Client
#   openapi-clients.json: "generated/pet-client": { "url": "…", "options": { "providedIn": "root" } }
pnpm exec nx run-many -t build lint test typecheck generate   # nur generated-pet-client:generate läuft neu
git checkout openapi-clients.json

# 10. Negativprobe Boundaries
printf "import { BookingsService } from '@blueprint/booking/generated/booking-client/api';\nexport const x = BookingsService;\n" > libs/booking/ui/src/probe.ts
pnpm exec nx lint booking-ui                    # rot: type:ui darf kein type:api
mv libs/booking/ui/src/probe.ts libs/checkin/data/src/probe.ts
pnpm exec nx lint checkin-data                  # rot: scope:checkin nur über den Port
rm libs/checkin/data/src/probe.ts

# 11. Negativprobe fehlender Handler
#   in libs/booking/api/src/booking-notifications.spec.ts die Zeile
#   beforeEach(() => worker.use(...notificationClientHandlers)); auskommentieren
pnpm exec nx test booking-api                   # rot: [MSW] … without a matching request handler
git checkout libs/booking/api/src/booking-notifications.spec.ts
```
