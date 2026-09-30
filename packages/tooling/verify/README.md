# @blueprint/tooling-verify

Beweise des Blueprints, von außen: Projekt-Graph, echte ESLint-Config, git. Projekt `tooling-verify` (`type:tooling`, `tooling:verify`), importiert keine andere Tooling-Lib. Übersicht: [`packages/tooling`](../README.md).

| Befehl | Datei | prüft |
|---|---|---|
| `pnpm verify` = `nx run tooling-verify:verify` (gecacht) | `scripts/verify-boundaries.mjs` | 150 Lint-Fälle gegen die echte ESLint-Config (46 für generierte Clients, 19 für die Tooling-Libs, 14 für die Namensregeln: Verdrahtung, Selektor-Präfix, Ausnahme generierter Code), Tag-Schema + Scope-Liste, Test-Isolation (genau ein `test`-Target: gecacht, headless, UI per `--ui`; `tooling-openapi:test` mit Coverage), neue Lib ohne Config, keine Config-Dateien in `libs/`, generierte Clients (Eintrag ↔ Ordner ↔ Spec ↔ Libs, Kanten, Targets, nichts committet), Tooling-Libs (Name/Paket/Tags, `exports` ↔ `tsconfig.base.json` `paths`), `nx affected` erreicht die Nutzer jeder Tooling-Datei (8 Proben), Scan des Client-Bundles (msw, vitest, faker). Inputs: `libs/**`, `apps/**`, `packages/tooling/**`, `eslint.config.mjs`, `nx.json`, `openapi-clients.json`, `tsconfig.base.json`, `package.json`, Output von `client:build` (dependsOn) |
| `pnpm verify:nx-internals` | `scripts/verify-nx-internals.mjs` | nach `nx migrate` / Angular-Update: run-many `--skip-nx-cache` in frisches `dist/`, dist-Äquivalenz gegen `nx-internals/dist-hashes.json` (oder `--reference <dir>`, `--update-snapshot`), Marker „App baut gegen dist“, MSW-Probe „fehlender Handler → rot“, MSW-Worker aus dem msw-Paket, `tooling-verify:verify` |
