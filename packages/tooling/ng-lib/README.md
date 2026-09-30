# @blueprint/tooling-ng-lib

Ein Executor für die Lib-Tests. Projekt `tooling-ng-lib` (`type:tooling`, `tooling:ng-lib`), importiert keine andere Tooling-Lib. Übersicht: [`packages/tooling`](../README.md).

| Executor | Datei | Aufgabe |
|---|---|---|
| `@blueprint/tooling-ng-lib:test` | `src/test.js` | reicht unverändert an `@nx/angular:unit-test` (Vitest Browser Mode) durch; mit `ui` zusätzlich watch + headed Browser (Vitest UI) |
| Hasher von `:test` | `src/test-hasher.js` | `--ui`-Läufe bekommen einen einmaligen Hash (nie aus dem Cache), sonst unverändert der Nx-Hash |

Body des `test`-Targets: `nx.json` → `targetDefaults.test` (`tsConfig: {projectRoot}/tsconfig.spec.json`, `runnerConfig`, `browsers`, `watch: false`); `packages/tooling/ng-lib/src/**` ist Input aller `test`-Tasks.

**Was auf `feat/nx-blueprint` noch hier lag und entfallen ist:** `build` (temporäre `ng-package.json`/`package.json`/tsconfig, → `@nx/angular:ng-packagr-lite` mit den Dateien der Lib), `application` (dist-Paths für die App, → `@nx/angular:application`: Nx mappt den Alias über die lib-`package.json`), `lib.js` (Alias-/dist-Path-Helfer), `typecheck-lib.mjs` (→ `tsc -p {projectRoot}/tsconfig.json`), und im `test`-Wrapper das Umbiegen des Build-Targets und die spec-tsconfig pro Lib (echte `ng-package.json` + `tsconfig.spec.json`).

**Warum der Wrapper bleibt:** Ein Hasher hängt an einem Executor (`executors.json` → `hasher`), an `@nx/angular:unit-test` lässt er sich nicht hängen. Ohne ihn geht die UI mit dem Standard-Executor auch (`nx run <lib>:test --ui --watch --browsers=chromium --skip-nx-cache`, getestet: `@nx/angular:unit-test` direkt in `targetDefaults` → Tests grün), ein regulär beendeter UI-Lauf würde aber gecacht und beim nächsten Aufruf nur abgespielt. Einzige Nx-Interna: der Import von `@nx/angular/src/executors/unit-test/unit-test.impl` und das Laden des Hashers, beides prüft `pnpm verify:nx-internals`.

## Vitest UI

Kein eigenes Target: `nx run <lib>:test --ui`. Mit `ui` setzt der Executor `watch: true` und die Browser auf headed (`chromiumHeadless` → `chromium`, Angular schaltet dann Vitests Browser-UI mit Vorschau ein); `--headless` erzwingt weiter headless. Normale Läufe (`run-many -t test`) bleiben headless, einmalig, gecacht; unter `CI=true` schaltet der Angular-Builder `ui` ohnehin ab. Paket `@vitest/ui` (gleiche Version wie `vitest`).

Flag statt Configuration `test:ui`: die UI-Logik liegt an einer Stelle (Executor), der Graph bleibt ein Target mit einer Optionsmenge. Cache: Overrides gehen in den Nx-Hash, ein UI-Lauf trifft nie den normalen `test`-Eintrag. Damit auch eine regulär beendete UI (Vitest `q`, Builder meldet Erfolg) beim nächsten `--ui` nicht nur aus dem Cache abgespielt wird, hasht `src/test-hasher.js` UI-Läufe einmalig (siehe `pnpm verify:nx-internals`).

```sh
pnpm test:ui booking-api                             # = nx run booking-api:test --ui, UI: http://localhost:51204/__vitest__/
pnpm exec nx run booking-api:test --ui --headless    # ohne Browserfenster
```
