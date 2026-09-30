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

Tests: `nx test tooling-openapi` (Generator `client`).
