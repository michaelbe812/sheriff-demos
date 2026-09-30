# @blueprint/tooling-openapi

Generierte OpenAPI-Clients: Plugin, Facade, Executoren, Generator `client`. Projekt `tooling-openapi` (`type:tooling`, `tooling:openapi`), importiert nur `@blueprint/tooling-conventions`. Übersicht: [`packages/tooling`](../README.md), Konzept: [`docs/nx-umsetzung.md` → OpenAPI-Clients](../../../docs/nx-umsetzung.md#openapi-clients).

| Teil | Datei(en) | Aufgabe |
|---|---|---|
| Crystal-Plugin | `src/plugin/openapi-clients.ts` (`nx.json` → `plugins[1]`, eigenes `createNodesV2`) | Marker `openapi-clients.json`: ein Client-Projekt pro Eintrag (`generate`, `update-spec`). Marker `libs/**/generated/*/*/src/index.ts`: ergänzt die Client-Libs, die `@blueprint/tooling-workspace` inferiert (gleiche Roots, Nx mischt beide Ergebnisse): Kanten Teil → Client (→ Geschwister), `generate` der Testing-Lib, `lint`/`typecheck` hängen daran (`dependsOn: ['generate', '...']`). Teil-Lib ohne Eintrag, Eintrag ohne Spec, unbekannter Adapter, Scope außerhalb der Liste → Graph-Fehler |
| Facade | `src/facade/*` | Vertrag (`contract.d.ts`), Registry (`adapters/registry.json`), 3 Adapter, Split in types/api/core, Barrel, Header |
| Testing-Pipeline | `src/testing/testing.mjs` | openapi-typescript, orval (msw + Faker), openapi-msw, `<client>Http`, `<client>Handlers` |
| Executoren | `src/executors/*`, `executors.json` | `@blueprint/tooling-openapi:generate`, `:update-spec`, `:generate-testing`. Option nur `client` (Pfad), der Rest kommt zur Laufzeit aus `openapi-clients.json` |
| Generator | `src/generators/client` | `nx g @blueprint/tooling-openapi:client <name> [--domain] --spec=<datei\|url> [--url] [--adapter]` |
| Tree-Helfer | `src/clients.ts` (Export `@blueprint/tooling-openapi/clients`) | `openapi-clients.json` im Tree lesen/schreiben, Einträge bei move/remove nachziehen, `<client>Http`/`Handlers` umbenennen — genutzt von `client` und von `move`/`rename`/`remove` (workspace) |
| Schema | `openapi-clients.schema.json` | `$schema` von `openapi-clients.json` |

Kurzfassung:

- `openapi-clients.json` (Root): ein Eintrag pro Client (`url`, `adapter`, `options`), Key = Pfad unter `libs/`. Default-Adapter `openapi-tools` (typescript-angular 7.25.0, Java), weitere: `hey-api` (0.83.x gepinnt), `nx-plugin-openapi`.
- Der Eintrag ist ein `json`-Input von `generate`, keine Target-Option: eine Änderung invalidiert nur diesen Client. `update-spec` (nicht gecacht) hat die ganze Datei als Input, damit `nx affected` Änderungen sieht.
- Jede Lib wartet per `^generate` auf den generierten Code ihrer Abhängigkeiten und hasht ihn (`dependentTasksOutputFiles`), weil Nx gitignored Dateien nicht sieht.
- Der Header im generierten Code nennt weiter `@blueprint/tooling (openapi, <adapter>)`: er landet im dist, eine Änderung würde den dist-Snapshot brechen.
- Neuer Adapter: Modul in `src/facade/adapters/` (`generate`, `classify`, siehe `contract.d.ts`) + Eintrag in `registry.json` (Pakete, Inputs, Runtime) + `enum` in `openapi-clients.schema.json` und im `client`-Schema.

## Tests

| Target | Projekt (Vitest) | Inhalt | Dauer |
|---|---|---|---|
| `nx test tooling-openapi` | `unit`: `src/**/*.spec.{ts,mts}` | Plugin (`createNodesV2`: Projekte, Tags, Targets, `json`-Inputs, Kanten, Testing-`generate`, Graph-Fehler: kaputtes JSON, unbekannter Adapter, fehlende/doppelte Spec, Scope außerhalb der Liste, Teil ohne Eintrag), Tree-Helfer (`openapi-clients.json`, move/remove, Umbenennen der Testing-Exporte), Generator `client` (shared/Domain, Datei/URL, alle Adapter, Idempotenz, Validierung), Split/Barrel auf synthetischem Roh-Output, Registry, Spec-Serialisierung, Adapter-Randfälle (nx-plugin-openapi gegen Stub-Backend, fehlende CLI) | ~3 s |
| `nx run tooling-openapi:test-integration` | `unit` + `integration`: `test/integration/**/*.spec.mts`, **mit Coverage** | Facade end-to-end pro Adapter (openapi-tools mit echter Jar, hey-api, nx-plugin-openapi mit beiden Backends) in einem Fixture-Workspace unter `tmp/openapi-it/`: Klassifizierung, Split, Import-Umschreibung auf Aliase, Barrels inkl. doppelter Exportnamen, Header, zweiter Lauf byte-identisch, `tsc` gegen die Aliase. Testing-Generierung (openapi-typescript, orval, openapi-msw) + die generierten Handler laufen in msw 3 (Node) und liefern Daten laut Spec. Executoren mit Executor-Kontext, `update-spec` gegen lokalen HTTP-Server (updated/unchanged/500/ohne url/nicht erreichbar, YAML/JSON normalisiert). Fehlerpfade: Generator-Prozess scheitert, Java fehlt (simuliert), ungültige Spec. `nx` selbst im Fixture-Workspace mit beiden Plugins: gemischte Projekt-Config, `nx run …:generate` + Cache | ~45 s (Java 11+) |

Coverage (V8) gilt für die Summe beider Projekte, deshalb misst nur `test-integration`: Schwelle **95 %** für Lines, Branches, Functions, Statements (darunter rot). Ausgenommen nur `src/**/*.d.ts` (reine Typen, Vertrag) und die Specs; JSON-Schemas zählen nicht als Code. Stand: **100 % Statements/Lines/Functions, 98,5 % Branches** (257/261; die 4 offenen sind `??`-Fallbacks auf Werte, die nie nullish sind, z. B. `tree.read()` nach `tree.exists()`).

```sh
pnpm exec nx test tooling-openapi                     # schnell, ohne Coverage
pnpm exec nx run tooling-openapi:test-integration     # alles + Coverage, Output gecacht
open packages/tooling/openapi/coverage/index.html     # HTML-Report (auch lcov.info, coverage-summary.json)
```

Die Integrationstests brauchen Java (openapi-tools) und laufen in der CI (`run-many`/`affected -t … test-integration`). Beweise: Test-Datei weg → 88 % → Target rot; eine Logikzeile in `split.mjs` invertiert → Test rot.
