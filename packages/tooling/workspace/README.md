# @blueprint/tooling-workspace

Alle Generatoren außer `client`. Projekt `tooling-workspace` (`type:tooling`, `tooling:workspace`), importiert `@blueprint/tooling-conventions` und `@blueprint/tooling-openapi` (`/clients`, Client-`project.json`). Übersicht: [`packages/tooling`](../README.md).

| Teil | Datei(en) | Aufgabe |
|---|---|---|
| Generatoren | `src/generators/*`, `generators.json` | domain, layer, feat, testing, move, rename, remove, component, service, store — schreiben bzw. pflegen die Config-Dateien jeder Lib (`project.json`, `package.json`, `ng-package.json`, `tsconfig*.json`) und `tsconfig.base.json` → `paths` |
| Sync-Generatoren | `src/sync/app-routes`, `src/sync/lib-tags` | `nx sync` / `nx sync:check`: Slice-Shells ↔ `app.routes.ts`; Tags jeder Lib ↔ Pfad |

Kein Plugin mehr (auf `feat/nx-blueprint` inferierte `src/plugin/blueprint-libs.ts` Projekte und Targets). Vorlage der Dateien: `@blueprint/tooling-conventions` → `lib-files.ts`; Target-Bodies: `nx.json` → `targetDefaults`.

## Generatoren

Alle arbeiten über die Tree-API, sind idempotent (bestehende Libs bleiben unangetastet) und formatieren mit `formatFiles` (Prettier, `.prettierrc`: `printWidth 120`). Jede neue Lib bekommt ihre Config-Dateien (Tags aus dem Pfad, `peerDependencies` aus den Imports der Beispiele) und einen `paths`-Eintrag. Positionsargumente wie gezeigt, fehlende werden abgefragt (`x-prompt`), `--dry-run` geht überall. Unbekannte Optionen lehnt Nx ab statt sie still zu verwerfen (`"additionalProperties": false` in jedem Schema, auch der Sync-Generatoren): `nx g @blueprint/tooling-workspace:feat payment checkout --api` → `'api' is not found in schema`.

```sh
nx g @blueprint/tooling-workspace:domain payment                       # libs/payment/{types,data-access,state,ui,shell,testing} + Spec, Route, Scope
nx g @blueprint/tooling-workspace:domain notes --layers=types,utils --testing=false
nx g @blueprint/tooling-workspace:layer payment utils                  # libs/payment/utils
nx g @blueprint/tooling-workspace:feat payment checkout --state --ui    # libs/payment/feat-checkout/{feature,state,ui} + Shell-Route
nx g @blueprint/tooling-workspace:testing checkin                      # nur libs/checkin/testing (fixtures, handlers, scenarios)
nx g @blueprint/tooling-workspace:move booking/feat-rebook checkin/feat-rebook
nx g @blueprint/tooling-workspace:rename payment billing               # Domain, Feat (booking/feat-a b) oder Lib
nx g @blueprint/tooling-workspace:remove billing [--force]
nx g @blueprint/tooling-workspace:component libs/booking/ui/src/booking-badge    # → @nx/angular:component
nx g @blueprint/tooling-workspace:service libs/booking/state/src/booking-cache   # → @schematics/angular:service
nx g @blueprint/tooling-workspace:store libs/booking/ui/src/booking-filter
```

| Generator | erzeugt / ändert | prüft |
|---|---|---|
| `domain <name> [--layers] [--testing]` | Libs mit Beispielen im Stil von booking/checkin: `types` (Modell), `data-access` (`<d>-api.ts` mit `fetch` über `ApiHttp` aus `shared/data-access`), `state` (Signal-Store über `<D>Api`, auf der Route bereitgestellt), `ui` (OnPush-Liste), `shell` (Routes mit `providers: [provide<D>()]` + Smart-Page). Dazu `testing` (`a<D>()`, `<d>Handlers`, `<d>Scenarios`) und `state/src/<d>.store.spec.ts` im `beforeEach(() => worker.use(...))`-Stil. Lazy-Route in `apps/client/src/app/app.routes.ts` (vor dem Redirect), Scope in `lib-scopes.json`, Config-Dateien + `paths` (Testing ohne Build-Dateien, `state` mit `tsconfig.spec.json` + `test`) | kebab-case, nicht `shared`/`feat-*`, Layer aus den Konventionen, Abhängigkeiten der Beispiele (z.B. `state` braucht `types` + `data-access`, `shell` braucht `state` + `ui`) |
| `layer <domain> <layer>` | eine Lib mit Beispiel; `shell` wird auch in den App-Routes registriert, `testing` = Testing-Generator | Domain existiert (Scope-Liste + mindestens eine Lib), Layer ∈ `SLICE_LAYERS` (`feature` nur im Feat) |
| `feat <domain> <name> [--state --ui]` (kein feat-port) | `feat-<name>/feature` (Container `Feat<Name>`, OnPush, Store in `providers`) + gewählte Unter-Libs; `loadComponent`-Route in den Shell-Routes der Domain (in `children`, falls vorhanden) | Domain existiert, kebab-case (`feat-` davor wird akzeptiert) |
| `testing <domain>` | `libs/<d>/testing` allein. Nutzt `<Entity>` aus `<d>/types`, sonst deklariert die Fixture die Backend-Form selbst | Domain existiert |
| `move <from> <to>` | verschiebt Lib, Feat, Domain oder OpenAPI-Client (Eintrag in `openapi-clients.json` wandert mit, bei Umbenennung auch `<client>Http`/`<client>Handlers` in den Importen); schreibt alle `@blueprint/<from>…`-Specifier in `apps/` und `libs/` um (statisch, `export … from`, `import()` in Routes, auch in Kommentaren). Route-`path` folgt einer umbenannten Domain bzw. einem Feat; ein Feat in eine andere Domain wandert mit seiner Route in deren Shell. Scope-Liste nachgezogen. Config: `project.json` (Name, `$schema`, `sourceRoot`, Tags, Pfade in Targets wie Spec-Input/`client`/`json`-Feld), `package.json`-Name, `ng-package.json`-`dest`, `extends`/`outDir` der tsconfigs bei neuer Tiefe, `paths`, `implicitDependencies` anderer Projekte auf verschobene Namen | Ziel frei, jede Ziel-Lib erfüllt die Pfad-Konvention. Fundstellen außerhalb `apps/`/`libs/` (Doku, Skripte) werden nur gemeldet |
| `rename <path> <name>` | `move` an denselben Ort (`payment` → `billing`, `booking/feat-a` → `feat-b`) | wie move |
| `remove <path> [--force]` | löscht (inkl. Config-Dateien und gitignored generiertem Code), trägt Lazy-Routes (App + Shell), `paths`, `implicitDependencies` auf entfernte Projekte, bei leerer Domain den Scope und Client-Einträge in `openapi-clients.json` aus | bricht ab, solange Code sie importiert (Kommentare zählen nicht); `--force` löscht trotzdem und meldet die Stellen |
| `component` / `service` / `store` `<libs/…/src/name>` | Datei + Export in `index.ts` (`--export=false` ohne); component über `@nx/angular:component` (inline, `app`-Präfix, ohne Spec), service über `@schematics/angular:service` (ohne Spec), store eigenes Template | Pfad liegt in einer Lib, die nicht generiert ist; Layer passt: component → ui/feature/shell, service → data-access/state/feature/shell, store → state/ui/feature |

### component/service: Nx-Generatoren + dünne Vorbelegung

Mit `project.json` pro Lib funktionieren die Standard-Generatoren wieder (getestet, Nx 23.1): `nx g @nx/angular:component libs/booking/ui/src/booking-badge --export` legt `booking-badge.ts` (+ html/css/spec) an und exportiert es. Nx hat keinen Service-Generator; `nx g @schematics/angular:service booking-cache --project booking-state --path libs/booking/state/src` geht über Nx' Angular-CLI-Adapter. Auf `feat/nx-blueprint` scheiterten beide (*„does not exist under any project root“*, *„Required property 'project' is missing“*), weil die Tree-API inferierte Projekte nicht sieht.

Die Blueprint-Generatoren bleiben als Vorbelegung, weil sie Architekturregeln prüfen, die sonst niemand prüft (component nur in ui/feature/shell, service nur in data-access/state/feature/shell, nie in einem generierten Client) und den Pfad statt Projekt + Name nehmen. Die Templates kommen von Nx/Angular (z.B. Angular 22 `@Service()`), der Wrapper setzt nur Defaults (inline, `app`-Präfix, ohne Spec, Export). `store` hat kein Nx-Gegenstück und behält sein Template. `nx.json` → `generators["@nx/angular:component"].style` ist gesetzt, sonst schreibt `@nx/angular:component` ihn beim ersten Lauf in `nx.json` (ganzer Cache invalid).

## Scope-Liste

`lib-scopes.json` (Root) → `scopes`. Eigene Datei statt `nx.json` (jede `nx.json`-Änderung invalidiert den ganzen Cache). Kein Plugin bricht mehr den Graph bei einem unbekannten Scope; `tooling-verify:verify` meldet einen Lib-Scope außerhalb der Liste, Tags in `project.json`, die nicht zum Pfad passen, und Listeneinträge ohne Lib:

```
libs/layout/ui: scope "layout" is not in lib-scopes.json (auth, booking, checkin, shared) — folder typo? New slice: nx g @blueprint/tooling-workspace:domain layout
libs/booking/ui/project.json: tags ["scope:bookng","type:ui","feat:none"], path implies ["scope:booking","type:ui","feat:none"]
```

`domain`, `move`/`rename` und `remove` pflegen die Liste; die Generatoren lehnen Pfade mit unbekanntem Scope (`libPathError` mit Tippfehler-Hinweis) und Ordner, die nicht kebab-case sind (`feat-CheckIn`), ab; von Hand angelegte meldet `verify` (Ordnerregel). `generated` ist reserviert und nie ein Scope: `libs/generated/<client>` gehört zu `shared`, `libs/<d>/generated/<client>` zur Domain. Die depConstraints (`sameTagConstraints()` in `eslint.config.mjs`) leiten Scopes aus den Graph-Tags (= `project.json`) ab.

## Sync-Generatoren

`@blueprint/tooling-workspace:app-routes` und `:lib-tags` sind in `nx.json` → `sync.globalGenerators` registriert. Beleg Nx 23.1 (`node_modules/nx/schemas/nx-schema.json`): *„List of workspace-wide sync generators to be run (not attached to targets)“*; laufen mit `nx sync` / `nx sync:check` (Nx-Doku „Sync Generators“). Ein Task-Sync-Generator (`targets.<t>.syncGenerators`) passt nicht, weil die Prüfung keinem Target gehört.

`app-routes` prüft bzw. repariert:

- jede Slice-Shell (`libs/<scope>/shell`, die eine `Routes`-Konstante exportiert) ist lazy in `app.routes.ts` eingetragen (fehlt sie → Route `path: '<scope>'` wird ergänzt)
- keine Lazy-Route (App-Routes und Shell-Routes) zeigt auf eine Lib, die es nicht gibt (→ Route wird entfernt)

Shells ohne Routes (z.B. `layout/shell` = Komponente) sind nicht betroffen.

`lib-tags` prüft bzw. repariert: die `tags` jeder `libs/**/project.json` sind genau `deriveTags(<pfad>)` aus `@blueprint/tooling-conventions` (dieselbe Funktion, mit der die Generatoren sie schreiben). Grund: Tags entstehen einmal beim Anlegen einer Lib. Ändert sich das Regelwerk (z.B. Reduktion: generierte `api`/`core` → `type:data-access`, `data` → `data-access` + `state`, `port`/`feat-port` entfallen) oder editiert jemand eine `project.json` von Hand, bleiben alte Tags stehen. `nx sync` schreibt sie neu, der Rest der `project.json` bleibt unverändert. Liegt eine Lib in einem Ordner außerhalb der Konvention (`libs/booking/api`), wird sie nur gemeldet: dann ist der Ordner falsch (→ `move`), nicht die Tags. Probe: `type:data` an zwei Client-Libs und `port` an `booking-state` → `sync:check` meldet alle drei, `nx sync` stellt die Tags byte-gleich wieder her.

CI führt `nx sync:check` aus.

## Tests

`nx test tooling-workspace`: Vitest (Node), Tree-basiert mit `createTreeWithEmptyWorkspace` + Fixture-Workspace (`@blueprint/tooling-conventions/testing`, jede Lib mit Config): alle Generatoren inkl. geschriebener Config (Tags, Build-Dateien, peers, `paths`, Spec-Config), `remove` nach `domain` = exakt der Ausgangszustand (`tsconfig.base.json`, `lib-scopes.json`, Routen), `move` zieht Config nach, component/service über die Nx-/Angular-Generatoren, Routen-AST, Sync-Generatoren (app-routes, lib-tags), move/rename/remove mit OpenAPI-Clients inkl. Client-`project.json` (`src/generators/shared/clients.spec.ts`), jedes Schema aus `generators.json` strikt (`src/schemas.spec.ts`, ein neuer Generator ohne `additionalProperties: false` wird rot).
