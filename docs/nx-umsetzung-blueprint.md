# Blueprint mit reinen Nx-Mitteln

Branch `feat/nx-blueprint`: das Regelwerk aus [`architecture.md`](https://github.com/michaelbe812/sheriff-demos/blob/feat/nx-blueprint/docs/architecture.md) (Ausgangs-Blueprint, ohne `infra/`), aber **ohne Sheriff**. Die Grenzen erzwingen nur Nx-Libs, Tags und `@nx/enforce-module-boundaries` (Nx 23.1). Sheriff wird auch für Regeln *innerhalb* einer Lib nicht gebraucht (Begründung in [Entscheidung: Feat-Buckets als eigene Libs](#entscheidung-feat-buckets-als-eigene-libs)).

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
```

- Jede Lib = Ordner + `src/index.ts` als **einzige** öffentliche API. Außerhalb von `src/` gibt es pro Lib **keine Datei**: kein `project.json`, `package.json`, `ng-package.json`, `tsconfig*.json`. Projekt, Tags und Targets leitet das lokale Nx-Plugin `@blueprint/tooling` aus dem Pfad ab (siehe [Libs ohne Config-Dateien](#libs-ohne-config-dateien)), `tooling:verify` meldet jede solche Datei rot.
- Neue Domains, Libs und Feats legen die Generatoren an (siehe [Tooling & Generatoren](#tooling--generatoren)).
- Alias: `@blueprint/<pfad-unter-libs>`, z.B. `@blueprint/booking/api` oder `@blueprint/checkin/feat-checkin/api`. Ein einziger Wildcard-Eintrag in `tsconfig.base.json` deckt alle Libs ab: `@blueprint/*` → `./libs/*/src/index.ts`.
- Projektname = Pfad mit `-` (`booking-feat-check-booking-data`).
- `booking.routes.ts`/`checkin.routes.ts` exportieren jetzt benannt (`bookingRoutes`), weil `export *` keinen Default re-exportiert.
- Ein lib-privater Ordner `internal/` (z.B. `checkin/data/src/internal/checkin.mapper.ts`) ist bloße Konvention. Privat ist die Datei, weil `index.ts` sie nicht exportiert.

**Kosten:** 32 Libs (booking 12, checkin 11, auth 3, layout 2, shared 4) statt 2, dazu 3 Testing-Libs. Pro Lib nur noch `src/index.ts` als Pflichtdatei. Ein neuer Bucket bedeutet einen neuen Lib-Ordner mit `src/index.ts`. Die Konfiguration ist zentral (`packages/tooling`, `libs/tsconfig*.json`), Dateizählung siehe [Libs ohne Config-Dateien](#libs-ohne-config-dateien).

## Buildable Libs

Jede Lib hat ein `build`-Target mit dem lokalen Executor `@blueprint/tooling:ng-lib-build` (incremental buildable). Er delegiert unverändert an `@nx/angular:ng-packagr-lite` (`ng-packagr` ~22.0). Die Target-Config inferiert das Plugin `packages/tooling/src/plugin/blueprint-libs.ts` (`dependsOn: ["^build"]`, cache, Output `dist/{projectRoot}`, Inputs siehe unten). Testing-Libs bekommen kein `build`.

**Keine Build-Dateien pro Lib.** Der Executor erzeugt pro Lauf in `tmp/ng-lib/<projectRoot>/<target>/`:

| Datei | Inhalt | warum nötig |
|---|---|---|
| `ng-package.json` | `dest` = `dist/<projectRoot>`, `entryFile` = `<projectRoot>/src/index.ts` (absolut) | ng-packagr (`forProject`) liest die Config nur aus einer Datei |
| `package.json` | `name` = Alias (`metadata.js.packageName` vom Plugin), `private`, `sideEffects: false`, `peerDependencies` = npm-Pakete, die der Produktionscode importiert (Graph-Kanten ∩ Imports ohne Specs) | ng-packagr verlangt sie neben der ng-package.json (`Cannot discover package sources … 'package.json' was not found`) |
| `tsconfig.json` | `extends` gemeinsame `libs/tsconfig.lib.json`, `paths` der Abhängigkeiten auf `dist/` | siehe unten |

- **Gemeinsame tsconfig** `libs/tsconfig.lib.json`. ng-packagr kompiliert nur `entryFile` (rootNames), `include` muss nur irgendeine Datei treffen (sonst TS18003). `production` = Option `compilerOptions: { declarationMap: false }`, statt einer eigenen prod-tsconfig.
- **Warum die Paths selbst umgeschrieben werden:** Nx (`@nx/js` `calculateProjectBuildableDependencies`) nimmt den Import-Namen einer Abhängigkeit aus deren lib-`package.json`, sonst den Projektnamen (`booking-data`). Ohne lib-`package.json` bliebe `@blueprint/booking/data` auf den Quellen. Beim Lib-Build scheitert das laut, die **App baut aber still aus Source**. Deshalb gibt es auch `@blueprint/tooling:ng-lib-application` (Wrapper um `@nx/angular:application`), der dieselben dist-Paths setzt. Alias-Quelle: `metadata.js.packageName` des Projekts, sonst exakter oder Wildcard-`paths`-Eintrag.
- **Inputs:** `libs/tsconfig.lib.json`, `libs/tsconfig.json`, `tsconfig.base.json` und `packages/tooling/src/executors/ng-lib/**` sind explizite Build-Inputs, weil sie außerhalb der Libs liegen.
- **peerDependencies nur aus Produktionscode:** Die Graph-Kanten enthalten auch Imports aus Specs. Ohne Filter stand nach dem MSW-Umbau `vitest` in der dist-`package.json` von 4 Libs (und der Build-Output hing an Spec-Dateien, die nicht in den `production`-Inputs sind).
- **dist ist byte-identisch** zum Setup mit Dateien pro Lib (alle 32 Libs + App, 346 Dateien, `diff -r`) und nach dem Umzug nach `packages/tooling` (Snapshot `packages/tooling/nx-internals/dist-hashes.json`).
- **Incremental:** Beim Lib-Build schreibt Nx die Pfade abhängiger Libs auf `dist/` um. Ohne gebaute Abhängigkeit schlägt der Build fehl (`TS2307`), `dependsOn: ^build` sorgt für die Reihenfolge.
- **App:** `client:build` nutzt `@blueprint/tooling:ng-lib-application` (→ `@nx/angular:application`) mit `buildLibsFromSource: false`, bündelt also die gebauten Libs aus `dist/`. Die Chunks sind identisch zum Source-Build (main ~217 kB, 8 Lazy-Chunks, `bookingRoutes`/`checkinRoutes` lazy). `serve` (`@angular/build:dev-server`) baut weiterhin aus den Sources. Für `serve` gegen `dist/` bräuchte es `@nx/angular:dev-server` und damit `@angular-devkit/build-angular`, deshalb bewusst nicht umgesetzt.
- **Source-Aliase bleiben:** `tsconfig.base.json` zeigt weiter auf `src/index.ts` (IDE, `typecheck`, Lint).
- **Output:** `ng-packagr-lite` erzeugt `esm2022/` (eine Datei pro Quelldatei) + `.d.ts`, in *full compilation mode*, ohne FESM-Bundle. Das reicht für das App-Bundling, ist aber nicht publizierbar (deshalb `private: true`). Publizierbar wäre `@nx/angular:package` (FESM2022 + partial compilation).
- **`enforceBuildableLibDependency`** bleibt an. Jede Lib außer den Testing-Libs bekommt `build` automatisch, die Regel greift also bei Imports von Testing-Libs in Produktionscode.

## Libs ohne Config-Dateien

Pro Lib gibt es außerhalb von `src/` **keine Datei**. Eine neue Lib ist ein Ordner mit `src/index.ts`, angelegt per Generator:

```sh
nx g @blueprint/tooling:layer booking events
# → libs/booking/events/src/{index.ts,booking.events.ts}: Projekt booking-events,
#   Tags scope:booking type:events feat:none, Targets build/lint/typecheck,
#   Alias @blueprint/booking/events, alle Constraints aktiv
```

Von Hand geht es weiterhin (`mkdir -p libs/<scope>/<layer>/src && echo 'export {};' > …/index.ts`), der Scope muss dann in der Scope-Liste stehen. Specs dazulegen (`src/**/*.spec.ts`) erzeugt das `test`-Target. Ein Ordner `testing` statt eines Layers ergibt eine Testing-Lib (`type:testing`, kein `build`). `tooling:verify` beweist das bei jedem Lauf mit zwei temporären Libs in `libs/booking/feat-tmpverify/` (`ui`, `types`, nur `src/index.ts`): Projekt, Tags und Targets stimmen, 8 Lint-Fälle gegen und von ihnen greifen, danach werden sie entfernt.

### Bausteine

| Baustein | Aufgabe |
|---|---|
| `packages/tooling/src/plugin/blueprint-libs.ts` | lokales Crystal-Plugin (`createNodesV2`, in `nx.json` → `plugins` als `@blueprint/tooling` mit `options.scopes`). Marker `libs/**/src/index.ts`. Liefert `name` (Pfad mit `-`), `root`, `sourceRoot`, `projectType`, Tags aus dem Pfad, `metadata.js.packageName` = Alias und die Targets. Ein Pfad, der nicht `libs/<scope>/<layer>` bzw. `libs/<scope>/feat-<f>/<layer>` mit bekanntem Layer und gelistetem Scope ist, bricht den Graph ab, statt still eine Lib ohne Regeln zu erzeugen. Konventionen (Layer, Tags, Scope-Check) in `lib-conventions.ts`, geteilt mit den Generatoren |
| `tsconfig.base.json` | ein Wildcard-Pfad `@blueprint/*` → `./libs/*/src/index.ts` statt 35 Einträgen |
| `libs/tsconfig.json` | gemeinsame Compiler-Optionen (strict, es2022, `module: preserve`), IDE + `typecheck` |
| `libs/tsconfig.lib.json` | Build (erweitert `libs/tsconfig.json`, Declarations, ohne Specs) |
| `libs/tsconfig.spec.json` | Tests (erweitert `libs/tsconfig.json`, nur Specs) |
| `packages/tooling/scripts/typecheck-lib.mjs` | `typecheck`: `libs/tsconfig.json`, `include` per TS-API im Speicher auf `<lib>/src` verengt (`tsc -p` kann `include` nicht per CLI setzen) |
| `packages/tooling/src/executors/ng-lib/` | lokale Executoren `ng-lib-build`, `ng-lib-application`, `ng-lib-test` (unten) |
| `eslint.config.mjs`, `packages/tooling/scripts/verify-boundaries.mjs` | lesen Tags, Lib-Roots (Deep-Import-Aliase) und Targets aus dem Projekt-Graph statt aus `project.json`/`paths` |

Inferierte Targets:

| Target | Executor | Wann |
|---|---|---|
| `lint` | `nx:run-commands` → `eslint .` im Lib-Ordner | immer |
| `typecheck` | `nx:run-commands` → `node packages/tooling/scripts/typecheck-lib.mjs <root>` | immer |
| `build` | `@blueprint/tooling:ng-lib-build` | nicht für `testing` |
| `test` | `@blueprint/tooling:ng-lib-test` | nur wenn `src/` eine `*.spec.ts` enthält |

Eine `project.json` in einer Lib würde Nx zwar über die inferierten Werte legen, `tooling:verify` meldet sie aber rot (Wächter gegen Config-Dateien). `typecheck-lib.mjs` nimmt technisch weiter eine lib-eigene `tsconfig.json`, auch die ist vom Wächter verboten.

### Executor-Wrapper (`packages/tooling/src/executors/ng-lib`)

Alle drei delegieren an den Nx-Executor und ergänzen nur, was sonst aus Dateien pro Lib käme. Temporäre Dateien liegen in `tmp/ng-lib/<root>/<target>/` (gitignored).

| Wrapper | delegiert an | ergänzt |
|---|---|---|
| `build` | `@nx/angular:ng-packagr-lite` | `ng-package.json`, `package.json`, tsconfig mit dist-Paths (siehe [Buildable Libs](#buildable-libs)) |
| `application` | `@nx/angular:application` | tsconfig mit dist-Paths der Libs. Ohne ihn baut die App **still aus Source**, weil Nx den Alias nur aus einer lib-`package.json` kennt |
| `test` | `@nx/angular:unit-test` | Build-Target als `@angular/build:ng-packagr` + spec-tsconfig pro Lib (unten) |

**`test` im Detail.** `@angular/build:unit-test` braucht keine Datei pro Lib (`tsConfig`, `runnerConfig`, `setupFiles`, `providersFile` sind Workspace-Pfade). Zwei Probleme blieben:

1. **Build-Target:** Der Angular-Builder liest die Optionen des `buildTarget` (Default `<lib>:build:development`) und kennt nur `@angular/build:application` und `@angular/build:ng-packagr`. `@nx/angular:unit-test` mappt nur `ng-packagr-lite`/`package` auf `ng-packagr`, und dieser Pfad liest `<root>/ng-package.json` (nur `styleIncludePaths`, `assets`, `inlineStyleLanguage`). Für `@blueprint/tooling:ng-lib-build` käme „not supported“ plus Schema-Fehler. Lösung: Nx' Builder-Context (`createBuilderContext`) liest Executor und Optionen jedes Targets aus `context.projectGraph`. Der Wrapper gibt `@nx/angular:unit-test` eine Kopie des Kontexts, in der das Build-Target `@angular/build:ng-packagr` mit einer temporären `ng-package.json` (nur `lib.entryFile`) ist. Kein Monkeypatching, der Rest des Graphen bleibt unverändert. Das ist derselbe Pfad wie vorher mit echter `ng-package.json` pro Lib.
2. **Spec-tsconfig:** Eine gemeinsame tsconfig mit `**/*.spec.ts` würde pro Lib alle 4 Spec-Dateien des Workspaces kompilieren. Der Wrapper schreibt eine tsconfig, die `libs/tsconfig.spec.json` erweitert und `include` auf `<root>/src/**/*.spec.ts` + `*.d.ts` setzt. Beleg: `tsc --listFilesOnly` zeigt für `booking-data` 1 Spec, für `libs/tsconfig.spec.json` allein 4.

Browser Mode, MSW-Worker (`publicDir`) und die Workarounds in `vitest-base.config.mts` sind unberührt (`runnerConfig` wie bisher).

### Cache-Inputs

Gemeinsame Dateien liegen außerhalb von `{projectRoot}` und stehen deshalb explizit in den Inputs:

| Target | zusätzliche Inputs |
|---|---|
| `lint` | `eslint.config.mjs`, `packages/tooling/src/plugin/**` (die Tags im Graph bestimmen die Constraints), `eslint` |
| `typecheck` | `tsconfig.base.json`, `libs/tsconfig.json`, `packages/tooling/scripts/typecheck-lib.mjs`, `typescript` |
| `build` | `production`, `^production`, `tsconfig.base.json`, `libs/tsconfig.json`, `libs/tsconfig.lib.json`, `packages/tooling/src/executors/ng-lib/**`, `ng-packagr`, `@angular/compiler-cli`, `typescript` |
| `test` | `default`, `^production`, `tsconfig.base.json`, `libs/tsconfig.json`, `libs/tsconfig.spec.json`, `packages/tooling/src/executors/ng-lib/**`, `vitest-base.config.mts`, `vitest`, `@vitest/browser-playwright`, `msw`, `@angular/build` |
| `client:build` (`targetDefaults`) | `production`, `^production`, `tsconfig.base.json`, `packages/tooling/src/executors/ng-lib/**` |
| `tooling:verify` | `libs/**`, `apps/**`, `eslint.config.mjs`, `nx.json`, `tsconfig.base.json`, Skript + Plugin, Output von `client:build` (dependsOn), `eslint`, `@nx/eslint-plugin`, `nx` |

- `packages/tooling/src/plugin/**` ist nur bei `lint` ein Input. Die Target-Config selbst hasht Nx ohnehin mit (Hash-Instruktion `ProjectConfiguration`). Beleg: Option im Plugin geändert → `lint` aller Libs, alle `test` und die betroffenen `build`/`typecheck` laufen neu.
- Beleg: Leerzeile in `libs/tsconfig.spec.json` → genau die 4 `test`-Tasks laufen neu, alles andere aus dem Cache.
- `nx show target booking-data:test --inputs` zeigt die aufgelösten Inputs.

### Dateizählung

| | vorher (`2857237`) | nachher |
|---|---|---|
| Dateien pro Lib außerhalb `src/` (35 Libs) | 202: 35 `project.json`, 35 `tsconfig.json`, 32 `package.json`, 32 `ng-package.json`, 32 `tsconfig.lib.json`, 32 `tsconfig.lib.prod.json`, 4 `tsconfig.spec.json` | **0** |
| `paths` in `tsconfig.base.json` | 35 | 1 (Wildcard) |
| gemeinsame Dateien | – | 3 unter `libs/` (`tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`), alles Weitere im Package `packages/tooling` (Plugin, Executoren, Generatoren, Skripte) |
| Tasks `run-many -t build lint test typecheck` | 111 | 111 (dieselben), seit `packages/tooling` 114 (+ `tooling:lint/test/typecheck`) |
| dist (32 Libs + App) | – | byte-identisch |

`libs/shared/testing/public/mockServiceWorker.js` bleibt (generiert von `msw init`, kein Config-File).

### Kosten und Trade-offs

- **Abhängigkeit von Nx-Interna.** Keine öffentliche API, kann sich mit jedem Minor ändern:
  - `@nx/angular/src/executors/{ng-packagr-lite,application,unit-test}/*.impl` (direkt importiert)
  - `@nx/js/internal` → `calculateProjectBuildableDependencies` (dist-Paths)
  - Verhalten von `nx/src/adapter/ngcli-adapter` `createBuilderContext`: liest Executor/Optionen aus `context.projectGraph` (Grundlage des `test`-Wrappers)
  - Verhalten von `@nx/angular:unit-test`: mappt nur `ng-packagr-lite`/`package`, Default-`buildTarget` `::development`
  - Verhalten von `@angular/build:unit-test`: akzeptiert nur `application`/`ng-packagr`, liest `ng-package.json` über `project`
- **Nach jedem `nx migrate` (und Angular-Update) die Beweise neu laufen lassen:** `pnpm verify:nx-internals` (run-many mit `--skip-nx-cache`, dist-Äquivalenz gegen Snapshot oder `--reference`, Marker-Test App-gegen-dist, MSW-Probe fehlender Handler, `tooling:verify`), siehe [Tooling & Generatoren](#tooling--generatoren).
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
| Marker | `port`, `feat-port`, `entry` | Slice-api, Feat-api, Slice-shell |

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
| Tag-Tippfehler (`scope:bookng`) würde still einen neuen Scope erzeugen; Nx prüft Tags nicht gegen Ordner | Tags gibt es nicht mehr von Hand: das Plugin leitet sie aus dem Pfad ab, ein unbekannter Layer-Ordner oder ein Scope außerhalb der Scope-Liste (`nx.json`) bricht den Graph ab (`libs/bokking/ui: unknown scope "bokking" (did you mean "booking"?)`). `packages/tooling/scripts/verify-boundaries.mjs` prüft die Plugin-Ausgabe unabhängig gegen den Pfad (Scope, Type, Feat, `entry`/`port`/`feat-port`), dass jede `src/index.ts` ein Projekt ist und die Scope-Liste keine Einträge ohne Lib hat |
| Die Regel erkennt Deep-Imports über einen Alias nicht (`@blueprint/checkin/data/src/…` passiert die Tag-Prüfung) | `no-restricted-imports` generiert aus den Lib-Roots im Graph (`@blueprint/<root>/**`); TS löst den Import ohnehin nicht auf |
| Zyklen werden **vor** Tags geprüft: ein Aufwärts-Import im Slice (api→data) meldet sich oft als „Circular dependency“ statt als Layer-Verstoß | geblockt ist er trotzdem, nur mit anderer Meldung. Das Verify-Skript testet beide Varianten |
| Ohne gecachten Projekt-Graph **überspringt** die Nx-Regel still (nur eine Warnung), z.B. bei `eslint` direkt oder in der IDE nach frischem Clone/`nx reset` | `nx lint` baut den Graph selbst. Für alle anderen Aufrufer baut `eslint.config.mjs` ihn per `ensureProjectGraph()` (top-level `await`), falls er fehlt. Geprüft: echter Verstoß in `booking-ui`, leeres `workspace-data`, `eslint <datei>` → Fehler statt Skip |
| App-interne Slices (Phase 1 des Sheriff-Blueprints) sind nicht prüfbar: eine App ist ein Projekt | alles, was Regeln braucht, lebt in Libs, die App ist dünne Shell (Konvention) |
| Domain-shared → Feat-Lib (z.B. `booking/data` → `feat-check-booking/data`) ist erlaubt, wie bei Sheriff | bewusst 1:1 übernommen. Härtung wäre möglich per `allSourceTags: ['feat:none', 'type:data']` → `feat:none` |
| Die Generatoren des `sheriff-blueprint`-Packages erzeugen das Sheriff-Layout (Ordner statt Libs). `@nx/angular:library` erzeugt `project.json`, `tsconfig*.json`, `ng-package.json` usw., `@nx/angular:component` findet inferierte Projekte nicht | eigene Generatoren in `packages/tooling` (domain, layer, feat, testing, move, rename, remove, component, service, store), siehe [Tooling & Generatoren](#tooling--generatoren) |

## Paket `packages/sheriff-blueprint`

> **Veraltet auf diesem Branch.** Die Generatoren `@berger-engineering/sheriff-blueprint:domain|feat|shared-feature` erzeugen das Sheriff-Layout (Ordner in einer Lib, `project.json`, Wildcard-Alias `@blueprint/domains/<d>/*`) und passen nicht zu den Libs ohne Config-Dateien. Stattdessen `@blueprint/tooling` benutzen, siehe [Tooling & Generatoren](#tooling--generatoren).

Das Paket bleibt unverändert, samt `createSheriffConfig`, `nxModuleBoundariesOptions` und Generatoren. In diesem Workspace wird es aber nicht mehr benutzt: `sheriff.config.ts` und `@softarc/eslint-plugin-sheriff` sind entfernt. Die e2e-Specs laufen nur, wenn es im Workspace eine `sheriff.config.ts` gibt (`describe.skipIf`). Unit- und Generator-Tests laufen weiter, seit dem Testing-Umbau auf Vitest 4 (23 passed, 6 skipped).

## Testing & MSW

Unit- und Komponententests laufen **nur im Vitest Browser Mode** (Chromium headless über Playwright), kein jsdom. HTTP mockt [MSW](https://mswjs.io/docs/recipes/vitest-browser-mode/) per Service Worker: Die echte `BookingApi`/`ApiHttp` ruft `fetch`, MSW beantwortet den Request im Browser.

### Struktur

```
libs/shared/testing/          scope:shared  type:testing  feat:none   kein build-Target
  public/mockServiceWorker.js   per `msw init` (package.json → msw.workerDirectory hält ihn bei Updates aktuell)
  src/network.ts                `worker` (setupWorker aus msw/browser) + `test` mit Auto-Fixture `worker`
libs/<domain>/testing/        scope:<domain> type:testing feat:none   kein build-Target
  src/fixtures/                 Builder: aBooking(), aCheckinDto()
  src/handlers/                 <domain>Handlers (Normalfall), <domain>Scenarios (empty, serverError, with…)
vitest-base.config.mts        runnerConfig: publicDir = shared/testing/public, msw-Prebundle-Fix
```

- Domain-Testing-Libs importieren nur `msw` (nicht `msw/browser`), `type:types` und `shared/testing`. Deshalb liegt `CheckinDto` jetzt in `checkin/types` statt in `checkin/api`.
- `test`-Target inferiert das Plugin für jede Lib, deren `src/` eine `*.spec.ts` enthält (heute `booking-api`, `booking-data`, `checkin-data`, `checkin-feat-checkin-feature`). Executor `@blueprint/tooling:ng-lib-test` (Wrapper um `@nx/angular:unit-test`), `browsers: ["chromiumHeadless"]`, `runnerConfig: vitest-base.config.mts`, `tsConfig: libs/tsconfig.spec.json`, `watch: false`. Keine Datei pro Lib, siehe [Libs ohne Config-Dateien](#libs-ohne-config-dateien).
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

- **Fixture `worker`** (`auto: true`): startet den Worker einmal (`onUnhandledRequest: 'error'`, Promise-Guard), `use(worker)`, danach `worker.resetHandlers()`. Kein `stop`, wie im Rezept. Abweichungen vom Rezept: `start` nur beim ersten Test (Rezept: `await worker.start()` pro Test; hier teilen sich alle Specs einer Lib die Seite, `isolate: false`) und `setupWorker()` ohne Happy-Path-Handler, die Defaults setzt jede Spec selbst.
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
| 2 | `bannedExternalImports` msw, vitest, @vitest, @testing-library, playwright in Produktions-Layern + App | `eslint.config.mjs` | verify |
| 3 | Testing-Libs ohne `build`-Target (Plugin: Ordner `testing` → `type:testing`, kein `build`). Import aus Produktionscode scheitert zusätzlich an `enforceBuildableLibDependency`, im Spec-Override ist die Regel aus | Plugin, Spec-Override | verify (Test-Isolation aus dem Graph + Fälle) |
| 4 | Die Build-tsconfig (`build.options.tsConfig` = `libs/tsconfig.lib.json`) schließt `**/*.spec.ts` aus, `build`-Inputs sind `production`, `production` schließt `**/*.spec.ts` aus, `peerDependencies` nur aus Produktionscode | `libs/tsconfig.lib.json`, Plugin, `nx.json`, `packages/tooling/src/executors/ng-lib/build.js` | verify (Test-Isolation liest Targets aus dem Graph) |
| 5 | `mockServiceWorker.js` nur in `libs/shared/testing/public`, nur per `runnerConfig` bei Testläufen serviert. Kein App-Asset | `vitest-base.config.mts` | verify (keine Datei unter `apps/`, keine testing/msw-Referenz in App-`project.json`) |
| 6 | `nx build client` + Scan des Bundles auf `msw`, `mockServiceWorker`, `setupWorker`, `vitest` | `packages/tooling/scripts/verify-boundaries.mjs` | verify: 14 Dateien, 0 Treffer |
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

`@nx/angular:unit-test` (Nx 23.1) ist **kein anderer Runner**. Es ist ein dünner Wrapper, der `executeUnitTestBuilder` aus `@angular/build` aufruft. Vorher mappt er `@nx/angular:ng-packagr-lite` → `@angular/build:ng-packagr` im Builder-Context. Vitest, Browser-Provider, TestBed-Init und `runnerConfig` bleiben also Angulars Builder. Der Fallback `@nx/vitest` + `@analogjs/vitest-angular` war damit nicht nötig. Seit den Libs ohne Config-Dateien steckt `@nx/angular:unit-test` hinter `@blueprint/tooling:ng-lib-test`, weil das Lib-Build-Target jetzt `@blueprint/tooling:ng-lib-build` ist (siehe [Executor-Wrapper](#executor-wrapper-toolsng-lib)).

### Limitierungen

| Limitierung | Umgang |
|---|---|
| Angular pre-bundelt `msw` (`optimizeDeps.include`), Vitest Browser schließt es aus → esbuild: „The entry point "msw" cannot be marked as external“ | Plugin `blueprint:msw-not-prebundled` in `vitest-base.config.mts` entfernt die Überschneidung aus `include` |
| Der Builder baut die Vitest-Projekt-Config selbst und übernimmt nur Plugins, `publicDir` nicht | `publicDir` per Plugin-`config()`-Hook gesetzt. Probe: kaputter Worker in `public/` → alle Tests rot, also wird genau diese Datei serviert |
| Vitest Browser serviert `/mockServiceWorker.js` intern ohnehin aus dem msw-Paket (`vitest:browser:resolve-virtual`) | eigener `publicDir` bleibt trotzdem, damit wir nicht von Vitest-Interna abhängen. Beide stammen aus derselben msw-Version |
| Spec-Imports sind Graph-Kanten: `nx graph`/`affected` zeigen `booking-data → booking-testing`, `^production` von `booking-data:build` enthält die Testing-Lib | Build-Output unberührt (tsconfig.lib, Bundle-Check). Cache-Invalidierung etwas breiter als nötig |
| Buildable Lib → Testing-Lib meldet zuerst `enforceBuildableLibDependency`, die Tag-Meldung erscheint erst danach | verify prüft die Tag-Constraints zusätzlich isoliert (`tags only`) |
| `type:types`-Libs können keine Testing-Libs in Specs nutzen (Zyklus) | reine Interfaces, nichts zu testen |
| `@angular/build` 22 verlangt `vitest ^4`, deshalb nicht Vitest 5. msw 3.0 ist erst 2 Tage alt, deshalb msw 2.15 | beim nächsten Update prüfen |
| Angular-Default `isolate: false`: alle Spec-Dateien einer Lib teilen sich die Seite | Worker startet einmal (Promise-Guard), `resetHandlers` nach jedem Test |
| Parallele `test`-Tasks belegen je einen Vitest-Port | Vitest weicht automatisch aus („Port 63315 is in use, trying another one“) |

### Neue `<domain>/testing` anlegen

```sh
nx g @blueprint/tooling:testing <d>     # für eine bestehende Domain; `domain` legt testing + Beispiel-Spec gleich mit an
```

1. Erzeugt `libs/<d>/testing/src/fixtures/<d>.fixture.ts` (Builder `a<D>()`), `src/handlers/<d>.handlers.ts` (`<d>Handlers`, `<d>Scenarios`: `withItems`, `empty`, `serverError`) und `src/index.ts`. Das Plugin macht daraus `<d>-testing` mit `scope:<d>`, `type:testing`, `feat:none`, Targets `lint` + `typecheck`, **kein** `build`. Alias `@blueprint/<d>/testing` aus dem Wildcard-Pfad.
2. Importiert nur `msw`, `@blueprint/<d>/types` und `@blueprint/shared/testing`. Exportiert `<d>/types` kein `<D>`, deklariert die Fixture die Backend-Form selbst (Hinweis im Kommentar: nach `<d>/types` verschieben).
3. Specs: `*.spec.ts` in `src/` einer Lib ablegen, das `test`-Target entsteht automatisch. Vorlage: `libs/<d>/data/src/<d>.store.spec.ts` aus dem Domain-Generator.
4. `tooling:verify` prüft Tag-Schema, dass das Testing-Projekt kein `build` hat und `test` genau bei Libs mit Specs existiert.

## Tooling & Generatoren

Alles Werkzeug liegt im lokalen Nx-Plugin **`packages/tooling`** (`@blueprint/tooling`, Projekt `tooling`, `type:tooling`). Details, Optionen und Begründungen: [`packages/tooling/README.md`](https://github.com/michaelbe812/sheriff-demos/blob/feat/nx-blueprint/packages/tooling/README.md).

| Teil | Wo |
|---|---|
| Crystal-Plugin + Scope-Liste | `src/plugin/`, `nx.json` → `plugins[@blueprint/tooling].options.scopes` |
| Executoren `ng-lib-build`, `ng-lib-application`, `ng-lib-test` | `src/executors/ng-lib/` |
| Generatoren | `src/generators/`, `generators.json` |
| Sync-Generator `app-routes` | `src/sync/app-routes/`, `nx.json` → `sync.globalGenerators` |
| `verify` (Nx-Target `tooling:verify`, gecacht), `verify:nx-internals` | `scripts/` |

**Kein Build-Schritt:** Nx lädt Plugin und Generatoren als TypeScript (eigener swc-Transpiler), aufgelöst über den Workspace-Link `"@blueprint/tooling": "workspace:*"` in der Root-`package.json`. Kein veraltetes `dist/`, keine Henne-Ei-Frage beim Graph. Preis: im Plugin nur `import type` aus `@nx/devkit`.

### Anleitungen

```sh
# neue Domain: types, api, data, ui, shell + testing + Beispiel-Spec, Lazy-Route in app.routes.ts, Scope in nx.json
nx g @blueprint/tooling:domain payment
# neue Lib in bestehender Domain (Layer-Liste aus dem Plugin)
nx g @blueprint/tooling:layer payment events
# neues Feat: feature-Container + optional api (feat-port), data, ui; Lazy-Route in den Shell-Routes
nx g @blueprint/tooling:feat payment checkout --api --data
# testing-Gerüst für eine bestehende Domain
nx g @blueprint/tooling:testing checkin
# verschieben / umbenennen (Importe inkl. import() in Routes, Route-Pfade, Scope-Liste)
nx g @blueprint/tooling:move booking/feat-rebook checkin/feat-rebook
nx g @blueprint/tooling:rename payment billing
# löschen (bricht bei Importen ab, außer --force; Routen + Scope raus)
nx g @blueprint/tooling:remove billing
# Komponente / Service / Store in einer Lib
nx g @blueprint/tooling:component libs/booking/ui/src/booking-badge
```

`@nx/angular:component` & Co. funktionieren hier nicht (getestet: *„does not exist under any project root“*, *„Project "booking-data" does not exist“*), weil sie das Projekt im Tree über `project.json` suchen. Deshalb die dünnen Wrapper `component`, `service`, `store`.

### Wächter

- **Scope-Liste:** unbekannter Scope-Ordner → Graph-Fehler mit Vorschlag. `domain`, `move`/`rename`, `remove` pflegen die Liste, `verify` meldet Einträge ohne Lib.
- **Config-Dateien:** `tooling:verify` meldet jede `project.json`, `package.json`, `tsconfig*.json`, `ng-package.json`, `eslint.config.*` unter `libs/**` außerhalb von `src/` (Ausnahme `libs/tsconfig*.json`).
- **Routen:** `nx sync:check` (globaler Sync-Generator `@blueprint/tooling:app-routes`): jede Slice-Shell mit `Routes` ist in `app.routes.ts` registriert, keine Lazy-Route zeigt auf eine fehlende Lib. `nx sync` repariert.

### CI

`.github/workflows/ci.yml` (Push auf `main`/`feat/nx-blueprint`, PRs): `pnpm install --frozen-lockfile`, `playwright install --with-deps chromium`, `nx sync:check`, dann bei PRs `nx affected -t build lint test typecheck` (Basis per `nrwl/nx-set-shas`), bei Pushes `run-many`, zuletzt `nx run tooling:verify`. Die Libs haben keine Graph-Kante zum Tooling-Package, deshalb läuft bei einer Tooling-Änderung auch im PR alles (`nx show projects --affected` enthält `tooling`).

### Nach `nx migrate`

`pnpm verify:nx-internals` vor dem Commit der Migration (und nach Angular-Updates): run-many mit `--skip-nx-cache` in frisches `dist/`, dist-Äquivalenz gegen `packages/tooling/nx-internals/dist-hashes.json` (oder `--reference <kopie-von-dist-vorher>`), Marker-Test „App baut gegen dist“, MSW-Probe „fehlender Handler → Test rot“, `tooling:verify`. Ändert das Update den Output bewusst: Unterschiede prüfen, dann `--update-snapshot`.

## Verifikation

```sh
pnpm exec nx run-many -t build lint test typecheck   # 38 Projekte, 114 Tasks grün (build 34, lint 38, typecheck 36, test 6)
pnpm verify                                           # nx run tooling:verify: 71/71 Fälle + Config-Wächter + Tag-Schema/Scope-Liste + Test-Isolation + neue Lib + client-Bundle
pnpm exec nx sync:check                               # app.routes.ts ↔ Slice-Shells
pnpm verify:nx-internals                              # nach nx migrate, siehe Tooling & Generatoren
```

Beweise für „Libs ohne Config-Dateien“ (tatsächlich ausgeführt, eigener Nx-Cache):

- `find libs -mindepth 2 -name '*.json' -not -path '*/src/*' -not -path '*/public/*'` → leer, nur `libs/tsconfig*.json` (Tiefe 1).
- `run-many` mit `--skip-nx-cache`: 111 Tasks grün, dieselben wie vorher; Tests 1+3+3+3 Browser + 23 `sheriff-blueprint` (6 skipped).
- `dist` (32 Libs + App, 346 Dateien) per `diff -r` identisch zum Stand `2857237`.
- App baut gegen dist: Text `Bookings` in `dist/libs/layout/ui/esm2022/nav-bar.js` durch einen Marker ersetzt, `nx run client:build --skip-nx-cache --exclude-task-dependencies` → Marker im App-Bundle (`main-*.js`), in den Quellen nicht vorhanden.
- Plain `eslint` mit leerem `NX_WORKSPACE_DATA_DIRECTORY` auf einem Verstoß in `booking/ui` (`→ @blueprint/booking/data`) → Fehler `type:ui`, Exit 1.
- MSW: Default-Handler (`beforeEach`) in `booking.store.spec.ts` entfernt → `booking-data:test` rot.
- Folgelauf ohne `--skip-nx-cache`: 109/111 aus dem Cache (die 2 übrigen: `sheriff-blueprint:build/test`, dort ohne `cache`, wie vorher).

Die 4 Lint-Warnungen in `sheriff-blueprint` (`no-non-null-assertion` in Tests) gab es schon vorher. Baseline vor dem Umbau: alles grün. `client:lint` scheiterte nur flaky, weil die Sheriff-e2e-Specs parallel temporäre Dateien in `apps/client` schrieben.

`packages/tooling/scripts/verify-boundaries.mjs` lintet für jeden Fall eine virtuelle Datei (`ESLint#lintText` mit `filePath` in der echten Lib) gegen die echte Config. Mutationsprobe: `type:ui` testweise `type:data` erlaubt → Fall „ui -> data“ rot, Exit 1.

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
