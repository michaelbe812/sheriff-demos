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
```

- Jede Lib: `project.json` (Tags, `build` + `lint` + `typecheck`), `tsconfig.json`, `src/index.ts` als **einzige** öffentliche API, dazu die Build-Dateien (siehe [Buildable Libs](#buildable-libs)).
- Alias: `@blueprint/<pfad-unter-libs>`, z.B. `@blueprint/booking/api` oder `@blueprint/checkin/feat-checkin/api`. Er zeigt direkt auf `index.ts`. Einen Wildcard-Alias gibt es nicht mehr.
- Projektname = Pfad mit `-` (`booking-feat-check-booking-data`).
- `booking.routes.ts`/`checkin.routes.ts` exportieren jetzt benannt (`bookingRoutes`), weil `export *` keinen Default re-exportiert.
- Ein lib-privater Ordner `internal/` (z.B. `checkin/data/src/internal/checkin.mapper.ts`) ist bloße Konvention. Privat ist die Datei, weil `index.ts` sie nicht exportiert.

**Kosten:** 32 Libs (booking 12, checkin 11, auth 3, layout 2, shared 4) statt 2. Das sind 224 Boilerplate-Dateien (7 pro Lib: `project.json`, `tsconfig.json`, `index.ts` + für den Build `package.json`, `ng-package.json`, `tsconfig.lib.json`, `tsconfig.lib.prod.json`) und 32 `paths`-Einträge. Ein neuer Bucket bedeutet eine neue Lib, nicht einen neuen Ordner. Dazu kommen 3 Testing-Libs (ohne Build, je `project.json`, `tsconfig.json`, `index.ts`), siehe [Testing & MSW](#testing--msw).

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
| Type | `type:types\|utils\|events\|api\|data\|ui\|feature`, `type:app`, `type:tooling`, `type:testing` | jede Lib/App/Package |
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

**Wie wird `sameTag` ausgedrückt?** Gar nicht direkt: Nx kann aus einem Ziel-Tag nicht auf das Quell-Tag zurückverweisen. Deshalb gibt es eine Constraint pro Scope und eine pro Feat. `sameTagConstraints()` in `eslint.config.mjs` liest dazu alle `project.json` unter `apps/ libs/ packages/` und erzeugt die Constraints aus den vorhandenen `scope:*`- und `feat:*`-Tags. Ein neuer Slice ist abgedeckt, sobald seine Lib das Tag trägt. Eine Liste muss niemand pflegen.

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

Das Paket bleibt unverändert, samt `createSheriffConfig`, `nxModuleBoundariesOptions` und Generatoren. In diesem Workspace wird es aber nicht mehr benutzt: `sheriff.config.ts` und `@softarc/eslint-plugin-sheriff` sind entfernt. Die e2e-Specs laufen nur, wenn es im Workspace eine `sheriff.config.ts` gibt (`describe.skipIf`). Unit- und Generator-Tests laufen weiter, seit dem Testing-Umbau auf Vitest 4 (23 passed, 6 skipped).

## Testing & MSW

Unit- und Komponententests laufen **nur im Vitest Browser Mode** (Chromium headless über Playwright), kein jsdom. HTTP mockt [MSW](https://mswjs.io/docs/recipes/vitest-browser-mode/) per Service Worker: Die echte `BookingApi`/`ApiHttp` ruft `fetch`, MSW beantwortet den Request im Browser.

### Struktur

```
libs/shared/testing/          scope:shared  type:testing  feat:none   kein build-Target
  public/mockServiceWorker.js   per `msw init` (package.json → msw.workerDirectory hält ihn bei Updates aktuell)
  src/network.ts                setupWorker (msw/browser), `test` mit Fixtures `handlers` + `network`
libs/<domain>/testing/        scope:<domain> type:testing feat:none   kein build-Target
  src/fixtures/                 Builder: aBooking(), aCheckinDto()
  src/handlers/                 <domain>Handlers (Normalfall), <domain>Scenarios (empty, serverError, with…)
vitest-base.config.mts        runnerConfig: publicDir = shared/testing/public, msw-Prebundle-Fix
```

- Domain-Testing-Libs importieren nur `msw` (nicht `msw/browser`), `type:types` und `shared/testing`. Deshalb liegt `CheckinDto` jetzt in `checkin/types` statt in `checkin/api`.
- `test`-Target pro Lib mit Specs (`booking-api`, `booking-data`, `checkin-data`, `checkin-feat-checkin-feature`). In der `project.json` steht nur `"test": {}`, die Konfiguration kommt aus `nx.json` → `targetDefaults.test` (Executor, `browsers: ["chromiumHeadless"]`, `runnerConfig`, `tsConfig: {projectRoot}/tsconfig.spec.json`, `watch: false`, Inputs `default`, `^production`, `vitest-base.config.mts`).
- Pro getesteter Lib zusätzlich `tsconfig.spec.json` (nur `src/**/*.spec.ts`).
- Einmalig: `pnpm exec playwright install chromium`.

### So sieht ein Test aus

```ts
import { bookingHandlers, bookingScenarios } from '@blueprint/booking/testing';
import { test } from '@blueprint/shared/testing';

describe('BookingStore', () => {
  test.override('handlers', () => bookingHandlers);          // Standard-Handler der Spec

  test('lädt über die echte BookingApi', async () => {
    const store = TestBed.inject(BookingStore);
    await store.load();
    expect(store.all()).toEqual(defaultBookings);
  });

  test('Fehlerfall', async ({ network }) => {
    network.use(bookingScenarios.serverError());             // nur für diesen Test
    await expect(TestBed.inject(BookingStore).load()).rejects.toThrow('500');
  });
});
```

- **Standard-Handler: explizit im Spec** per `test.override('handlers', …)`. Das Fixture `network` (`auto: true`) startet den Worker einmal (`onUnhandledRequest: 'error'`, kein `stop`), wendet `handlers` an und ruft nach jedem Test `resetHandlers()`. Kein globales Setup-File: Welche Handler gelten, steht in der Spec.
- Ohne Override gibt es keine Handler. Ein nicht gemockter Request wird von MSW geloggt und mit 500 beantwortet, der Test wird rot (`booking-api.spec.ts` prüft genau das).
- Komponententest `feat-checkin.spec.ts`: rendert `FeatCheckin` per TestBed in Chromium, klickt über `page` aus `vitest/browser` und prüft das DOM (`expect.element`). Die Buchungen kommen dabei cross-domain aus `@blueprint/booking/testing`.
- Mutationsprobe: `bookingHandlers = []` → `booking-data:test` rot (`[MSW] Error: intercepted a request without a matching request handler`).

### Schutzschichten gegen Production-Leaks

| # | Schicht | Wo | Geprüft durch |
|---|---|---|---|
| 1 | depConstraints: Produktions-Layer kennen `type:testing` nicht, `type:feature`/`type:app` ohne Glob; `type:testing` → nur types, testing, shared | `eslint.config.mjs` | `nx lint`, verify-Fälle `testing: …` |
| 1b | Spec-Override (`*.spec.ts`, `*.test.ts`, `test-setup.ts`): dieselben Constraints + `type:testing`, auch fremde Domain. `scope:shared` und `type:types` bleiben unverändert | `eslint.config.mjs` → `specDepConstraints` | verify (`allowedInSpec`/`blockedInSpec`) |
| 2 | `bannedExternalImports` msw, vitest, @vitest, @testing-library, playwright in Produktions-Layern + App | `eslint.config.mjs` | verify |
| 3 | Testing-Libs ohne `build`-Target. Import aus Produktionscode scheitert zusätzlich an `enforceBuildableLibDependency`, im Spec-Override ist die Regel aus | `project.json`, Spec-Override | verify (Test-Isolation + Fälle) |
| 4 | `tsconfig.lib.json` schließt Specs aus, `production`-Input schließt `**/*.spec.ts` + `tsconfig.spec.json` aus | Lib-Configs, `nx.json` | verify (Test-Isolation) |
| 5 | `mockServiceWorker.js` nur in `libs/shared/testing/public`, nur per `runnerConfig` bei Testläufen serviert. Kein App-Asset | `vitest-base.config.mts` | verify (keine Datei unter `apps/`, keine testing/msw-Referenz in App-`project.json`) |
| 6 | `nx build client` + Scan des Bundles auf `msw`, `mockServiceWorker`, `setupWorker`, `vitest` | `tools/verify-boundaries.mjs` | verify: 14 Dateien, 0 Treffer |
| 7 | Keine Zyklen, keine `ignoredCircularDependencies` (siehe unten) | Schnitt der Libs | `nx lint`, verify |

### Zyklen

Nx zählt Spec-Imports als Projekt-Kante: `booking-data → booking-testing`. Damit das zyklenfrei bleibt:

- Testing-Libs importieren nur `type:types`, `type:testing` und `scope:shared`. `types` importiert nichts, eine types-Spec gegen testing wäre ein Zyklus und ist blockiert (verify-Fall).
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

`@nx/angular:unit-test` (Nx 23.1) ist **kein anderer Runner**. Es ist ein dünner Wrapper, der `executeUnitTestBuilder` aus `@angular/build` aufruft. Vorher mappt er `@nx/angular:ng-packagr-lite` → `@angular/build:ng-packagr` im Builder-Context. Vitest, Browser-Provider, TestBed-Init und `runnerConfig` bleiben also Angulars Builder. Der Fallback `@nx/vitest` + `@analogjs/vitest-angular` war damit nicht nötig.

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

1. `libs/<d>/testing/project.json`: Tags `scope:<d>`, `type:testing`, `feat:none`, Targets nur `lint` + `typecheck` (**kein** `build`). Dazu `tsconfig.json` wie bei den anderen Libs.
2. `src/fixtures/<x>.fixture.ts` (Builder `aX()`), `src/handlers/<d>.handlers.ts` (`<d>Handlers`, `<d>Scenarios`), `src/index.ts`. Nur `msw`, `@blueprint/<d>/types` und `@blueprint/shared/testing` importieren. Braucht ein Handler ein DTO, gehört es nach `<d>/types`.
3. `tsconfig.base.json` → Pfad `@blueprint/<d>/testing`.
4. In jeder Lib mit Specs: `"test": {}` in der `project.json` und eine `tsconfig.spec.json`.
5. `pnpm verify:boundaries` prüft Tag-Schema und dass das Testing-Projekt kein `build` hat.

## Verifikation

```sh
pnpm exec nx run-many -t build lint test typecheck   # 37 Projekte grün (build 34, lint 37, typecheck 35, test 5)
pnpm verify:boundaries                                # 61/61 Fälle + Tag-Schema + Test-Isolation + client-Bundle
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
| testing: Produktion → testing (Lib / Feature / App) | blockiert | ✅ non-buildable bzw. `type:app`; nur Tags: `type:data`/`type:feature` |
| testing: Spec → eigenes / fremdes Domain-testing / shared/testing | erlaubt | ✅ |
| testing: shared-Spec → Domain-testing, types-Spec → testing, Spec ui → data | blockiert | ✅ `scope:shared` / Circular / `type:ui` |
| testing: testing → data (mit/ohne Zyklus), → api, → fremdes testing | blockiert | ✅ Circular / `type:testing` / `scope:<s>` |
| testing: testing → types / shared/testing | erlaubt | ✅ |
| testing: msw, msw/browser, vitest, @vitest/* in Produktion/App | blockiert | ✅ `bannedExternalImports` |
| testing: msw in testing-Lib / Spec | erlaubt | ✅ |

Zusätzlich wurden echte Verstöße in Quelldateien eingebaut, per `nx lint <projekt>` geprüft und danach zurückgebaut: `booking-ui`, `checkin-feat-history-feature`, `client` und `checkin-feat-checkin-data` schlugen jeweils mit `@nx/enforce-module-boundaries` fehl. Die Kommentare `// boundary-violation-example: …` in den Quellen markieren weitere Verstöße zum Einkommentieren.
