# Hexagon (fwcore) mit reinen Nx-Mitteln

Branch `feat/nx-hexagonal-core` (abgezweigt von `feat/hexagonal-framework-core`). Jede Sheriff-Regel aus dem fwcore-Ansatz ist jetzt eine Nx-Lib-Grenze plus `@nx/enforce-module-boundaries`. **Sheriff ist entfernt**: es bleibt keine Regel *innerhalb* einer Lib übrig (siehe [Intra-Lib](#intra-lib--warum-kein-sheriff-mehr)).

Stand: alle 19 Libs **buildable**; `nx run-many -t build lint typecheck` grün (21 Projekte), `pnpm verify:boundaries` 60/60 Fälle ok.

---

## Lib-Struktur

```
apps/hexagonal-demo            dünne Shell: app.ts, app.config.ts, app.routes.ts
libs/<slice>/                  slice ∈ {booking, customer}
  model            Entitäten + IDs (reines TS, frameworkfrei) — Vokabular von domain und Ports
  domain           Modelle, Regeln, Use-Cases, Signal-Store (Angular ja, I/O nein)
  port-in          öffentliche Fläche (einzige cross-slice Tür)
  port-out         was der Kern braucht (Repo, Clock) — privat
  adapter-driving  UI + Implementierung von port-in
  adapter-driven   In-Memory-Repo, SystemClock (später HTTP)
  providers        Composition-Root (<slice>.providers.ts)
  shell            <slice>.routes.ts — lazy geladen von der App
libs/shared/{types,util,ui}
```

Public API = `src/index.ts`, Alias `@hex/<slice>/<teil>` bzw. `@hex/shared/<teil>` in `tsconfig.base.json`.

## Tag-Schema

| Achse | Werte | Sheriff-Pendant |
|---|---|---|
| Scope | `scope:booking`, `scope:customer`, `scope:shared`; Apps: `app:<name>` | `domain:<slice>`, `shared`, `app:<app>` |
| Type | `type:model`, `type:domain`, `port-in`, `port-out`, `adapter-driving`, `adapter-driven`, `providers`, `shell`, `ui`, `util`, `types` | gleich (`shell` = Slice-Root-Modul) |
| Marker | `port` (port-in), `entry` (shell, providers) | gleich |

Jede Lib hat genau einen `scope:*` und einen `type:*`-Tag — das prüft `tools/verify-boundaries.mjs` (Hygiene-Check).

---

## Mapping Sheriff-Regel → Nx-Konstrukt

| Sheriff (fwcore) | Nx | Wo |
|---|---|---|
| Modul = Ordner | Lib = Ordner mit `project.json` | 17 Libs |
| `encapsulation` / barrel-less | Public API `index.ts` + Path-Alias; relative/Deep-Imports über Lib-Grenzen → `noRelativeOrAbsoluteImportsAcrossLibraries` | eingebaut |
| `root` (main.ts → app/entry) | main.ts gehört zum App-Projekt → gilt `app:*` | eingebaut |
| `'app:*': [sameTag, entry/port/shared]` | `{ sourceTag: 'app:*', onlyDependOnLibsWithTags: ['entry','port','scope:shared'] }`; App → App verbietet Nx selbst (`noImportsOfApps`) | Glob-Tag |
| `entry: anyTag`, `port: anyTag` | keine Constraint nötig — Nx-Constraints schränken nur ein, Marker sind reine Ziel-Tags | — |
| `'domain:*': [sameTag, port/shared]` | eine Constraint pro Slice, generiert: `sliceIsolation(slice)` | Helfer |
| `shared: to === 'shared'` | `scope:shared` → nur `scope:shared` **+ transitiv** `notDependOnLibsWithTags: ['/^scope:(?!shared$)/']` | Regex-Tag |
| `type:domain` → domain, port-in, port-out, util, types | `onlyDependOnLibsWithTags` wie Sheriff **+ transitiv** `notDependOnLibsWithTags: ['/^type:adapter-/','entry']` **+** `allowedExternalImports` | Regex + Externals |
| `type:port-in` → domain, types | + `type:model` (Entitäten liegen jetzt dort) | |
| `type:port-out` → domain, types | **enger:** nur `type:model`, `type:types` — Zyklus-Kante port-out → domain ist verboten | |
| — (Modelle lagen in domain) | `type:model` → nur `type:model`/`types`, `allowedExternalImports: []` | neu |
| `type:adapter-driving` → domain, port-in, ui, util, types | 1:1 + `bannedExternalImports: ['@angular/common/http','rxjs/ajax','rxjs/fetch','rxjs/webSocket']` | |
| `type:adapter-driven` → domain, port-out, util, types | 1:1 | |
| `type:providers: startsWith('type:')` | `onlyDependOnLibsWithTags: ['type:*']` (Scope hält es im eigenen Hexagon) | Glob-Tag |
| Slice-Root `<slice>.routes.ts` (`entry`) | Lib `shell`, `type:shell` → `type:*` | |
| `type:ui` / `util` / `types` | 1:1; `type:types` → nur `type:types` (eigener Scope + `scope:shared`; fremde Slice-Types rot, auch über `port` — Port ist kein `type:types`), zusätzlich `allowedExternalImports: []` | |
| — (kein Pendant) | `allSourceTags: ['scope:shared','type:ui']` → nur `@angular/core`, `@angular/common` | Combo |
| „kein `'*'`"-Workaround | entfällt (siehe unten) | — |
| Kommentar „kein `new Date()`/`fetch` im Kern" | nicht erzwungen — weder Sheriff noch Nx (Limitierung 6) | — |

Vollständige Konfiguration: `eslint.config.mjs` (`moduleBoundaryOptions`, exportiert und vom Verify-Skript wiederverwendet).

---

## Nx-Semantik: AND statt OR — der `'*'`-Workaround existiert nicht

Belegt im installierten Code (`@nx/eslint-plugin@23.1.0`):

- `runtime-lint-utils.js › findConstraintsFor` liefert **alle** Constraints, deren `sourceTag` (bzw. alle `allSourceTags`) zur Quell-Lib passen.
- `enforce-module-boundaries.js`: `for (let constraint of constraints) { … context.report(…); return; }` — **jede** passende Constraint kann den Import allein ablehnen. Keine kann eine andere überstimmen.
- `hasBannedImport` → `depConstraints.find(isConstraintBanningProject)` — ebenfalls: eine verbietende Constraint reicht.

Folge: `{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }` ist in Nx ein No-op. Sheriff 0.19.6 ODER-verknüpft dagegen alle passenden `depRules`-Keys, weshalb fwcore den Catch-all weglassen musste und die `shared`-Freigabe auf der Type-Achse huckepack reiten ließ. Der Fork löst das mit `denyRules`; Nx braucht dafür nichts.

**Beleg:** das Verify-Skript lintet jeden Fall zusätzlich mit angehängtem `'*'`-Catch-all (Spalte `catch-all`) — Ergebnis identisch, 60/60.

Außerdem hat Nx echte Verbote: `notDependOnLibsWithTags` (**transitiv**, `findDependenciesWithTags` prüft alle von der Ziel-Lib erreichbaren Projekte) und `bannedExternalImports`.

## Was Nx besser kann als Upstream-Sheriff

| Nx-Feature | Ersetzt |
|---|---|
| AND über alle Constraints, `notDependOnLibsWithTags` | Fork-Feature `denyRules` |
| `allowedExternalImports` / `bannedExternalImports` pro Tag | Fork-Feature `externalRules` bzw. `no-restricted-imports`-Block mit eigenem Pfad-Matching |
| `notDependOnLibsWithTags` transitiv | nichts — Sheriff prüft nur direkte Kanten. „Der Kern erreicht keinen Adapter, auch nicht über Umwege" |
| Zyklus-Erkennung zwischen Libs | nichts (Sheriff prüft keine Modul-Zyklen) |
| `noImportsOfLazyLoadedLibraries` | nichts — verhindert, dass ein lazy Slice versehentlich eager wird |
| `noImportsOfApps`, Public-API-Zwang | `app:*`-`sameTag`, `encapsulation` |
| `nx affected`, Caching, Graph | — |

## sameTag / Scope-Isolation in Nx

Nx kann nicht „gleicher Scope wie die Quelle" ausdrücken: Tag-Muster (`*`-Glob, `/regex/`) matchen nur gegen Ziel-Tags, ohne Rückbezug. Lösung: pro Scope eine Constraint, generiert aus den Ordnern unter `libs/`:

```js
const slices = readdirSync(new URL("./libs", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name);

const sliceIsolation = (slice) => ({
    sourceTag: `scope:${slice}`,
    onlyDependOnLibsWithTags: [`scope:${slice}`, "port", "scope:shared"],
});
// depConstraints: [...slices.map(sliceIsolation), …]
```

Risiko „Slice ohne Constraint" (dann gälte nur die Type-Achse, still): der Hygiene-Check im Verify-Skript meldet jeden `scope:`/`type:`/`app:`-Tag ohne passende Constraint.

---

## Limitierungen + Lösung

1. **Kein `sameTag`.** → Helfer + Hygiene-Check (oben).
2. **Zyklus `domain ↔ port-out` — aufgelöst durch `model`-Lib.** Früher: Kern injiziert Port-Token, Port spricht Domain-Typen → Lib-Zyklus, per `ignoredCircularDependencies` + „nur `import type`" geduldet. Mit buildable Libs geht das nicht mehr (siehe [Buildable](#buildable-libs)). Jetzt: `model` (Entitäten, IDs, reine Werte-Funktionen wie `totalPrice`) ← `port-out` ← `domain`. Graph ist ein DAG, `ignoredCircularDependencies` und der `no-restricted-imports`-Block sind weg. Siehe Begründung unten.
3. **Zyklus-Check vor Tag-Check.** „domain → eigener adapter-driving" meldet Nx zuerst als *Circular dependency* (der Adapter importiert die Domain ja schon). Rot ist es trotzdem; dass auch die Tag-Constraint greift, zeigt die Spalte `tags-only` (Zyklus-Check neutralisiert).
4. **Lazy-Loading-Granularität = Lib.** Nx verbietet statischen + dynamischen Import derselben Lib. Deshalb sind `providers` und `shell` getrennt: die App importiert `customer-providers` statisch (Port app-weit) und `customer-shell` lazy. Folge: Customer-Seite landet im Initial-Bundle (über providers → adapter-driving); Booking bleibt ein echter Lazy-Chunk. Sheriff/Datei-Ebene war hier feiner.
5. **`notDependOnLibsWithTags` ist transitiv.** Gut für Kern und shared, unbrauchbar für „adapter-driving ↛ port-out": adapter-driving → domain → port-out wäre dann immer rot. Dort daher nur `onlyDependOnLibsWithTags` (direkt).
6. **I/O über Globals** (`new Date()`, `fetch`, `localStorage`) im Kern erkennt weder Sheriff noch Nx — nur Imports. → optional ESLint `no-restricted-globals`/`no-restricted-syntax` auf `**/domain/**` (nicht umgesetzt).
7. **Vergessene Tags.** `projectWithoutTagsCannotHaveDependencies` greift nur, wenn *keine* Constraint passt; eine Lib mit nur `scope:` wäre auf der Type-Achse frei. → Hygiene-Check; bewusst **kein** `'*'`-Catch-all in der Config, damit ungetaggte Libs weiter rot sind.
8. Vorbestehend: `@nx/eslint:lint`-Executor ist in Nx 23 deprecated (Warnung, auch in der Baseline).

## Intra-Lib — warum kein Sheriff mehr

Jedes Sheriff-Modul ist jetzt eine Lib; Sheriff hatte keine Regel *innerhalb* eines Moduls (fwcore erlaubt in `domain/` alles untereinander). Also bleibt nichts, was Nx nicht abdeckt → `sheriff.config.ts`, Plugin und Deps entfernt. Sheriff käme nur zurück, wenn man *innerhalb* von `domain` wieder trennen will (z. B. reine Regeln vs. Store) ohne eine weitere Lib.

## Kosten

| | Sheriff (fwcore) | Nx |
|---|---|---|
| Einheiten | 1 App, 17 Module in einer `sheriff.config.ts` | 17 Libs + 2 Apps |
| Dateien pro Lib | — | `project.json`, `tsconfig.json`, `src/index.ts` + buildable: `package.json`, `ng-package.json`, `tsconfig.lib.json`, `tsconfig.lib.prod.json` (7) |
| Neuer Slice | Einzeiler `hexSlice(...)` | 8 Libs anlegen (→ Generator empfohlen), dann `node tools/make-libs-buildable.mjs`; Constraints entstehen automatisch |
| Gemeinsame Configs | — | `libs/eslint.config.mjs`, `libs/tsconfig.lib.base.json`, `typecheck` + `build` via `targetDefaults` |
| Build | 1 App-Build | 19 ng-packagr-Builds (~0,4–1,5 s je Lib, kalt ~10 s gesamt, parallel), danach Cache/affected pro Lib; `dist/libs` ≈ 0,9 MB |

Gewinn: Caching/affected pro Lib, `typecheck` pro Lib, Externals-Regeln, transitive Verbote, Zyklus-Erkennung — ohne Fork.

---

## Buildable Libs

Jede Lib hat ein `build`-Target mit `@nx/angular:ng-packagr-lite` (incremental buildable, nur ESM2022, full compilation — nicht publishbar, `private: true`). Aufbau wie `nx g @nx/angular:library --buildable`, generiert per `node tools/make-libs-buildable.mjs` (idempotent):

| Datei | Inhalt |
|---|---|
| `project.json` | `build`: `ng-packagr-lite`, `outputs: {workspaceRoot}/dist/{projectRoot}`, `production` → `tsconfig.lib.prod.json` |
| `ng-package.json` | `dest: dist/libs/<slice>/<teil>`, `entryFile: src/index.ts` |
| `package.json` | `name` = Import-Alias `@hex/...`, `private`, `peerDependencies` = importierte Externals (aus Quellen ermittelt) |
| `tsconfig.lib.json` / `.prod.json` | erbt `tsconfig.json` (→ `libs/tsconfig.lib.base.json`), `noEmit: false`, `declaration` |

- `nx.json › targetDefaults.build`: `cache`, `dependsOn: ["^build"]`, `inputs: ["production","^production"]` (gilt auch für App-Builds, ersetzt den alten Executor-Key).
- `enforceBuildableLibDependency: true` (war schon an): buildable Lib darf keine nicht-buildable Lib importieren.
- Pfad-Aliase in `tsconfig.base.json` bleiben **Source**-Aliase; ng-packagr-lite biegt sie beim Build auf `dist/` um. `typecheck`/`lint`/IDE arbeiten weiter gegen Quellen.
- Nebeneffekt lib-`package.json`: Nx' package-json-Plugin mergt sie ins gleiche Projekt (keine neuen Projekte) und setzt Tag `npm:private` — von keiner Constraint erfasst, harmlos.
- Output-Stichprobe `dist/libs/booking/domain`: `esm2022/**/*.js`, `*.d.ts`, `package.json` mit `exports`; Imports auf `@hex/booking/model`, `@hex/booking/port-out`, `@hex/customer/port-in` bleiben extern (nicht gebündelt).
- **App incremental:** `hexagonal-demo` baut mit `@nx/angular:application` + `buildLibsFromSource: false` gegen `dist/` (Lazy-Chunks heißen jetzt `hex-booking-shell`/`hex-customer-shell` = gebaute Pakete). `serve` bleibt `@angular/build:dev-server` → Dev-Server baut aus Quellen (`@nx/angular:dev-server` bräuchte `@angular-devkit/build-angular`). `client` unverändert.
- Lazy-Loading unverändert: Initial 212,9 kB, Booking + Customer als Lazy-Chunks.

### Zyklus `domain ↔ port-out`: warum `model`-Lib

Geprüft: mit dem alten Schnitt (port-out `import type` aus domain) bricht Nx ab — `Could not execute command because the task graph has a circular dependency: booking-domain:build → booking-port-out:build → booking-domain:build`. Unabhängig von Nx kann ng-packagr den Zyklus auch nicht bauen: jede Seite braucht die `.d.ts` der anderen aus `dist/`.

Optionen:

| Option | Bewertung |
|---|---|
| Port-Interfaces + Tokens in `domain` | port-out-Lib entfällt → `adapter-driving → port-out` (Fall 5) nicht mehr prüfbar. **Weicht Regel auf** — nein. |
| port-out typisiert generisch / `unknown` | Port verliert Typsicherheit — nein. |
| `build` für domain/port-out ohne `^build` | Zyklus bleibt, `enforceBuildableLibDependency`/Reihenfolge kaputt — nein. |
| **Entitäten in `model`-Lib** | DAG `model ← port-out ← domain`; Regeln unverändert oder enger. **Gewählt.** |

`model` enthält nur, was Ports sprechen: Entitäten, IDs, reine Werte-Funktionen (`booking.ts`, `customer.ts`). Regeln (`booking-policy`, `loyalty-tier`), Use-Cases und Store bleiben in `domain` — das ist **keine** Rückkehr zu `domain/application`, sondern ein Schnitt „Vokabular vs. Verhalten". Regeln danach:

- `type:model`: nur `type:model`/`types`, **keine** Externals (strenger als domain — frameworkfrei erzwungen).
- `type:port-out`: nur `type:model`/`types` — **enger** als vorher (vorher `type:domain`). port-out → domain ist jetzt per Tag *und* Zyklus rot.
- domain, port-in, adapter-driving, adapter-driven: `+ type:model` — erlaubt nur, was vorher über domain schon erreichbar war.
- Scope-Isolation unverändert: fremdes `model` ist rot (Fall 53), nur `port` ist die Tür.
- Kosten: +2 Libs (1 pro Slice).

### Erwartungswerte angepasst

- **47** `port-out: import type der domain`: grün → **rot**. Grund: die Kante ist genau der Zyklus, der Builds unmöglich macht; port-out spricht jetzt `model` (Fall 48 grün).
- **46** bleibt rot, aber jetzt über `@nx/enforce-module-boundaries` (Tag + Zyklus) statt `no-restricted-imports` (Block entfernt).
- Hygiene: statt „Ignore ist nötig" prüft das Skript jetzt „`ignoredCircularDependencies` leer + Lib-Graph zyklenfrei".

### Boundary-Regel ohne Graph-Cache

`@nx/enforce-module-boundaries` liest nur den **gecachten** Projekt-Graph. Fehlt er (frischer Clone, `nx reset`, direktes `eslint`, lint-staged, IDE), gibt die Regel nur `warning No cached ProjectGraph is available. The rule will be skipped.` aus — **Exit 0, nichts geprüft** (reproduziert). `nx lint` selbst ist nicht betroffen (baut den Graph vorher; echter Verstoß domain → adapter-driven in `nx lint booking-domain` → rot, geprüft). Lösung in `eslint.config.mjs`: außerhalb eines Nx-Tasks (`NX_TASK_TARGET_PROJECT` nicht gesetzt) vorher `createProjectGraphAsync()` — erzeugt/aktualisiert den Cache, also auch keine veralteten Tags. Kosten: ~1–2 s pro ESLint-Start ohne Daemon. Verify-Skript prüft das mit leerem `NX_WORKSPACE_DATA_DIRECTORY` per ESLint-CLI (Mutationsprobe: Fix deaktiviert → FAIL).

---

## Verifikation

```bash
NX_DAEMON=false pnpm exec nx run-many -t build lint typecheck --skip-nx-cache   # 21 Projekte grün
NX_DAEMON=false pnpm exec nx show projects --with-target build                  # 19 Libs + 2 Apps
pnpm verify:boundaries                                                          # 60/60, 0 Hygiene-Probleme
```

Baseline vorher (Sheriff-Stand): `nx run-many -t build lint` grün, 2 Projekte, keine Warnungen.

`tools/verify-boundaries.mjs` lintet je Fall eine virtuelle Datei in der echten Lib (`ESLint#lintText` mit `filePath`, gleiche Flat-Config wie `nx lint`) in drei Varianten: `real`, `tags-only` (Zyklus-Check aus), `catch-all` (+ `'*'`-Constraint). `V#` = Fall aus `libs/booking/domain/src/lib/__violations.example.ts`. Mutationsprobe: `type:*` in die adapter-driving-Constraint eingefügt → Fälle 5 und 6 FAIL. Fälle 54–59: nur eine echte types-Lib (`shared/types`), daher legt das Skript für die Laufzeit zwei Wegwerf-Libs an (nur `project.json`, danach gelöscht). Mutationsprobe: `type:types` → `[]` → Fälle 54 und 55 FAIL.

| # | Fall | erwartet | real | tags-only | catch-all |
|---|---|---|---|---|---|
| 1 | domain → eigener adapter-driven (V3) | rot | rot | rot | rot |
| 2 | domain → eigener adapter-driving | rot | rot | rot | rot |
| 3 | domain → eigener port-out | grün | grün | grün | grün |
| 4 | domain → eigene providers (entry) | rot | rot | rot | rot |
| 5 | adapter-driving → port-out | rot | rot | rot | rot |
| 6 | adapter-driving → adapter-driven | rot | rot | rot | rot |
| 7 | adapter-driving → eigene domain (store) | grün | grün | grün | grün |
| 8 | adapter-driven → port-in | rot | rot | rot | rot |
| 9 | adapter-driven → port-out | grün | grün | grün | grün |
| 10 | port-in → port-out | rot | rot | rot | rot |
| 11 | port-out → adapter-driven | rot | rot | rot | rot |
| 12 | cross-slice: domain → fremde domain (V1) | rot | rot | rot | rot |
| 13 | cross-slice: domain → fremder adapter (V2) | rot | rot | rot | rot |
| 14 | cross-slice: domain → fremder port-in | grün | grün | grün | grün |
| 15 | cross-slice: domain → fremder port-out | rot | rot | rot | rot |
| 16 | cross-slice: domain → fremde shell (entry) | rot | rot | rot | rot |
| 17 | cross-slice: adapter-driving → fremde domain | rot | rot | rot | rot |
| 18 | cross-slice: shell → fremde providers | rot | rot | rot | rot |
| 19 | shell → eigener adapter-driving | grün | grün | grün | grün |
| 20 | providers → eigener adapter-driven | grün | grün | grün | grün |
| 21 | domain → `@angular/core` | grün | grün | grün | grün |
| 22 | domain → HttpClient (V4) | rot | rot | rot | rot |
| 23 | domain → `@angular/router` | rot | rot | rot | rot |
| 24 | domain → `rxjs/ajax` | rot | rot | rot | rot |
| 25 | domain → `rxjs` | grün | grün | grün | grün |
| 26 | adapter-driving → HttpClient | rot | rot | rot | rot |
| 27 | adapter-driven → HttpClient | grün | grün | grün | grün |
| 28 | domain → shared-ui | rot | rot | rot | rot |
| 29 | domain → shared-util | grün | grün | grün | grün |
| 30 | adapter-driving → shared-ui | grün | grün | grün | grün |
| 31 | shared-util → domain | rot | rot | rot | rot |
| 32 | shared-ui → domain | rot | rot | rot | rot |
| 33 | shared-ui → port-in | rot | rot | rot | rot |
| 34 | shared-ui → shared-util | grün | grün | grün | grün |
| 35 | shared-types → shared-util | rot | rot | rot | rot |
| 36 | shared-types → `rxjs` (keine Externals) | rot | rot | rot | rot |
| 37 | shared-ui → `@angular/router` (allSourceTags) | rot | rot | rot | rot |
| 38 | app → shell lazy (entry) | grün | grün | grün | grün |
| 39 | app → shell statisch (lazy Lib) | rot | rot | rot | rot |
| 40 | app → providers statisch (entry) | grün | grün | grün | grün |
| 41 | app → port-in | grün | grün | grün | grün |
| 42 | app → domain | rot | rot | rot | rot |
| 43 | app → adapter-driving | rot | rot | rot | rot |
| 44 | app → fremde App | rot | rot | rot | rot |
| 45 | Deep-Import an Public API vorbei | rot | rot | rot | rot |
| 46 | port-out: Value-Import der Domain | rot | rot | rot | rot |
| 47 | port-out: `import type` der Domain (vorher grün, s. o.) | rot | rot | rot | rot |
| 48 | port-out → eigenes model | grün | grün | grün | grün |
| 49 | domain → eigenes model | grün | grün | grün | grün |
| 50 | adapter-driving → eigenes model | grün | grün | grün | grün |
| 51 | model → domain | rot | rot | rot | rot |
| 52 | model → `@angular/core` (frameworkfrei) | rot | rot | rot | rot |
| 53 | cross-slice: domain → fremdes model | rot | rot | rot | rot |
| 54 | types → types im eigenen Scope (Wegwerf-Lib `shared/verify-types`) | grün | grün | grün | grün |
| 55 | slice-types → shared-types (Wegwerf-Lib `booking/verify-types`) | grün | grün | grün | grün |
| 56 | slice-types → shared-util | rot | rot | rot | rot |
| 57 | slice-types → eigenes model | rot | rot | rot | rot |
| 58 | slice-types → fremdes model (Domain-Types) | rot | rot | rot | rot |
| 59 | slice-types → fremder port-in | rot | rot | rot | rot |
| 60 | model → shared-types | grün | grün | grün | grün |

Beispielmeldungen: `A project tagged with "scope:booking" can only depend on libs tagged with "scope:booking", "port", "scope:shared"` (12) · `A project tagged with "type:domain" is not allowed to import "@angular/common/http"` (22) · `A project tagged with "scope:shared" and "type:ui" is not allowed to import "@angular/router"` (37) · `Static imports of lazy-loaded libraries are forbidden.` (39).

---

## Bewertung: strikter Hexagon mit Nx ohne Fork?

**Ja, machbar — und einfacher als mit Sheriff.** Skizze (nicht umgesetzt):

- **Frameworkfreier Kern** = `type:domain` mit `allowedExternalImports: []`. Ersetzt exakt Fork-`externalRules` / den `no-restricted-imports`-Block — nativ, auf Tag-Ebene statt Pfad-Glob.
- **Keine `core:<slice>`-Achse nötig.** Die existierte nur, weil Sheriff-`domain:*` den Kern „aufweichen" konnte (OR). In Nx gilt AND; der Kern bekommt einfach die engere Constraint.
- **Ohne `application`-Zwang?** Nur teilweise. Use-Cases können frameworkfrei im Kern liegen (Konstruktor-Parameter statt `inject()`, Verdrahtung in `providers` per `useFactory: () => new BookRoomUseCase(inject(BOOKING_REPOSITORY), …)`). Out-Port-*Interfaces* gehören dann in den Kern (reines TS; der `domain ↔ port-out`-Zyklus ist ohnehin schon per `model`-Lib weg); `InjectionToken`s wandern in eine dünne Token-Lib oder nach `providers`. Der **Signal-Store** braucht aber Angular und passt nicht in einen frameworkfreien Kern: er landet entweder in `adapter-driving` (UI-State) oder in einer eigenen Lib — dann ist das de facto wieder `application`. Ehrliche Antwort: `application` ist nicht Pflicht für Use-Cases, aber für einen geteilten Store.
- Kosten: 1–2 Libs mehr pro Slice; alles andere wie hier.

## Offen

- Generator für „neuer Slice" (7 Libs + Tags), sonst ist die Lib-Anzahl der Haupt-Reibungspunkt.
- Kern-Globals (`new Date()`, `fetch`) per `no-restricted-globals` absichern? (Limitierung 6)
- `@nx/eslint:lint` → inferred Targets migrieren (`nx g @nx/eslint:convert-to-inferred`).
