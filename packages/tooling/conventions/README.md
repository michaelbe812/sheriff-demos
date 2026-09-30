# @blueprint/tooling-conventions

Konventionen des Blueprints, geteilt von allen Generatoren. Projekt `tooling-conventions` (`type:tooling`, `tooling:conventions`), importiert keine andere Tooling-Lib. Übersicht: [`packages/tooling`](../README.md).

| Export | Datei | Inhalt |
|---|---|---|
| `@blueprint/tooling-conventions` | `src/lib-conventions.ts` | Pfad → Name/Tags/Alias (`deriveTags`, `parseLibPath`, `libPathError` mit Scope-Tippfehler-Hinweis), Layer-Listen, reservierter Ordner `generated`, Client-Pfade (`parseClientPath`, `CLIENT_PARTS`), `openapi-clients.json`, Scope-Liste `lib-scopes.json` (`SCOPES_FILE`, `scopesOfFile`). Keine Runtime-Imports |
| (über `/tree`) | `src/lib-files.ts` | Vorlage der Config-Dateien einer Lib (`libConfigFiles`: `project.json`, `tsconfig.json`, bei buildable Libs `package.json`, `ng-package.json`, `tsconfig.lib*.json`, bei Specs `tsconfig.spec.json`), `paths`-Eintrag, Umzug (`relocateConfig`, `replacePaths`). Rein, keine Runtime-Imports |
| `@blueprint/tooling-conventions/tree` | `src/tree.ts` | Tree-Helfer (nur Generatoren, lädt `@nx/devkit`): `listLibPaths`, `libExists`, Scope-Liste lesen/schreiben, `assertSliceExists`, `assertKebabCase`, `forEachSourceFile`; Config: `writeLibConfig` (Dateien + `paths`, peers aus den Imports), `addSpecConfig`, `relocateLibConfig`, `addLibPaths`/`removeLibPaths`, `updateImplicitDependencies`, `productionPeerDependencies` |
| `@blueprint/tooling-conventions/testing` | `src/testing/blueprint-tree.ts` | Fixture-Workspace der Generator-Specs (`createBlueprintTree` mit Config pro Lib, `read`, `scopesOf`, `readProject`, `pathsOf`) |

Jeder Export steht zusätzlich exakt in `tsconfig.base.json` → `paths` (Grund: [Übersicht → Laden ohne Build](../README.md#laden-ohne-build)).

Die Tags schreiben die Generatoren in `project.json`; `tooling-verify:verify` leitet sie unabhängig aus dem Pfad ab und vergleicht. Die Konventionen sind deshalb kein Input der Lib-Tasks mehr (`nx affected` auf `lib-conventions.ts` betrifft nur Tooling).

Tests: `nx test tooling-conventions` (Pfad-Konventionen, Tags, Scope-Fehler, Config-Vorlagen, Umzug).
