# @blueprint/tooling-openapi

Generierte OpenAPI-Clients: `project.json`-Vorlagen, Facade, Executoren, Generator `client`. Projekt `tooling-openapi` (`type:tooling`, `tooling:openapi`), importiert nur `@blueprint/tooling-conventions`. Übersicht: [`packages/tooling`](../README.md), Konzept: [`docs/nx-umsetzung.md` → OpenAPI-Clients](../../../docs/nx-umsetzung.md#openapi-clients).

| Teil | Datei(en) | Aufgabe |
|---|---|---|
| Projekt-Config | `src/project-config.ts` (Export `@blueprint/tooling-openapi`) | was der Generator in die `project.json` schreibt: Client-Projekt (`generate` mit Spec-, `json`-Feld- und Adapter-Inputs aus `registry.json`, `update-spec`), Teil-Libs (`implicitDependencies` Teil → Client → Teile darunter), Testing-Lib (`generate`, `lint`/`typecheck` mit `dependsOn: ['generate', '^generate']`). Kein Plugin mehr (auf `feat/nx-blueprint`: `src/plugin/openapi-clients.ts`, `createNodesV2`) |
| Facade | `src/facade/*` | Vertrag (`contract.d.ts`), Registry (`adapters/registry.json`), 3 Adapter, Split in types/api/core, Barrel, Header |
| Testing-Pipeline | `src/testing/testing.mjs` | openapi-typescript, orval (msw + Faker), openapi-msw, `<client>Http`, `<client>Handlers` |
| Executoren | `src/executors/*`, `executors.json` | `@blueprint/tooling-openapi:generate`, `:update-spec`, `:generate-testing`. Option nur `client` (Pfad), der Rest kommt zur Laufzeit aus `openapi-clients.json` |
| Generator | `src/generators/client` | `nx g @blueprint/tooling-openapi:client <name> [--domain] --spec=<datei\|url> [--url] [--adapter]`: Spec, vier Libs mit `index.ts` + Config-Dateien, Client-`project.json`, `paths`, Eintrag. Unbekannte Optionen → Fehler (`additionalProperties: false`) |
| Tree-Helfer | `src/clients.ts` (Export `@blueprint/tooling-openapi/clients`) | `openapi-clients.json` im Tree lesen/schreiben, Einträge bei move/remove nachziehen, Client-`project.json` umziehen (`relocateClientProject`), `<client>Http`/`Handlers` umbenennen — genutzt von `client` und von `move`/`rename`/`remove` (workspace) |
| Schema | `openapi-clients.schema.json` | `$schema` von `openapi-clients.json` |

Kurzfassung:

- `openapi-clients.json` (Root): ein Eintrag pro Client (`url`, `adapter`, `options`), Key = Pfad unter `libs/`. Default-Adapter `openapi-tools` (typescript-angular 7.25.0, Java), weitere: `hey-api` (0.83.x gepinnt), `nx-plugin-openapi`.
- Der Eintrag bleibt in `openapi-clients.json` und ist ein `json`-Input von `generate`, keine Target-Option: eine Änderung invalidiert nur diesen Client (Target-Optionen gingen über die `ProjectConfiguration` in den Hash aller Abhängigen). `update-spec` (nicht gecacht) hat die ganze Datei als Input, damit `nx affected` Änderungen sieht.
- Adapterwechsel: Eintrag **und** Adapter-Inputs im `generate` der Client-`project.json`; `tooling-verify:verify` meldet eine Abweichung mit den erwarteten Inputs.
- Jede Lib wartet per `^generate` auf den generierten Code ihrer Abhängigkeiten und hasht ihn (`dependentTasksOutputFiles`, beides in `nx.json` → `targetDefaults`), weil Nx gitignored Dateien nicht sieht.
- Der Header im generierten Code nennt weiter `@blueprint/tooling (openapi, <adapter>)`: er landet im dist, eine Änderung würde den dist-Snapshot brechen.
- Neuer Adapter: Modul in `src/facade/adapters/` (`generate`, `classify`, siehe `contract.d.ts`) + Eintrag in `registry.json` (Pakete, Inputs, Runtime) + `enum` in `openapi-clients.schema.json` und im `client`-Schema.

## Tests

| Target | Projekt (Vitest) | Inhalt | Dauer |
|---|---|---|---|
| `nx test tooling-openapi` (einziges Test-Target) | `unit`: `src/**/*.spec.{ts,mts}` | Projekt-Config (Client-`project.json`: Tags, Targets, `json`-Inputs, Adapter-Inputs; Teil-Kanten, Testing-`generate`; Fehler: unbekannter Adapter, fehlende/doppelte Spec, falscher Pfad), Tree-Helfer (`openapi-clients.json`, move/remove, Client-`project.json` umziehen, Umbenennen der Testing-Exporte), Generator `client` (shared/Domain, Datei/URL, alle Adapter, geschriebene Config + `paths`, Idempotenz, Validierung, Schema strikt), Split/Barrel auf synthetischem Roh-Output, Registry, Spec-Serialisierung, Adapter-Randfälle (nx-plugin-openapi gegen Stub-Backend, fehlende CLI) | ~3 s |
| (dito) | `integration`: `test/integration/**/*.spec.mts`, beide Projekte **mit Coverage** | Facade end-to-end pro Adapter (openapi-tools mit echter Jar, hey-api, nx-plugin-openapi mit beiden Backends) in einem Fixture-Workspace unter `tmp/openapi-it/`: Klassifizierung, Split, Import-Umschreibung auf Aliase, Barrels inkl. doppelter Exportnamen, Header, zweiter Lauf byte-identisch, `tsc` gegen die Aliase. Testing-Generierung (openapi-typescript, orval, openapi-msw) + die generierten Handler laufen in msw 3 (Node) und liefern Daten laut Spec. Executoren mit Executor-Kontext, `update-spec` gegen lokalen HTTP-Server (updated/unchanged/500/ohne url/nicht erreichbar, YAML/JSON normalisiert). Fehlerpfade: Generator-Prozess scheitert, Java fehlt (simuliert), ungültige Spec. `nx` selbst im Fixture-Workspace (`nx.json` des Repos): `nx g …:client` schreibt die Config, Nx liest sie (Tags, Kanten, Targets aus `project.json` + `targetDefaults`), `nx run …:generate` + Cache | ~45 s (Java 11+) |

Coverage (V8) gilt für die Summe beider Projekte, gemessen im selben Lauf (`test`): Schwelle **95 %** für Lines, Branches, Functions, Statements (darunter rot). Ausgenommen nur `src/**/*.d.ts` (reine Typen, Vertrag) und die Specs; JSON-Schemas zählen nicht als Code. Stand: **100 % Statements/Lines/Functions, 98,4 % Branches** (97 Tests; die 4 offenen sind `??`-Fallbacks auf Werte, die nie nullish sind, z. B. `tree.read()` nach `tree.exists()`).

```sh
pnpm exec nx test tooling-openapi                     # alles (Unit + Integration) + Coverage, Output coverage/ gecacht
pnpm exec vitest run --config packages/tooling/openapi/vitest.config.mts --project unit   # nur Unit, ohne Nx/Coverage (~3 s)
open packages/tooling/openapi/coverage/index.html     # HTML-Report (auch lcov.info, coverage-summary.json)
```

Die Integrationstests brauchen Java (openapi-tools) und laufen in der CI (`run-many`/`affected -t … test`). Beweise: Test-Datei weg → 88 % → Target rot; eine Logikzeile in `split.mjs` invertiert → Test rot.
