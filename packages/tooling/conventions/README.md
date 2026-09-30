# @blueprint/tooling-conventions

Konventionen des Blueprints, geteilt von beiden Plugins und allen Generatoren. Projekt `tooling-conventions` (`type:tooling`, `tooling:conventions`), importiert keine andere Tooling-Lib. Übersicht: [`packages/tooling`](../README.md).

| Export | Datei | Inhalt |
|---|---|---|
| `@blueprint/tooling-conventions` | `src/lib-conventions.ts` | Pfad → Name/Tags/Alias (`deriveTags`, `parseLibPath`, `libPathError` mit Scope-Tippfehler-Hinweis), Layer-Listen, reservierter Ordner `generated`, Client-Pfade (`parseClientPath`, `CLIENT_PARTS`), `openapi-clients.json`, Scope-Liste aus `nx.json` (`WORKSPACE_PLUGIN`, `scopesOfNxJson`), Namensschema (`KEBAB_CASE` auch für Scope-/Feat-/Client-Ordner, `FILE_KINDS`, `KIND_ONLY_LAYERS`, `KIND_FOLDERS`, `INTERNAL_FOLDER`; gelesen von `@blueprint/tooling-eslint-rules`). **Keine Runtime-Imports**: beide Plugins laden die Datei bei jeder Graph-Berechnung |
| `@blueprint/tooling-conventions/tree` | `src/tree.ts` | Tree-Helfer (nur Generatoren, lädt `@nx/devkit`): `listLibPaths`, `libExists`, Scope-Liste lesen/schreiben, `assertSliceExists`, `assertKebabCase`, `forEachSourceFile` |
| `@blueprint/tooling-conventions/testing` | `src/testing/blueprint-tree.ts` | Fixture-Workspace der Generator-Specs (`createBlueprintTree`, `read`, `scopesOf`) |

Jeder Export steht zusätzlich exakt in `tsconfig.base.json` → `paths` (Grund: [Übersicht → Laden ohne Build](../README.md#laden-ohne-build)).

Tests: `nx test tooling-conventions` (Pfad-Konventionen, Tags, Scope-Fehler).
