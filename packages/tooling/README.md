# packages/tooling

Werkzeug des Blueprints (Branch `feat/nx-blueprint`), aufgeteilt in fünf Nx-Libs. `packages/tooling` selbst ist nur ein Gruppierungsordner, kein Projekt und kein Paket.

| Lib | Paket / Projekt | Tag | Inhalt | Details |
|---|---|---|---|---|
| `conventions` | `@blueprint/tooling-conventions` / `tooling-conventions` | `tooling:conventions` | Pfad → Name/Tags/Alias, Layer, reservierter Ordner `generated`, Client-Pfade, Scope-Liste (`nx.json`), Tree-Helfer, Fixture-Workspace für Specs | [README](conventions/README.md) |
| `openapi` | `@blueprint/tooling-openapi` / `tooling-openapi` | `tooling:openapi` | Crystal-Plugin für `openapi-clients.json`, Facade (Vertrag, Registry, Adapter, Split, Barrel), Testing-Generierung, Executoren `generate`/`update-spec`/`generate-testing`, Generator `client` | [README](openapi/README.md) |
| `workspace` | `@blueprint/tooling-workspace` / `tooling-workspace` | `tooling:workspace` | Crystal-Plugin der Libs (ohne Config-Dateien), Generatoren domain/layer/feat/testing/move/rename/remove/component/service/store, Sync-Generator `app-routes` | [README](workspace/README.md) |
| `ng-lib` | `@blueprint/tooling-ng-lib` / `tooling-ng-lib` | `tooling:ng-lib` | Executoren `build`/`application`/`test` (Nx-Interna an einer Stelle), `typecheck-lib` | [README](ng-lib/README.md) |
| `verify` | `@blueprint/tooling-verify` / `tooling-verify` | `tooling:verify` | `verify` (Boundaries, Tag-Schema, Clients, Tooling-Libs, affected, Bundle-Scan), `verify:nx-internals`, dist-Snapshot | [README](verify/README.md) |

Alle tragen zusätzlich `type:tooling` (darf nur `type:tooling` importieren, Libs in `libs/` dürfen kein Tooling importieren).

## Abhängigkeiten

```
conventions  ◀── openapi  ◀── workspace ──▶ ng-lib        verify (liest nur den Graphen)
     ▲                            │
     └────────────────────────────┘
```

| Lib | darf importieren | Grund |
|---|---|---|
| `conventions` | nichts | Basis: Pfad-Konventionen gelten für beide Plugins und alle Generatoren; `lib-conventions.ts` hat nicht einmal Runtime-Imports (Plugin-Ladezeit) |
| `openapi` | `conventions` | Client-Pfade, Tags, Scope-Liste kommen aus den Konventionen. Kennt die Lib-Generatoren nicht |
| `workspace` | `conventions`, `openapi`, `ng-lib` | `move`/`rename`/`remove` halten `openapi-clients.json` nach (`@blueprint/tooling-openapi/clients`); die inferierten Targets nutzen die ng-lib-Executoren (nur `package.json`-Abhängigkeit, kein Import) |
| `ng-lib` | nichts | kapselt Nx-/Angular-Interna, weiß nichts von Konventionen oder OpenAPI |
| `verify` | nichts | prüft von außen (Projekt-Graph, ESLint, git) |

Durchgesetzt über `depConstraints` (`eslint.config.mjs`, `toolingConstraints`) und 17 Verify-Fälle (`tooling: …`), zyklenfrei (Zyklen meldet die Regel zusätzlich). Imports über Lib-Grenzen nur per Paketname, relative Pfade blockiert die Regel.

## Laden ohne Build

Nx lädt Plugins, Generatoren und Executoren direkt aus den Quellen (`main`/`exports` zeigen auf `.ts`, Executoren sind CJS), mit eigenem Transpiler (swc). Die Root-`package.json` verlinkt die Pakete, die Nx per Namen auflöst (`@blueprint/tooling-workspace`, `-openapi`, `-ng-lib`), jede Lib verlinkt ihre Abhängigkeiten in ihrer eigenen `package.json` (`workspace:*`). Nach `git pull` einmal `pnpm install`.

**Warum zusätzlich `paths` in `tsconfig.base.json`:** Nx' swc-Transpiler wendet die `paths` der `tsconfig.base.json` beim Laden von Plugins/Generatoren an. Der Wildcard `@blueprint/*` → `libs/*/src/index.ts` (Lib-Aliase) würde `@blueprint/tooling-conventions` auf `libs/tooling-conventions/…` umschreiben (*Cannot find module*). Jeder importierte Export einer Tooling-Lib hat deshalb einen exakten Eintrag (exakt schlägt Wildcard). `verify` prüft `exports` ↔ `paths` in beide Richtungen.

**Kein Build-Schritt** (unverändert): kein veraltetes `dist/`, keine Henne-Ei-Frage beim Graph. Preis: in den Plugins nur `import type` aus `@nx/devkit`.

## Generatoren

```sh
nx g @blueprint/tooling-workspace:domain payment
nx g @blueprint/tooling-workspace:layer payment events
nx g @blueprint/tooling-workspace:feat payment checkout --api --data --ui
nx g @blueprint/tooling-workspace:testing checkin
nx g @blueprint/tooling-workspace:move booking/feat-rebook checkin/feat-rebook
nx g @blueprint/tooling-workspace:rename payment billing
nx g @blueprint/tooling-workspace:remove billing [--force]
nx g @blueprint/tooling-workspace:component|service|store libs/booking/ui/src/booking-badge
nx g @blueprint/tooling-openapi:client pet-client --spec=https://petstore3.swagger.io/api/v3/openapi.json
```

Vorher `@blueprint/tooling:<generator>`; die Generatoren selbst sind unverändert. Executoren: `@blueprint/tooling-ng-lib:build|application|test`, `@blueprint/tooling-openapi:generate|update-spec|generate-testing`.

## Checks

| Befehl | prüft |
|---|---|
| `nx run-many -t lint test typecheck -p 'tooling-*'` | Specs pro Lib (Vitest, Node): conventions, workspace, openapi. `tooling-openapi:test` = Unit + Integration (echte Adapter, msw, tsc, `nx` im Fixture-Workspace, Java) mit Coverage ≥ 95 %, siehe [openapi](openapi/README.md#tests) |
| `pnpm verify` (`nx run tooling-verify:verify`) | siehe [verify](verify/README.md) |
| `pnpm verify:nx-internals` | nach `nx migrate` / Angular-Update |

## `nx affected`

Die Libs haben keine Graph-Kante zum Tooling. Nötig ist sie nicht: jede Tooling-Datei, die eine Lib-Task nutzt, ist `{workspaceRoot}`-Input dieser Task, und `nx affected` folgt Inputs. Die CI braucht deshalb keinen Tooling-Fallback mehr:

| Änderung in | betroffen |
|---|---|
| `ng-lib/src/**` | alle Libs mit `build`/`test` + App (46 Projekte) |
| `ng-lib/scripts/typecheck-lib.mjs` | alle Libs |
| `workspace/src/plugin/**`, `openapi/src/plugin/**`, `conventions/src/lib-conventions.ts` | alle Libs (`lint`-Input: Tags/Kanten) + App |
| `openapi/src/facade/**`, `openapi/src/executors/**` | Client-Projekte + Abhängige |
| `openapi/src/testing/**` | Testing-Libs der Clients + deren Nutzer |
| `openapi-clients.json` | alle Client-Projekte + Abhängige (Input von `update-spec`; der Cache von `generate` bleibt pro Eintrag) |
| Generatoren, `tree.ts`, `verify` | nur die Tooling-Lib selbst |

`verify` probt das mit `nx show projects --affected --files=…` für jeden Bereich. Implizite Kanten Lib → Tooling-Lib wären gröber (jede Lib-Task hinge an jeder Tooling-Datei) und würden den Graphen mit ~50 Kanten füllen, deshalb nicht umgesetzt.
