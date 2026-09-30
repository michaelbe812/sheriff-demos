# @blueprint/tooling-ng-lib

Executoren für Angular-Libs ohne `ng-package.json`, `package.json` und `tsconfig*.json` pro Lib. Alle Abhängigkeiten auf Nx-/Angular-Interna liegen hier an einer Stelle (`pnpm verify:nx-internals` prüft sie nach jedem Update). Projekt `tooling-ng-lib` (`type:tooling`, `tooling:ng-lib`), importiert keine andere Tooling-Lib. Übersicht: [`packages/tooling`](../README.md).

| Executor / Skript | Datei | Aufgabe |
|---|---|---|
| `@blueprint/tooling-ng-lib:build` | `src/build.js` | erzeugt `ng-package.json`, `package.json`, tsconfig (dist-Paths der Abhängigkeiten) temporär unter `tmp/ng-lib/` und delegiert an `@nx/angular:ng-packagr-lite` |
| `@blueprint/tooling-ng-lib:application` | `src/application.js` | `@nx/angular:application` gegen dist der Libs (Alias aus `tsconfig.base.json` statt lib-`package.json`) — `client:build` |
| `@blueprint/tooling-ng-lib:test` | `src/test.js` | `@nx/angular:unit-test` (Vitest Browser Mode) mit gemeinsamer spec-tsconfig, `include` auf die Lib verengt, Build-Target als `@angular/build:ng-packagr` im Builder-Context. Alle übrigen Optionen gehen unverändert durch; mit `ui` zusätzlich watch + headed Browser (Vitest UI) |
| Hasher von `:test` | `src/test-hasher.js` | `--ui`-Läufe bekommen einen einmaligen Hash (nie aus dem Cache), sonst unverändert der Nx-Hash |
| gemeinsame Helfer | `src/lib.js` | Alias-Auflösung, dist-Paths, tmp-Verzeichnis |
| `typecheck-lib` | `scripts/typecheck-lib.mjs` | `typecheck` einer Lib gegen `libs/tsconfig.json`, `include` per TS-API im Speicher verengt |

Die Targets inferiert `@blueprint/tooling-workspace`; `client:build` nutzt `application` in `apps/client/project.json` (`targetDefaults` in `nx.json`). `packages/tooling/ng-lib/src/**` ist Input von `build`/`test` aller Libs und von `client:build`, das Skript Input von `typecheck`. Details: [`docs/nx-umsetzung.md` → Executor-Wrapper](../../../docs/nx-umsetzung.md#executor-wrapper-packagestoolingng-lib).

## Vitest UI

Kein eigenes Target: `nx run <lib>:test --ui`. Mit `ui` setzt der Executor `watch: true` und die Browser auf headed (`chromiumHeadless` → `chromium`, Angular schaltet dann Vitests Browser-UI mit Vorschau ein); `--headless` erzwingt weiter headless. Normale Läufe (`run-many -t test`) bleiben headless, einmalig, gecacht; unter `CI=true` schaltet der Angular-Builder `ui` ohnehin ab. Paket `@vitest/ui` (gleiche Version wie `vitest`).

Flag statt Configuration `test:ui`: die UI-Logik liegt an einer Stelle (Executor), der Graph bleibt ein Target mit einer Optionsmenge. Cache: Overrides gehen in den Nx-Hash, ein UI-Lauf trifft nie den normalen `test`-Eintrag. Damit auch eine regulär beendete UI (Vitest `q`, Builder meldet Erfolg) beim nächsten `--ui` nicht nur aus dem Cache abgespielt wird, hasht `src/test-hasher.js` UI-Läufe einmalig (siehe `pnpm verify:nx-internals`).

```sh
pnpm test:ui booking-api                             # = nx run booking-api:test --ui, UI: http://localhost:51204/__vitest__/
pnpm exec nx run booking-api:test --ui --headless    # ohne Browserfenster
```
