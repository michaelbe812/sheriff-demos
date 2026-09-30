# @blueprint/tooling

Lokales Nx-Plugin des Blueprints (Branch `feat/nx-blueprint`). Alles, was die Libs ohne eigene Config-Dateien brauchen, an einem Ort:

| Teil | Datei(en) | Aufgabe |
|---|---|---|
| Crystal-Plugin | `src/plugin/blueprint-libs.ts`, `src/plugin/lib-conventions.ts` | macht jeden Ordner `libs/<scope>/<layer>` bzw. `libs/<scope>/feat-<f>/<layer>` mit `src/index.ts` zu einem Projekt (Name, Tags, Alias, Targets). Unbekannter Layer oder Scope → Graph-Fehler |
| Executoren | `src/executors/ng-lib/*`, `executors.json` | `ng-lib-build`, `ng-lib-application`, `ng-lib-test`: erzeugen `ng-package.json`, `package.json`, tsconfig temporär unter `tmp/ng-lib/` und delegieren an `@nx/angular` |
| Generatoren | `src/generators/*`, `generators.json` | domain, layer, feat, testing, move, rename, remove, component, service, store |
| Sync-Generator | `src/sync/app-routes` | `nx sync` / `nx sync:check`: Slice-Shells ↔ `app.routes.ts` |
| Skripte | `scripts/*.mjs` | `typecheck-lib` (Target `typecheck` der Libs), `verify-boundaries` (Target `tooling:verify`), `verify-nx-internals` (nach `nx migrate`) |

Das Package ist selbst ein Nx-Projekt `tooling` (`type:tooling`, Constraint `type:tooling` → nur `type:tooling`). Es hat eine `project.json` und `package.json`; die Zero-Config-Regel gilt nur für `libs/`.

## Laden ohne Build

`package.json` → `main` zeigt direkt auf `src/plugin/blueprint-libs.ts`, Generatoren und Executoren sind ebenfalls Quellen (TS bzw. CJS). Die Root-`package.json` verlinkt das Package per `"@blueprint/tooling": "workspace:*"`, Nx 23 löst es darüber auf und registriert für `.ts` seinen eigenen Transpiler (swc), genau wie vorher für `./tools/nx-plugins/blueprint-libs.ts`.

**Entscheidung: kein Build-Schritt.** Begründung:

- Kein veraltetes `dist/` möglich: Plugin, Generatoren und Executoren sind immer der aktuelle Stand, auch direkt nach `git pull`.
- Keine Henne-Ei-Frage: das Plugin wird für *jede* Graph-Berechnung gebraucht, auch für die, die ein `tooling:build` erst planen würde.
- Kosten: Das Plugin darf `@nx/devkit` nur als `import type` nutzen (Laufzeit-Import kostet ~0,5 s pro Graph im Plugin-Worker) und keine TS-Features, die swc nicht versteht. `lib-conventions.ts` hat deshalb gar keine Imports. Generatoren dürfen alles.

Nach dem ersten Checkout bzw. nach `git pull` einmal `pnpm install` (Symlink `node_modules/@blueprint/tooling`).

## Generatoren

Alle arbeiten über die Tree-API, sind idempotent (bestehende Dateien bleiben unangetastet) und formatieren mit `formatFiles` (Prettier, `.prettierrc`: `printWidth 120`). Positionsargumente wie gezeigt, fehlende werden abgefragt (`x-prompt`), `--dry-run` geht überall.

```sh
nx g @blueprint/tooling:domain payment                       # libs/payment/{types,api,data,ui,shell,testing} + Spec, Route, Scope
nx g @blueprint/tooling:domain notes --layers=types,utils --testing=false
nx g @blueprint/tooling:layer payment events                 # libs/payment/events
nx g @blueprint/tooling:feat payment checkout --api --data --ui   # libs/payment/feat-checkout/{feature,api,data,ui} + Shell-Route
nx g @blueprint/tooling:testing checkin                      # nur libs/checkin/testing (fixtures, handlers, scenarios)
nx g @blueprint/tooling:move booking/feat-rebook checkin/feat-rebook
nx g @blueprint/tooling:rename payment billing               # Domain, Feat (booking/feat-a b) oder Lib
nx g @blueprint/tooling:remove billing [--force]
nx g @blueprint/tooling:component libs/booking/ui/src/booking-badge
nx g @blueprint/tooling:service libs/booking/data/src/booking-cache
nx g @blueprint/tooling:store libs/booking/ui/src/booking-filter
```

| Generator | erzeugt / ändert | prüft |
|---|---|---|
| `domain <name> [--layers] [--testing]` | Libs mit Beispielen im Stil von booking/checkin: `types` (Modell), `api` (Port, `fetch` über `ApiHttp`, re-exportiert das Modell), `data` (Signal-Store, auf der Route bereitgestellt), `ui` (OnPush-Liste), `shell` (Routes mit `providers: [provide<D>()]` + Smart-Page). Dazu `testing` (`a<D>()`, `<d>Handlers`, `<d>Scenarios`) und `data/src/<d>.store.spec.ts` im `beforeEach(() => worker.use(...))`-Stil. Lazy-Route in `apps/client/src/app/app.routes.ts` (vor dem Redirect), Scope in `nx.json` | kebab-case, nicht `shared`/`feat-*`, Layer aus der Plugin-Liste, Abhängigkeiten der Beispiele (z.B. `data` braucht `api`) |
| `layer <domain> <layer>` | eine Lib mit Beispiel; `shell` wird auch in den App-Routes registriert, `testing` = Testing-Generator | Domain existiert (Scope-Liste + mindestens eine Lib), Layer ∈ `SLICE_LAYERS` des Plugins (`feature` nur im Feat) |
| `feat <domain> <name> [--api --data --ui]` | `feat-<name>/feature` (Container `Feat<Name>`, OnPush, Store in `providers`) + gewählte Unter-Libs; `loadComponent`-Route in den Shell-Routes der Domain (in `children`, falls vorhanden) | Domain existiert, kebab-case (`feat-` davor wird akzeptiert) |
| `testing <domain>` | `libs/<d>/testing` allein. Nutzt `<Entity>` aus `<d>/types`, sonst deklariert die Fixture die Backend-Form selbst | Domain existiert |
| `move <from> <to>` | verschiebt Lib, Feat oder Domain; schreibt alle `@blueprint/<from>…`-Specifier in `apps/` und `libs/` um (statisch, `export … from`, `import()` in Routes, auch in Kommentaren). Route-`path` folgt einer umbenannten Domain bzw. einem Feat; ein Feat in eine andere Domain wandert mit seiner Route in deren Shell. Scope-Liste nachgezogen | Ziel frei, jede Ziel-Lib erfüllt die Pfad-Konvention. Fundstellen außerhalb `apps/`/`libs/` (Doku, Skripte) werden nur gemeldet |
| `rename <path> <name>` | `move` an denselben Ort (`payment` → `billing`, `booking/feat-a` → `feat-b`) | wie move |
| `remove <path> [--force]` | löscht, trägt Lazy-Routes (App + Shell) und bei leerer Domain den Scope aus | bricht ab, solange Code sie importiert (Kommentare zählen nicht); `--force` löscht trotzdem und meldet die Stellen |
| `component` / `service` / `store` `<libs/…/src/name>` | Datei + Export in `index.ts` (`--export=false` ohne) | Pfad liegt in einer Lib; Layer passt: component → ui/feature/shell, service → api/data/feature/shell, store → data/ui/feature |

### Warum eigene Wrapper für component/service/store

Getestet mit Nx 23.1: `nx g @nx/angular:component --path=libs/booking/ui/src/probe-card` bricht ab mit *„The provided directory … does not exist under any project root“*, `@nx/angular:service` (→ `@schematics/angular:service`) mit *„Required property 'project' is missing“* bzw. *„Project "booking-data" does not exist“*. Beide suchen das Projekt im Tree (`project.json`), inferierte Projekte sieht die Tree-API nicht. Deshalb dünne eigene Generatoren.

## Scope-Liste

`nx.json` → `plugins` → `@blueprint/tooling` → `options.scopes`. Ein Ordner `libs/<scope>/…` mit unbekanntem Scope bricht den Graph ab:

```
libs/bokking/ui: unknown scope "bokking" (did you mean "booking"?). Allowed scopes (nx.json → plugins →
@blueprint/tooling → options.scopes): auth, booking, checkin, layout, shared. New slice: nx g @blueprint/tooling:domain bokking
```

`domain`, `move`/`rename` und `remove` pflegen die Liste. `tooling:verify` meldet Einträge ohne Lib. Die depConstraints (`sameTagConstraints()` in `eslint.config.mjs`) leiten Scopes weiter aus den Graph-Tags ab; weil das Plugin nur gelistete Scopes zulässt, sind Graph und Liste deckungsgleich.

## Sync-Generator

`@blueprint/tooling:app-routes` ist in `nx.json` → `sync.globalGenerators` registriert. Beleg Nx 23.1 (`node_modules/nx/schemas/nx-schema.json`): *„List of workspace-wide sync generators to be run (not attached to targets)“*; laufen mit `nx sync` / `nx sync:check` (Nx-Doku „Sync Generators“). Ein Task-Sync-Generator (`targets.<t>.syncGenerators`) passt nicht, weil die Prüfung keinem Target gehört. Er prüft bzw. repariert:

- jede Slice-Shell (`libs/<scope>/shell`, die eine `Routes`-Konstante exportiert) ist lazy in `app.routes.ts` eingetragen (fehlt sie → Route `path: '<scope>'` wird ergänzt)
- keine Lazy-Route (App-Routes und Shell-Routes) zeigt auf eine Lib, die es nicht gibt (→ Route wird entfernt)

Shells ohne Routes (`auth/shell` = Provider, `layout/shell` = Komponente) sind nicht betroffen. CI führt `nx sync:check` aus.

## Checks

| Befehl | prüft |
|---|---|
| `nx test tooling` | Vitest (Node), Tree-basiert mit `createTreeWithEmptyWorkspace` + Fixture-Workspace (`src/testing/blueprint-tree.ts`): alle Generatoren, Routen-AST, Plugin-Konventionen, Sync-Generator |
| `nx run tooling:verify` (`pnpm verify`) | `scripts/verify-boundaries.mjs`: Lint-Fälle gegen die echte ESLint-Config, Tag-Schema + Scope-Liste, Test-Isolation, neue Lib ohne Config, **keine Config-Dateien in `libs/`** (`project.json`, `package.json`, `tsconfig*.json`, `ng-package.json`, `eslint.config.*` außerhalb `src/`, Ausnahme `libs/tsconfig*.json`), Scan des Client-Bundles. Gecacht; Inputs: `libs/**`, `apps/**`, `eslint.config.mjs`, `nx.json`, `tsconfig.base.json`, Skript + Plugin, Output von `client:build` (dependsOn) |
| `pnpm verify:nx-internals` | nach `nx migrate` / Angular-Update, siehe unten |

### `pnpm verify:nx-internals`

Die Executoren hängen an Nx-Interna. Nach jedem `nx migrate` (und Angular-Update) laufen lassen, vor dem Commit der Migration:

1. `run-many -t build lint test typecheck --skip-nx-cache` in ein frisches `dist/`
2. dist-Äquivalenz: sha256 jeder Datei gegen `nx-internals/dist-hashes.json` (Stand vor dem Umzug nach `packages/tooling`, 346 Dateien). Alternativ `--reference <dir>` gegen eine Kopie von `dist/` vor dem Update. Ändert ein Update den Output bewusst: prüfen, dann `--update-snapshot`
3. Marker: Text in `dist/libs/layout/ui/esm2022/nav-bar.js` ersetzt, `client:build --exclude-task-dependencies` → Marker muss im App-Bundle stehen (App baut gegen `dist`, nicht still aus Source). Danach wird `dist` wiederhergestellt
4. MSW: `beforeEach(() => worker.use(...bookingHandlers))` aus `booking.store.spec.ts` entfernt → `booking-data:test` muss rot werden (`without a matching request handler`). Datei wird wiederhergestellt
5. `tooling:verify`
