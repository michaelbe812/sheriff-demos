# @blueprint/tooling-workspace

Crystal-Plugin der Libs und alle Generatoren außer `client`. Projekt `tooling-workspace` (`type:tooling`, `tooling:workspace`), importiert `@blueprint/tooling-conventions` und `@blueprint/tooling-openapi/clients`, nutzt die Executoren von `@blueprint/tooling-ng-lib`. Übersicht: [`packages/tooling`](../README.md).

| Teil | Datei(en) | Aufgabe |
|---|---|---|
| Crystal-Plugin | `src/plugin/blueprint-libs.ts` (`nx.json` → `plugins[0]`, `options.scopes`) | macht jeden Ordner `libs/<scope>/<layer>` bzw. `libs/<scope>/feat-<f>/<layer>` mit `src/index.ts` zu einem Projekt (Name, Tags, Alias, Targets `lint`/`typecheck`/`build`/`test`/`test-ui`). Unbekannter Layer oder Scope → Graph-Fehler. Client-Libs `libs/[<d>/]generated/<client>/<teil>` sind normale Libs; Kanten, Client-Projekte und `generate` ergänzt `@blueprint/tooling-openapi` (zweites Plugin, gleiche Roots) |
| Generatoren | `src/generators/*`, `generators.json` | domain, layer, feat, testing, move, rename, remove, component, service, store |
| Sync-Generator | `src/sync/app-routes` | `nx sync` / `nx sync:check`: Slice-Shells ↔ `app.routes.ts` |

Die Targets der Libs nutzen `@blueprint/tooling-ng-lib:build`/`:test` und `node packages/tooling/ng-lib/scripts/typecheck-lib.mjs`. Inputs: `lint` hasht beide Plugins + `conventions/src/lib-conventions.ts` (Tags/Kanten bestimmen die Constraints), `build`/`test` `packages/tooling/ng-lib/src/**`.

## Generatoren

Alle arbeiten über die Tree-API, sind idempotent (bestehende Dateien bleiben unangetastet) und formatieren mit `formatFiles` (Prettier, `.prettierrc`: `printWidth 120`). Positionsargumente wie gezeigt, fehlende werden abgefragt (`x-prompt`), `--dry-run` geht überall.

```sh
nx g @blueprint/tooling-workspace:domain payment                       # libs/payment/{types,api,data,ui,shell,testing} + Spec, Route, Scope
nx g @blueprint/tooling-workspace:domain notes --layers=types,utils --testing=false
nx g @blueprint/tooling-workspace:layer payment events                 # libs/payment/events
nx g @blueprint/tooling-workspace:feat payment checkout --api --data --ui   # libs/payment/feat-checkout/{feature,api,data,ui} + Shell-Route
nx g @blueprint/tooling-workspace:testing checkin                      # nur libs/checkin/testing (fixtures, handlers, scenarios)
nx g @blueprint/tooling-workspace:move booking/feat-rebook checkin/feat-rebook
nx g @blueprint/tooling-workspace:rename payment billing               # Domain, Feat (booking/feat-a b) oder Lib
nx g @blueprint/tooling-workspace:remove billing [--force]
nx g @blueprint/tooling-workspace:component libs/booking/ui/src/booking-badge
nx g @blueprint/tooling-workspace:service libs/booking/data/src/booking-cache
nx g @blueprint/tooling-workspace:store libs/booking/ui/src/booking-filter
```

| Generator | erzeugt / ändert | prüft |
|---|---|---|
| `domain <name> [--layers] [--testing]` | Libs mit Beispielen im Stil von booking/checkin: `types` (Modell), `api` (Port, `fetch` über `ApiHttp`, re-exportiert das Modell), `data` (Signal-Store, auf der Route bereitgestellt), `ui` (OnPush-Liste), `shell` (Routes mit `providers: [provide<D>()]` + Smart-Page). Dazu `testing` (`a<D>()`, `<d>Handlers`, `<d>Scenarios`) und `data/src/<d>.store.spec.ts` im `beforeEach(() => worker.use(...))`-Stil. Lazy-Route in `apps/client/src/app/app.routes.ts` (vor dem Redirect), Scope in `nx.json` | kebab-case, nicht `shared`/`feat-*`, Layer aus der Plugin-Liste, Abhängigkeiten der Beispiele (z.B. `data` braucht `api`) |
| `layer <domain> <layer>` | eine Lib mit Beispiel; `shell` wird auch in den App-Routes registriert, `testing` = Testing-Generator | Domain existiert (Scope-Liste + mindestens eine Lib), Layer ∈ `SLICE_LAYERS` des Plugins (`feature` nur im Feat) |
| `feat <domain> <name> [--api --data --ui]` | `feat-<name>/feature` (Container `Feat<Name>`, OnPush, Store in `providers`) + gewählte Unter-Libs; `loadComponent`-Route in den Shell-Routes der Domain (in `children`, falls vorhanden) | Domain existiert, kebab-case (`feat-` davor wird akzeptiert) |
| `testing <domain>` | `libs/<d>/testing` allein. Nutzt `<Entity>` aus `<d>/types`, sonst deklariert die Fixture die Backend-Form selbst | Domain existiert |
| `move <from> <to>` | verschiebt Lib, Feat, Domain oder OpenAPI-Client (Eintrag in `openapi-clients.json` wandert mit, bei Umbenennung auch `<client>Http`/`<client>Handlers` in den Importen); schreibt alle `@blueprint/<from>…`-Specifier in `apps/` und `libs/` um (statisch, `export … from`, `import()` in Routes, auch in Kommentaren). Route-`path` folgt einer umbenannten Domain bzw. einem Feat; ein Feat in eine andere Domain wandert mit seiner Route in deren Shell. Scope-Liste nachgezogen | Ziel frei, jede Ziel-Lib erfüllt die Pfad-Konvention. Fundstellen außerhalb `apps/`/`libs/` (Doku, Skripte) werden nur gemeldet |
| `rename <path> <name>` | `move` an denselben Ort (`payment` → `billing`, `booking/feat-a` → `feat-b`) | wie move |
| `remove <path> [--force]` | löscht, trägt Lazy-Routes (App + Shell), bei leerer Domain den Scope und Client-Einträge in `openapi-clients.json` aus | bricht ab, solange Code sie importiert (Kommentare zählen nicht); `--force` löscht trotzdem und meldet die Stellen |
| `component` / `service` / `store` `<libs/…/src/name>` | Datei + Export in `index.ts` (`--export=false` ohne) | Pfad liegt in einer Lib, die nicht generiert ist; Layer passt: component → ui/feature/shell, service → api/data/feature/shell, store → data/ui/feature |

### Warum eigene Wrapper für component/service/store

Getestet mit Nx 23.1: `nx g @nx/angular:component --path=libs/booking/ui/src/probe-card` bricht ab mit *„The provided directory … does not exist under any project root“*, `@nx/angular:service` (→ `@schematics/angular:service`) mit *„Required property 'project' is missing“* bzw. *„Project "booking-data" does not exist“*. Beide suchen das Projekt im Tree (`project.json`), inferierte Projekte sieht die Tree-API nicht. Deshalb dünne eigene Generatoren.

## Scope-Liste

`nx.json` → `plugins` → `@blueprint/tooling-workspace` → `options.scopes`. Ein Ordner `libs/<scope>/…` mit unbekanntem Scope bricht den Graph ab:

```
libs/bokking/ui: unknown scope "bokking" (did you mean "booking"?). Allowed scopes (nx.json → plugins →
@blueprint/tooling-workspace → options.scopes): auth, booking, checkin, layout, shared. New slice: nx g @blueprint/tooling-workspace:domain bokking
```

`domain`, `move`/`rename` und `remove` pflegen die Liste. `generated` ist reserviert und nie ein Scope: `libs/generated/<client>` gehört zu `shared`, `libs/<d>/generated/<client>` zur Domain. `tooling-verify:verify` meldet Einträge ohne Lib. Die depConstraints (`sameTagConstraints()` in `eslint.config.mjs`) leiten Scopes weiter aus den Graph-Tags ab; weil das Plugin nur gelistete Scopes zulässt, sind Graph und Liste deckungsgleich.

## Sync-Generator

`@blueprint/tooling-workspace:app-routes` ist in `nx.json` → `sync.globalGenerators` registriert. Beleg Nx 23.1 (`node_modules/nx/schemas/nx-schema.json`): *„List of workspace-wide sync generators to be run (not attached to targets)“*; laufen mit `nx sync` / `nx sync:check` (Nx-Doku „Sync Generators“). Ein Task-Sync-Generator (`targets.<t>.syncGenerators`) passt nicht, weil die Prüfung keinem Target gehört. Er prüft bzw. repariert:

- jede Slice-Shell (`libs/<scope>/shell`, die eine `Routes`-Konstante exportiert) ist lazy in `app.routes.ts` eingetragen (fehlt sie → Route `path: '<scope>'` wird ergänzt)
- keine Lazy-Route (App-Routes und Shell-Routes) zeigt auf eine Lib, die es nicht gibt (→ Route wird entfernt)

Shells ohne Routes (`auth/shell` = Provider, `layout/shell` = Komponente) sind nicht betroffen. CI führt `nx sync:check` aus.

## Tests

`nx test tooling-workspace`: Vitest (Node), Tree-basiert mit `createTreeWithEmptyWorkspace` + Fixture-Workspace (`@blueprint/tooling-conventions/testing`): alle Generatoren, Routen-AST, Sync-Generator, move/rename/remove mit OpenAPI-Clients (`src/generators/shared/clients.spec.ts`).
