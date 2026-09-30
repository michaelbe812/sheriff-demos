# @blueprint/tooling-eslint-rules

ESLint-Regeln des Namensschemas (Plugin-Präfix `blueprint/`). Projekt `tooling-eslint-rules` (`type:tooling`, `tooling:eslint-rules`), importiert nur `@blueprint/tooling-conventions`. Übersicht: [`packages/tooling`](../README.md), Namensschema: [`docs/nx-umsetzung.md` → Namensschema](../../../docs/nx-umsetzung.md#namensschema).

Layer, Scope und Feat kommen aus `parseLibPath` der Konventionen, also aus demselben Parser, mit dem das Crystal-Plugin die Tags ableitet. Die Tabellen (`FILE_KINDS`, `KIND_ONLY_LAYERS`, `KIND_FOLDERS`, `INTERNAL_FOLDER`) stehen ebenfalls in `lib-conventions.ts`. Generierte Client-Libs und `src/generated/**` sind ausgenommen.

| Regel | prüft | Fix |
|---|---|---|
| <a id="lib-file-naming"></a>`blueprint/lib-file-naming` | Dateien unter `src/`: kebab-case (Ordner + Name), `<name>.<kind>.ts` nur im Layer der Kind (`.store.ts` → data/ui/feature, `.routes.ts`/`.providers.ts`/`.shell.ts` → shell, `.model.ts`/`.dto.ts` → types, `.utils.ts` → utils, `.events.ts` → events, `.mapper.ts` → data, `.fixture.ts`/`.handlers.ts` → testing in `fixtures/`/`handlers/`), unbekannte Kinds (`.service.ts`, `.component.ts`), Slice-Libs `types`/`utils`/`events` nur mit Kind (Shared-Buckets ausgenommen). Specs wie die getestete Datei | keiner (ESLint benennt keine Dateien um) |
| <a id="layer-symbol-naming"></a>`blueprint/layer-symbol-naming` | exportierte Symbole ↔ Datei/Layer/Scope/Feat: `<n>.store.ts` → `<N>Store` (und `*Store` nur in `.store.ts`), `<n>-api.ts` → Klasse `<N>Api` (und `*Api`-Klassen nur in `-api.ts`), `feat-<f>.ts` im feature-Lib des Feats → `Feat<F>` (Datei muss `feat-<feat>.ts` heißen), `@Component` in `<n>.ts` → Klasse `<N>` oder `<Prefix><N>` (`AppButton`), Selektor `<prefix>-<n>`, Shell-Dateien `<scope>.routes\|providers\|shell.ts`, Routes-Export `<scope>Routes`, Provider `provide<X>()`, Fixtures `a<X>()`/`an<X>()`, `<n>.handlers.ts` → `<n>Handlers`/`<n>Scenarios`. Option `selectorPrefix` (Default `app`) | Vorschläge (IDE-Quick-Fix) für Komponentenklasse und Selektor, kein Autofix |
| <a id="no-internal-export"></a>`blueprint/no-internal-export` | `src/index.ts` exportiert/importiert nichts aus `internal/` | keiner |

**Kein Autofix:** Jedes geprüfte Symbol ist exportiert. Ein Fix in einer Datei würde die Importeure brechen (ESLint fixt dateiweise), eine Datei-Umbenennung kann ESLint gar nicht. Umbenennen per IDE (Rename Symbol) oder `nx g @blueprint/tooling-workspace:rename|move`.

## Laden

`eslint.config.mjs` lädt die Regeln per `loadWorkspaceRules` aus `@nx/eslint-plugin` direkt aus den Quellen (swc, kein Build, gleiche Mechanik wie Nx' `tools/eslint-rules`, nur mit eigenem Pfad). Ein Ladefehler endet als *Could not find "blueprint/…"*, nie als still fehlende Regel. Der Nx-Generator `@nx/eslint:workspace-rule` passt nicht: fester Ordner `tools/eslint-rules`, `project.json` mit Jest, Präfix `@nx/workspace-`.

Die `lint`-Targets aller Libs haben `packages/tooling/eslint-rules/src/**` (ohne Specs) als Input (Plugin `@blueprint/tooling-workspace`), `nx affected` erreicht sie also bei einer Regeländerung (Probe in `verify`).

## Tests

`nx test tooling-eslint-rules`: RuleTester (`@typescript-eslint/rule-tester` auf Vitest), valid/invalid je Regel inkl. aller Beispiel-Dateinamen des Workspaces, Meldungsdaten und Vorschläge. Die Verdrahtung in der echten Config prüft `pnpm verify` (Fälle `naming: …`).
