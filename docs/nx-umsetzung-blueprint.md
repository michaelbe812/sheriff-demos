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
```

- Jede Lib: `project.json` (Tags, `build` + `lint` + `typecheck`), `tsconfig.json`, `src/index.ts` als **einzige** öffentliche API, dazu die Build-Dateien (siehe [Buildable Libs](#buildable-libs)).
- Alias: `@blueprint/<pfad-unter-libs>`, z.B. `@blueprint/booking/api` oder `@blueprint/checkin/feat-checkin/api`. Er zeigt direkt auf `index.ts`. Einen Wildcard-Alias gibt es nicht mehr.
- Projektname = Pfad mit `-` (`booking-feat-check-booking-data`).
- `booking.routes.ts`/`checkin.routes.ts` exportieren jetzt benannt (`bookingRoutes`), weil `export *` keinen Default re-exportiert.
- Ein lib-privater Ordner `internal/` (z.B. `checkin/data/src/internal/checkin.mapper.ts`) ist bloße Konvention. Privat ist die Datei, weil `index.ts` sie nicht exportiert.

**Kosten:** 32 Libs (booking 12, checkin 11, auth 3, layout 2, shared 4) statt 2. Das sind 224 Boilerplate-Dateien (7 pro Lib: `project.json`, `tsconfig.json`, `index.ts` + für den Build `package.json`, `ng-package.json`, `tsconfig.lib.json`, `tsconfig.lib.prod.json`) und 32 `paths`-Einträge. Ein neuer Bucket bedeutet eine neue Lib, nicht einen neuen Ordner.

## Buildable Libs

Jede Lib hat ein `build`-Target mit `@nx/angular:ng-packagr-lite` (incremental buildable, `ng-packagr` ~22.0). Die komplette Target-Config steht in `nx.json` → `targetDefaults.build` (`dependsOn: ["^build"]`, cache, `production`-Inputs, Output `dist/{projectRoot}`, Optionen mit `{projectRoot}`). In der `project.json` steht nur `"build": {}`.

Pro Lib zusätzlich:

| Datei | Inhalt |
|---|---|
| `package.json` | `name` = Import-Alias (`@blueprint/booking/data`), `private: true`, `peerDependencies` = tatsächlich importierte `@angular/*` |
| `ng-package.json` | `dest: dist/libs/<pfad>`, `entryFile: src/index.ts` |
| `tsconfig.lib.json` | erweitert `tsconfig.json` (`noEmit: false`, Declarations) |
| `tsconfig.lib.prod.json` | ohne `declarationMap` |

- **Incremental:** Beim Lib-Build schreibt Nx die Pfade abhängiger Libs auf `dist/` um. Ohne gebaute Abhängigkeit schlägt der Build fehl (`TS2307`), `dependsOn: ^build` sorgt für die Reihenfolge.
- **App:** `client:build` nutzt `@nx/angular:application` mit `buildLibsFromSource: false`, bündelt also die gebauten Libs aus `dist/`. Die Chunks sind identisch zum Source-Build (main ~217 kB, 8 Lazy-Chunks, `bookingRoutes`/`checkinRoutes` lazy). `serve` (`@angular/build:dev-server`) baut weiterhin aus den Sources. Für `serve` gegen `dist/` bräuchte es `@nx/angular:dev-server` und damit `@angular-devkit/build-angular`, deshalb bewusst nicht umgesetzt.
- **Source-Aliase bleiben:** `tsconfig.base.json` zeigt weiter auf `src/index.ts` (IDE, `typecheck`, Lint).
- **Output:** `ng-packagr-lite` erzeugt `esm2022/` (eine Datei pro Quelldatei) + `.d.ts`, in *full compilation mode*, ohne FESM-Bundle. Das reicht für das App-Bundling, ist aber nicht publizierbar (deshalb `private: true`). Publizierbar wäre `@nx/angular:package` (FESM2022 + partial compilation).
- **`enforceBuildableLibDependency`** bleibt an. Da alle Libs buildable sind, greift es nur bei neuen Libs ohne `build`.
- Nx leitet aus der lib-`package.json` das Tag `npm:private` ab. Keine Constraint nutzt es, die depConstraints sind unverändert.

## Tag-Schema

| Achse | Tags | Wo |
|---|---|---|
| Scope | `scope:<slice>`, `scope:shared` | jede Lib |
| Type | `type:types\|utils\|events\|api\|data\|ui\|feature`, `type:app`, `type:tooling` | jede Lib/App/Package |
| Feat | `feat:<feat>` bzw. `feat:none` | jede Lib |
| Marker | `port`, `feat-port`, `entry` | Slice-api, Feat-api, Slice-shell |

## depConstraints (`eslint.config.mjs`)

Nx wendet **alle** Constraints an, die auf die Tags der Quelle passen, und verknüpft sie mit UND. Innerhalb einer Constraint reicht **ein** passendes Ziel-Tag (ODER). Das ist dieselbe Semantik wie bei den Sheriff-depRules. Marker-Tags brauchen deshalb keine transparente `anyTag`-Regel: für ein Tag ohne Constraint gilt einfach nichts.

```js
// Layer-Matrix
type:types   -> []                         + bannedExternalImports ['*']
type:utils   -> types, utils
type:events  -> types, utils, events
type:api     -> types, utils, api
type:data    -> types, utils, api, data, events
type:ui      -> types, utils, ui, events
type:feature -> type:*                     (Glob)
type:app     -> entry, port, scope:shared
// sameTag-Ersatz, generiert aus den vorhandenen Tags
scope:shared -> scope:shared
scope:<s>    -> scope:<s>, port, scope:shared           (je Slice)
feat:<f>     -> feat:<f>, feat:none, feat-port          (je Feat)
// Nx-Extra
utils|events|data|ui|feature: bannedExternalImports ['@angular/common/http']
```

**Wie wird `sameTag` ausgedrückt?** Gar nicht direkt: Nx kann aus einem Ziel-Tag nicht auf das Quell-Tag zurückverweisen. Deshalb gibt es eine Constraint pro Scope und eine pro Feat. `sameTagConstraints()` in `eslint.config.mjs` liest dazu alle `project.json` unter `apps/ libs/ packages/` und erzeugt die Constraints aus den vorhandenen `scope:*`- und `feat:*`-Tags. Ein neuer Slice ist abgedeckt, sobald seine Lib das Tag trägt. Eine Liste muss niemand pflegen.

Zusätzlich verbietet `no-restricted-imports` Deep-Imports: generiert aus den `tsconfig.base.json`-Paths, Muster `<alias>/**`.

## Mapping Sheriff-Regel → Nx

| Sheriff (architecture.md) | Nx-Konstrukt |
|---|---|
| Layer-Matrix `type:*` | `onlyDependOnLibsWithTags` je `type:*` |
| `type:feature` → alle `type:` | Glob-Tag `type:*` |
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
| Kein `sameTag`, keine Rückreferenz Quelle→Ziel | Constraints je Scope/Feat aus `project.json`-Tags generiert (Workaround) |
| Keine Negation („kein `feat-*`“); `notDependOnLibsWithTags` ist **transitiv** (prüft alle erreichbaren Libs) und taugt deshalb nicht für „nur direkt verboten“ | Positiver Marker `feat:none` auf allen Nicht-Feat-Libs (Konvention, im Verify-Skript geprüft) |
| Tag-Tippfehler (`scope:bookng`) würde still einen neuen Scope erzeugen; Nx prüft Tags nicht gegen Ordner | `tools/verify-boundaries.mjs` prüft das Tag-Schema gegen den Pfad (Scope, Type, Feat, `entry`/`port`/`feat-port`) |
| Die Regel erkennt Deep-Imports über einen Alias nicht (`@blueprint/checkin/data/src/…` passiert die Tag-Prüfung) | `no-restricted-imports` generiert aus den Paths; TS löst den Import ohnehin nicht auf |
| Zyklen werden **vor** Tags geprüft: ein Aufwärts-Import im Slice (api→data) meldet sich oft als „Circular dependency“ statt als Layer-Verstoß | geblockt ist er trotzdem, nur mit anderer Meldung. Das Verify-Skript testet beide Varianten |
| Ohne gecachten Projekt-Graph **überspringt** die Nx-Regel still (nur eine Warnung), z.B. bei `eslint` direkt oder in der IDE nach frischem Clone/`nx reset` | `nx lint` baut den Graph selbst. Für alle anderen Aufrufer baut `eslint.config.mjs` ihn per `ensureProjectGraph()` (top-level `await`), falls er fehlt. Geprüft: echter Verstoß in `booking-ui`, leeres `workspace-data`, `eslint <datei>` → Fehler statt Skip |
| App-interne Slices (Phase 1 des Sheriff-Blueprints) sind nicht prüfbar: eine App ist ein Projekt | alles, was Regeln braucht, lebt in Libs, die App ist dünne Shell (Konvention) |
| Domain-shared → Feat-Lib (z.B. `booking/data` → `feat-check-booking/data`) ist erlaubt, wie bei Sheriff | bewusst 1:1 übernommen. Härtung wäre möglich per `allSourceTags: ['feat:none', 'type:data']` → `feat:none` |
| Die Generatoren des `sheriff-blueprint`-Packages erzeugen das Sheriff-Layout (Ordner statt Libs) | offen: ein Nx-Generator für „Slice/Feat als Lib-Set“ ist nötig |

## Paket `packages/sheriff-blueprint`

Das Paket bleibt unverändert, samt `createSheriffConfig`, `nxModuleBoundariesOptions` und Generatoren. In diesem Workspace wird es aber nicht mehr benutzt: `sheriff.config.ts` und `@softarc/eslint-plugin-sheriff` sind entfernt. Die e2e-Specs laufen nur, wenn es im Workspace eine `sheriff.config.ts` gibt (`describe.skipIf`). Unit- und Generator-Tests laufen weiter.

## Verifikation

```sh
pnpm exec nx run-many -t build lint test typecheck   # 34 Projekte grün (build 34, lint 34, typecheck 32, test 1)
pnpm verify:boundaries                                # 38/38 Fälle + Tag-Schema
```

Die 4 Lint-Warnungen in `sheriff-blueprint` (`no-non-null-assertion` in Tests) gab es schon vorher. Baseline vor dem Umbau: alles grün. `client:lint` scheiterte nur flaky, weil die Sheriff-e2e-Specs parallel temporäre Dateien in `apps/client` schrieben.

`tools/verify-boundaries.mjs` lintet für jeden Fall eine virtuelle Datei (`ESLint#lintText` mit `filePath` in der echten Lib) gegen die echte Config. Mutationsprobe: `type:ui` testweise `type:data` erlaubt → Fall „ui -> data“ rot, Exit 1.

| Regel | erwartet | Ergebnis |
|---|---|---|
| layer: ui → data / ui → api | blockiert | ✅ `type:ui` |
| layer: utils → api (shared) | blockiert | ✅ `type:utils` |
| layer: types → irgendwas | blockiert | ✅ `type:types` |
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

Zusätzlich wurden echte Verstöße in Quelldateien eingebaut, per `nx lint <projekt>` geprüft und danach zurückgebaut: `booking-ui`, `checkin-feat-history-feature`, `client` und `checkin-feat-checkin-data` schlugen jeweils mit `@nx/enforce-module-boundaries` fehl. Die Kommentare `// boundary-violation-example: …` in den Quellen markieren weitere Verstöße zum Einkommentieren.
