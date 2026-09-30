# Vertical Slice (invertiert) mit reinen Nx-Mitteln

Der Ansatz aus [`architecture.md`](https://github.com/michaelbe812/sheriff-demos/blob/feat/nx-inverted-domain-ports/docs/architecture.md) — gleiche Layer-Matrix, gleiche Ports — nur **ohne Sheriff**. Stattdessen: eine Nx-Lib pro Slice × Layer, Tags in `project.json`, `@nx/enforce-module-boundaries` in `eslint.config.mjs`.

**Ergebnis:** Jede Sheriff-Regel ist in Nx abgebildet. Sheriff ist komplett raus, auch für Regeln *innerhalb* einer Lib: Es gibt keine mehr, die man prüfen müsste (Begründung siehe [Entscheidungen](#entscheidungen)). `packages/sheriff-blueprint` bleibt als Referenz im Repo, das Workspace nutzt es aber nicht mehr.

## Lib-Struktur

```
libs/
  shared/{types,utils,api,ui}              scope:shared
  auth/{api,data,shell}                    scope:auth       (Shared-Feature)
  layout/{ui,shell}                        scope:layout     (Shared-Feature)
  booking/                                 scope:booking
    types utils events api infra data ui   je eine Lib, slice-shared
    shell                                  Slice-Root: Routes + provideBooking()
    feat-check-booking/                    scope:booking/feat-check-booking
      feature                              Smart Container (lazy geladen)
      api                                  feat-port
      data ui                              feat-lokal, nur weil vorhanden
    feat-manage-booking/feature
  checkin/                                 analog; feat-checkin/{feature,api,data}, feat-history/feature
apps/client                                type:app — nur app.ts, app.config.ts, app.routes.ts, main.ts
```

- Jede Lib: `project.json` (Tags, `build`), `src/index.ts` (Public API), **ein** exakter Path in `tsconfig.base.json` → `index.ts`. Kein Wildcard. Dazu die Build-Dateien (siehe [Buildable](#buildable)).
- Alias = Pfad ohne `libs/`: `@blueprint/booking/data`, `@blueprint/booking/feat-check-booking/feature`, `@blueprint/booking/feat-check-booking/api`. Das `/feature` bleibt im Alias, sonst baut ng-packagr nicht (siehe [Buildable](#buildable)).
- Die **Shell-Lib** ist der Slice-Root: Sie verdrahtet Port → Impl (`provideX()`) und lädt die Feats lazy (`loadComponent`). Die App importiert Shells statisch. Die Lazy-Grenze ist die Feat-Lib.

## Tag-Schema

| Tag | an | Bedeutung |
|---|---|---|
| `scope:<slice>` | slice-shared Libs + Shell | Domain oder Shared-Feature |
| `scope:<slice>/feat-<f>` | alle Libs **eines** Feats | hierarchisch: Feat gehört zur Slice |
| `scope:shared` | `libs/shared/*` | dummer Shared-Bereich |
| `type:<layer>` | jede Lib genau einer | types, utils, events, api, infra, data, ui, feature, shell |
| `type:app` | Apps | Composition Root der App |
| `type:tooling` | `packages/*` | außerhalb der App-Architektur, darf nur `type:tooling` |
| `npm:private` / `npm:public` | automatisch von Nx aus `package.json` | ohne Constraint, wirkungslos |
| `port` | `<slice>/api` | einzige Lib, die fremde Scopes nutzen dürfen |
| `feat-port` | `<slice>/feat-<f>/api` | einzige Feat-Lib, die Geschwister-Feats nutzen dürfen |

`eslint.config.mjs` prüft beim Laden: Jede Lib hat genau einen `scope:*`- und genau einen bekannten `type:*`-Tag. Sonst bricht die Config mit einem Fehler ab.

## Mapping Sheriff-Regel → Nx-Konstrukt

| Sheriff (Blueprint) | Nx | Wo |
|---|---|---|
| Layer-Matrix `type:*` | ein `onlyDependOnLibsWithTags` pro `type:*` | `layerMatrix` |
| `types → types` (vorher `noDependencies`) | `onlyDependOnLibsWithTags: ['type:types']`; Scope-Achse gilt weiter: eigener Slice + `scope:shared`, fremde Slice-Types rot (`port` ist `type:api`) | `layerMatrix` |
| **api ↛ infra** (Inversion) | `type:api` ohne `type:infra` **und** Nx-Zyklus-Check (infra → api existiert immer) | `layerMatrix` |
| Self-Providing Port (`fe846c0`, api → infra erlaubt) | **nicht abbildbar**: api ↔ infra wäre ein Projekt-Zyklus. Zurückgedreht auf harte Inversion (`f54d797`) | – |
| data ↛ infra | `type:data` ohne `type:infra` | `layerMatrix` |
| ui ↛ api, data | `type:ui` ohne beide | `layerMatrix` |
| feat ↛ infra, nur Slice-Root wired (`inAnyFeat`-Pfadhack) | eigene Lib `type:shell`: darf infra, `type:feature` nicht. **Kein Pfadhack nötig** | `layerMatrix` |
| `domain:*` mit `sameTag` (Scope-Isolation) | generiert: 1 Constraint pro Slice, Regex-Tag `/^scope:<s>(\/.*)?$/` → eigene Slice + `port` + `scope:shared` | `sliceIsolation` |
| Port = Tag `port` auf `api/` | Tag `port` auf `<slice>/api` | `project.json` |
| `feat:*` (eigenes Feat, Nicht-Feat, Geschwister nur `feat-port`) | generiert: 1 Constraint pro Feat-Scope | `featIsolation` |
| feat-port nie außerhalb der Domain | `sliceIsolation` blockt fremde feat-ports (kein `port`-Tag) | `sliceIsolation` |
| Shared-Features auth/layout (`sharedFeatures`) | normale Scopes, automatisch aus Tags abgeleitet — keine Liste | `readLibTags` |
| `shared → shared` | `scope:shared → scope:shared` | `scopeAxis` |
| AND-Semantik, Marker `anyTag` | Nx: alle passenden Constraints müssen erfüllt sein; Marker ohne eigene Constraint sind automatisch transparent | nativ |
| kein `'*': 'shared'`-Catch-all | kein `sourceTag: '*'` | `depConstraints` |
| `app:*` → entry, port, shared | `type:app → type:shell, port, scope:shared` | `scopeAxis` |
| `root` (main.ts) | Teil des App-Projekts | – |
| App-Isolation `sameApp` | nativ: `noImportsOfApps` und keine relativen Imports über Projektgrenzen. Libs sind app-frei | nativ |
| `noTag: noDependencies` | ohne passende Constraint: `projectWithoutTagsCannotHaveDependencies`, dazu die Tag-Validierung | nativ + `readLibTags` |
| `internal/` (encapsulation) | nicht in `index.ts` exportiert = lib-privat; Deep-Import → `no-restricted-imports` | `index.ts`, ESLint |
| Bucket-Barrel `api/index.ts` | `index.ts` jeder Lib | – |
| ui-lokaler Store | intra-lib, ungeprüft (wie bei Sheriff) | – |
| Module-Matching (first-match-wins, Key-Reihenfolge) | entfällt: Zuordnung über `project.json` | – |

**Strenger als Sheriff** (bewusst):

- `featPrivacy`: slice-shared Libs dürfen nicht in Feat-Libs greifen, nur die Shell. Sheriff hat das nicht verhindert (`data → feat-x/data` war erlaubt).
- `bannedExternalImports`: `@angular/common/http*` nur in `type:infra` und `type:app`.
- Projekt-Zyklen, Lazy-Load-Check (statischer Import einer lazy geladenen Lib), relative Imports über Lib-Grenzen.

## depConstraints

Vollständig in `eslint.config.mjs`. Drei Achsen, alle AND-verknüpft:

```js
typeAxis     // 9 Constraints: layerMatrix
scopeAxis    // generiert aus Tags: sliceIsolation + featPrivacy pro Slice,
             // featIsolation pro Feat, shared, app, tooling
externalAxis // { sourceTag: '/^type:(?!infra$|app$)/', bannedExternalImports: ['@angular/common/http*'] }
```

Generiert für `booking`:

```js
{ sourceTag: '/^scope:booking(\\/.*)?$/', onlyDependOnLibsWithTags: ['/^scope:booking(\\/.*)?$/', 'port', 'scope:shared'] }
{ allSourceTags: ['scope:booking', '/^type:(?!shell$)/'], onlyDependOnLibsWithTags: ['scope:booking', 'port', 'scope:shared'] }
{ sourceTag: 'scope:booking/feat-check-booking',
  onlyDependOnLibsWithTags: ['scope:booking/feat-check-booking', 'scope:booking', 'feat-port', 'port', 'scope:shared'] }
```

### `sameTag` / Scope-Isolation in Nx

Nx kennt kein `sameTag` und keine Platzhalter, die sich auf das Quell-Tag beziehen. Die Lösung:

1. **Eine Constraint pro Scope**, erzeugt von einer Helfer-Funktion (`sliceIsolation`, `featIsolation`).
2. **Scopes werden nicht gepflegt, sondern gelesen:** `readLibTags()` sammelt alle `scope:*`-Tags aus `libs/**/project.json`. Ein neuer Slice ist abgedeckt, sobald seine `project.json` existiert. Eine vergessene Listen-Zeile, die still die Isolation aushebelt, gibt es nicht.
3. **Regex-Tags** (`/…/` in `sourceTag`/`onlyDependOnLibsWithTags`, im installierten `runtime-lint-utils.js` geprüft) fassen eine Slice **mit** ihren Feats zusammen: `/^scope:booking(\/.*)?$/`.
4. **Negation per Lookahead:** Nx kann „alle außer" nicht ausdrücken. `'/^type:(?!shell$)/'` in `allSourceTags` trifft jede Lib der Slice außer der Shell (`featPrivacy`).

`notDependOnLibsWithTags` wird bewusst **nicht** genutzt. Die Regel prüft transitiv (`findDependenciesWithTags` läuft über den ganzen Graph). Ein Feat, das einen feat-port nutzt, der selbst von Feat-Interna abhängt, wäre dann rot, obwohl der direkte Import erlaubt ist. `onlyDependOnLibsWithTags` prüft nur die direkte Kante, genau wie Sheriff.

## Entscheidungen

**Feat-lokale Unterordner → eigene Libs** (`feat-check-booking/{feature,api,data,ui}`), aber nur, wenn es den Bucket gibt.

- Der **feat-port muss** eine eigene Lib sein: Er ist die einzige öffentliche Fläche des Feats gegenüber Geschwistern. Nx kann Sichtbarkeit nur zwischen Libs steuern.
- `data`/`ui` im Feat als eigene Libs: Nur so greift die Layer-Matrix auch im Feat (feat-ui ↛ feat-data). Die Alternative wäre Sheriff nur für Feat-Interna. Das kostet eine zweite Regelsprache und eine zweite Tag-Zuordnung für Code, den Nx schon taggt. Im Beispiel sind es 3 zusätzliche Libs. Das ist billiger.
- Ein Feat **ohne** Unter-Buckets bleibt eine Lib (`feat-manage-booking/feature`). Darin gibt es keine Layer, also auch nichts zu prüfen.

**Sheriff entfernt.** Alle intra-lib-Regeln des Blueprints sind weggefallen:

- Die Layer liegen jetzt in getrennten Libs.
- `internal/` ist durch `index.ts` ersetzt.
- ui-lokale Stores waren bei Sheriff ebenfalls ungeprüft.

Gelöscht: `sheriff.config.ts`, `@softarc/eslint-plugin-sheriff`, `packages/sheriff-blueprint/tests/e2e.spec.ts` (testete genau diese Workspace-Integration; ersetzt durch `tools/verify-boundaries.mjs`). `@softarc/sheriff-core` bleibt, weil das Package dagegen baut.

**Harte Inversion statt Self-Providing Port.** `booking/api` nennt `HttpBookingApi` nicht mehr. `provideBooking()` in `booking/shell` bindet das Token, `app.config.ts` ruft es auf. Der Grund: Sobald api und infra getrennte Libs sind, ist api → infra → api ein Projekt-Zyklus. Den meldet Nx immer, unabhängig von Tags.

## Was Nx besser kann

- **Slice-Root vs. Feat per Tag statt per Dateipfad.** Die Shell ist eine eigene Lib (`type:shell`). Der `inAnyFeat`-Pfadhack entfällt, genau wie die Abhängigkeit vom `fromTags`-Kontext des Forks.
- **Projekt-Zyklen** werden erkannt (Sheriff: nein). Damit ist die Inversion doppelt abgesichert.
- **npm-Regeln** über `bannedExternalImports`/`allowedExternalImports`. Das kann Sheriff Upstream nicht, nur der Fork mit `externalRules`.
- **Public API erzwungen:** `index.ts` + exakter Path. Relative Imports über Lib-Grenzen sind verboten. Der Lazy-Load-Check ist aktiv (`checkDynamicDependenciesExceptions` entfernt).
- **Eine Regelsprache**, dazu Projektgraph, `affected` und Lint-Cache pro Lib. Keine Key-Reihenfolge, keine Guard-Funktionen mit eigenem Code (`sameApp`, `inAnyFeat`).

## Limitierungen und Lösung

| Limitierung | Lösung |
|---|---|
| Nur **Lib-Granularität**: Imports innerhalb einer Lib werden nie geprüft | Lib pro Slice × Layer (und pro Feat-Bucket). Konvention: keine Layer innerhalb einer Lib mischen |
| Kein `sameTag` / Quell-Platzhalter | generierte Constraint pro Scope, Scopes aus Tags gelesen |
| Keine Negation | Regex-Lookahead (`/^type:(?!shell$)/`). Das funktioniert, liest sich aber schlecht, deshalb kommentiert |
| **Self-Providing Port** unmöglich (Zyklus) | harte Inversion + `provideX()` in der Shell. Alternative: api + infra in **einer** Lib, nur der Contract in `index.ts`. Dann ist infra lib-privat, aber `type:infra` nicht mehr separat taggbar und HttpClient wäre im Port erlaubt → verworfen |
| **Zyklus-Meldung verdeckt Tag-Meldung**: Nx prüft Zyklen vor Tags. „api → infra" meldet „Circular dependency", nicht „type:api" | `verify-boundaries.mjs` wertet zusätzlich die Tag-Constraints direkt gegen den Projektgraph aus. Belegt: auch der Tag blockt |
| **Deep Imports** (`@blueprint/x/data/src/…`) matchen keinen Path. Nx findet kein Zielprojekt und prüft **gar nicht** (nur tsc scheitert später) | ESLint-Core `no-restricted-imports` mit `@blueprint/**/src/**` |
| `bannedExternalImports` sieht nur Imports: `fetch()` im data-Layer fällt nicht auf | Konvention/Review. HTTP-Clients gehören in infra |
| Fehlermeldungen listen Tags statt Regelnamen | Kommentare in `eslint.config.mjs`; Tag-Namen sprechend gewählt |
| Regel liest **nur den gecachten Projektgraph**. Ohne Cache (frischer Clone, `eslint` direkt, IDE) überspringt sie still mit Warnung (Exit 0). Mit veraltetem Cache kennt sie neue Libs nicht | `eslint.config.mjs` ruft beim Laden `await createProjectGraphAsync()` auf: Graph wird pro ESLint-Prozess gebaut/aktualisiert, Fehler brechen die Config ab statt zu überspringen. Kosten ≈0,4 s pro ESLint-Start ohne Daemon |
| noTag-Fall braucht ein Projekt ohne Tags, alle echten Projekte sind getaggt | `verify-boundaries.mjs` legt `tools/verify-untagged/project.json` nur für den Lauf an und räumt danach auf |
| **Viele Libs** (s. Kosten) | Generator nötig (offen) |

## Kosten

| | vorher (Sheriff) | Nx |
|---|---|---|
| Libs | 2 (`domain-booking`, `shared-utils`) + App-intern | **34** + App + Tooling-Package |
| Quell-Dateien in libs | – | 39, davon viele Libs mit **einer** Datei |
| Boilerplate pro Lib | – | `project.json`, `tsconfig.json`, `index.ts`, 1 Path, dazu buildable `tsconfig.lib.json`, `tsconfig.lib.prod.json`, `ng-package.json`, `package.json` = 8 Artefakte → **272** |
| Regel-Config | `sheriff.config.ts` + Package (≈250 Z.) | `eslint.config.mjs` ≈190 Z. inkl. Helfer |
| Tests | 12 e2e über Sheriff CLI + ESLint | 47 Fälle in `tools/verify-boundaries.mjs` |

Die Boilerplate ist mechanisch. Wer sie ernsthaft betreibt, braucht einen Nx-Generator (`slice`, `layer`, `feat`). Die vorhandenen Generatoren in `packages/sheriff-blueprint` erzeugen noch das Sheriff-Layout.

## Buildable

Jede Lib hat ein `build`-Target mit `@nx/angular:ng-packagr-lite` (incremental buildable, wie `nx g @nx/angular:library --buildable`). Die Lib baut einzeln gegen den `dist/`-Output ihrer Abhängigkeiten.

- `project.json` bleibt schlank: `"build": { "executor": "@nx/angular:ng-packagr-lite" }`. Optionen, `dependsOn: ["^build"]`, `cache`, `inputs`, `outputs` stehen in `nx.json` unter `targetDefaults.build` (Array-Eintrag mit `filter.executor`, damit App- und Package-Builds unberührt bleiben). `{projectRoot}` wird aufgelöst.
- Pro Lib: `ng-package.json` (`dest` → `dist/<projectRoot>`), `package.json` (Name = Import-Alias, `private: true`, Angular/rxjs als `peerDependencies`), `tsconfig.json` (Solution-Style) + `tsconfig.lib.json` + `tsconfig.lib.prod.json`. `ng-packagr` ist devDep (`~22.0.2`).
- Erzeugt per `node tools/make-libs-buildable.mjs` (idempotent, liest Alias aus `tsconfig.base.json`, Peer-Deps aus den Imports). Nach einer neuen Lib erneut ausführen.
- `tsconfig.base.json` bleibt Source-Alias. ng-packagr-lite biegt die Pfade der Abhängigkeiten nur für den Lib-Build auf `dist/` um.
- `enforceBuildableLibDependency` ist an. Da jetzt alle Libs buildable sind, feuert es nur noch bei einer neuen Lib ohne `build`.
- Output (`dist/libs/booking/shell`): `esm2022/*.js`, `*.d.ts`, `package.json` mit `exports`. Full-Compilation-Mode, kein FESM: für den Workspace, **nicht publizierbar** (`prepublishOnly` bricht ab, dazu `private`).

**Alias-Änderung `…/feat-x` → `…/feat-x/feature`.** ng-packagr hält jeden Import `<eigener Paketname>/…` für einen Secondary Entry Point des eigenen Pakets. `@blueprint/booking/feat-check-booking` importiert `@blueprint/booking/feat-check-booking/data` → Build-Fehler „Entry point … doesn't exist". Kein Paketname darf Präfix eines anderen sein. Deshalb heißen alle vier Feat-Root-Libs jetzt wie ihr Pfad. Geändert: 4 Paths, die `loadComponent`-Imports in den Shells, 2 Import-Strings im Verify-Skript. depConstraints und Erwartungswerte unverändert.

**Kosten:** 4 Dateien mehr pro Lib (136 zusätzlich), `run-many -t build` für 34 Libs + App ≈17 s kalt (ohne Cache), danach aus dem Nx-Cache. Einzelne Lib: ≈0,4–2 s.

**Lazy-Loading** unverändert: Die App baut weiter aus Source (`@angular/build:application`), die Feats bleiben eigene Lazy-Chunks. Die Shell-Libs behalten die dynamischen `import()`s im `dist`-Output.

**Option: App incremental gegen `dist/`.** Getestet: `client:build` auf `@nx/angular:application` mit `buildLibsFromSource: false` baut grün, die Feats bleiben Lazy-Chunks (Chunk-Namen `blueprint-…-feature` aus `dist`). Nicht umgesetzt: `serve` müsste auf `@nx/angular:dev-server` wechseln, die `targetDefaults` für den App-Build hängen am Executor-Key, und bei 34 Mini-Libs bringt es kaum Zeit.

## Verifikation

```sh
NX_DAEMON=false pnpm exec nx run-many -t build lint test typecheck --skip-nx-cache  # 36 Projekte grün
pnpm exec nx show projects --with-target build   # 34 Libs + client + sheriff-blueprint
pnpm verify:boundaries                           # 52/52, Exit 0 (`-- --markdown` für die Tabelle)
```

Das Skript lintet eine Import-Zeile per `ESLint#lintText` mit virtuellem `filePath` in der jeweiligen Lib. Auf die Platte kommen nur zwei Wegwerf-Projekte für die Laufzeit: `tools/verify-untagged` (noTag) und `libs/booking/verify-types` (zweite types-Lib im Slice, für types → types im eigenen Scope). Geprüft wird, ob `@nx/enforce-module-boundaries` (bzw. `no-restricted-imports`) feuert. Die zweite Spalte „Tag-Entscheid" wertet die `depConstraints` direkt aus. Mutationsprobe: `sliceIsolation` entfernt und infra in `type:api` erlaubt → Fälle 3 und 32 rot, Skript Exit 1. Gegenprobe im echten Lint: `import '@blueprint/booking/infra'` in `feat-check-booking/feature` → `nx lint booking-feat-check-booking` rot, `eslint <datei>` ohne Graph-Cache ebenfalls rot.

| # | Regel | von | Import | erwartet | ESLint | Tag-Entscheid |
|---|---|---|---|---|---|---|
| 1 | feat -> infra | `booking/feat-check-booking/feature` | `@blueprint/booking/infra` | red | ✅ red — tags | blocked by type:feature |
| 2 | shell -> infra (wiring) | `booking/shell` | `@blueprint/booking/infra` | green | ✅ green | allowed |
| 3 | api -> infra | `booking/api` | `@blueprint/booking/infra` | red | ✅ red — cycle | blocked by type:api |
| 4 | data -> infra | `booking/data` | `@blueprint/booking/infra` | red | ✅ red — tags | blocked by type:data |
| 5 | data -> api (port) | `booking/data` | `@blueprint/booking/api` | green | ✅ green | allowed |
| 6 | infra -> api (implements) | `booking/infra` | `@blueprint/booking/api` | green | ✅ green | allowed |
| 7 | ui -> api | `booking/ui` | `@blueprint/booking/api` | red | ✅ red — tags | blocked by type:ui |
| 8 | ui -> data | `booking/ui` | `@blueprint/booking/data` | red | ✅ red — tags | blocked by type:ui |
| 9 | ui -> events | `booking/ui` | `@blueprint/booking/events` | green | ✅ green | allowed |
| 10 | types -> own-scope types | `booking/verify-types` | `@blueprint/booking/types` | green | ✅ green | allowed |
| 11 | types -> shared types | `booking/types` | `@blueprint/shared/types` | green | ✅ green | allowed |
| 12 | types -> utils | `booking/types` | `@blueprint/booking/utils` | red | ✅ red — cycle | blocked by type:types |
| 13 | types -> shared utils | `booking/types` | `@blueprint/shared/utils` | red | ✅ red — tags | blocked by type:types |
| 14 | types -> foreign types | `checkin/types` | `@blueprint/booking/types` | red | ✅ red — tags | blocked by /^scope:checkin(\/.*)?$/, scope:checkin + /^type:(?!shell$)/ |
| 15 | types -> foreign port | `checkin/types` | `@blueprint/booking/api` | red | ✅ red — tags | blocked by type:types |
| 16 | utils -> events | `booking/utils` | `@blueprint/booking/events` | red | ✅ red — tags | blocked by type:utils |
| 17 | events -> data | `booking/events` | `@blueprint/booking/data` | red | ✅ red — cycle | blocked by type:events |
| 18 | infra -> data | `booking/infra` | `@blueprint/booking/data` | red | ✅ red — tags | blocked by type:infra |
| 19 | feature -> shell | `booking/feat-manage-booking/feature` | `@blueprint/booking/shell` | red | ✅ red — cycle | blocked by type:feature |
| 20 | feature -> data/ui/events | `booking/feat-manage-booking/feature` | `@blueprint/booking/data` | green | ✅ green | allowed |
| 21 | cross-scope internals | `checkin/data` | `@blueprint/booking/data` | red | ✅ red — tags | blocked by /^scope:checkin(\/.*)?$/, scope:checkin + /^type:(?!shell$)/ |
| 22 | cross-scope infra | `checkin/feat-checkin/data` | `@blueprint/booking/infra` | red | ✅ red — tags | blocked by type:data, /^scope:checkin(\/.*)?$/, scope:checkin/feat-checkin |
| 23 | cross-scope via port | `checkin/data` | `@blueprint/booking/api` | green | ✅ green | allowed |
| 24 | shared-feature internals | `checkin/feat-checkin/feature` | `@blueprint/auth/data` | red | ✅ red — tags | blocked by /^scope:checkin(\/.*)?$/, scope:checkin/feat-checkin |
| 25 | shared-feature via port | `checkin/feat-checkin/feature` | `@blueprint/auth/api` | green | ✅ green | allowed |
| 26 | shell -> foreign shell | `checkin/shell` | `@blueprint/booking/shell` | red | ✅ red — tags | blocked by type:shell, /^scope:checkin(\/.*)?$/ |
| 27 | sibling feat internals | `booking/feat-manage-booking/feature` | `@blueprint/booking/feat-check-booking/data` | red | ✅ red — tags | blocked by scope:booking/feat-manage-booking |
| 28 | sibling feat root | `booking/feat-manage-booking/feature` | `@blueprint/booking/feat-check-booking/feature` | red | ✅ red — tags | blocked by type:feature, scope:booking/feat-manage-booking |
| 29 | feat -> own feat-local lib | `booking/feat-check-booking/feature` | `@blueprint/booking/feat-check-booking/data` | green | ✅ green | allowed |
| 30 | feat-port -> own feat data | `booking/feat-check-booking/api` | `@blueprint/booking/feat-check-booking/data` | red | ✅ red — tags | blocked by type:api |
| 31 | sibling feat via feat-port | `booking/feat-manage-booking/feature` | `@blueprint/booking/feat-check-booking/api` | green | ✅ green | allowed |
| 32 | foreign feat-port | `checkin/feat-history/feature` | `@blueprint/booking/feat-check-booking/api` | red | ✅ red — tags | blocked by /^scope:checkin(\/.*)?$/ |
| 33 | slice-shared -> feat lib | `booking/data` | `@blueprint/booking/feat-check-booking/data` | red | ✅ red — cycle | blocked by scope:booking + /^type:(?!shell$)/ |
| 34 | shell -> feat (lazy) | `booking/shell` | `@blueprint/booking/feat-check-booking/feature` | green | ✅ green | allowed |
| 35 | shared -> slice port | `shared/utils` | `@blueprint/booking/api` | red | ✅ red — tags | blocked by type:utils, scope:shared |
| 36 | shared utils -> shared api | `shared/utils` | `@blueprint/shared/api` | red | ✅ red — tags | blocked by type:utils |
| 37 | slice -> shared | `booking/utils` | `@blueprint/shared/utils` | green | ✅ green | allowed |
| 38 | app -> data | `apps/client` | `@blueprint/booking/data` | red | ✅ red — tags | blocked by type:app |
| 39 | app -> infra | `apps/client` | `@blueprint/booking/infra` | red | ✅ red — tags | blocked by type:app |
| 40 | app -> feat-port | `apps/client` | `@blueprint/booking/feat-check-booking/api` | red | ✅ red — tags | blocked by type:app |
| 41 | app -> shell / port / shared | `apps/client` | `@blueprint/booking/shell` | green | ✅ green | allowed |
| 42 | lib -> app | `booking/data` | `../../../../apps/client/src/app/app` | red | ✅ red — relative import | – |
| 43 | relative import across libs | `booking/feat-manage-booking/feature` | `../../../data/src/booking.store` | red | ✅ red — relative import | – |
| 44 | deep import into lib | `checkin/feat-history/feature` | `@blueprint/checkin/data/src/internal/checkin.mapper` | red | ✅ red — no-restricted-imports (deep) | – |
| 45 | deep import cross-scope | `checkin/data` | `@blueprint/booking/data/src/booking.store` | red | ✅ red — no-restricted-imports (deep) | – |
| 46 | untagged project (noTag) | `tools/verify-untagged` | `@blueprint/shared/utils` | red | ✅ red — tags | blocked (no constraint = noTag) |
| 47 | tooling -> lib | `packages/sheriff-blueprint` | `@blueprint/shared/utils` | red | ✅ red — tags | blocked by type:tooling |
| 48 | HttpClient in data | `booking/data` | `@angular/common/http` | red | ✅ red — bannedExternalImports | – |
| 49 | HttpClient in feature | `booking/feat-check-booking/feature` | `@angular/common/http` | red | ✅ red — bannedExternalImports | – |
| 50 | HttpClient in api | `booking/api` | `@angular/common/http` | red | ✅ red — bannedExternalImports | – |
| 51 | HttpClient in infra | `booking/infra` | `@angular/common/http` | green | ✅ green | – |
| 52 | HttpClient in app | `apps/client` | `@angular/common/http` | green | ✅ green | – |

Dazu im Code: auskommentierte `// nx-violation-example:`-Zeilen (z. B. `apps/client/src/app/app.ts`). Einkommentieren ⇒ Lint-Fehler.
