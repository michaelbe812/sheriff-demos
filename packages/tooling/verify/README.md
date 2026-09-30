# @blueprint/tooling-verify

Beweise des Blueprints, von außen: Projekt-Graph, echte ESLint-Config, git. Projekt `tooling-verify` (`type:tooling`, `tooling:verify`), importiert keine andere Tooling-Lib. Übersicht: [`packages/tooling`](../README.md).

| Befehl | Datei | prüft |
|---|---|---|
| `pnpm verify` = `nx run tooling-verify:verify` (gecacht) | `scripts/verify-boundaries.mjs` | 134 Lint-Fälle gegen die echte ESLint-Config (46 für generierte Clients, 17 für die Tooling-Libs), Tag-Schema + Scope-Liste, Test-Isolation, neue Lib ohne Config, keine Config-Dateien in `libs/`, generierte Clients (Eintrag ↔ Ordner ↔ Spec ↔ Libs, Kanten, Targets, nichts committet), Tooling-Libs (Name/Paket/Tags, `exports` ↔ `tsconfig.base.json` `paths`), `nx affected` erreicht die Nutzer jeder Tooling-Datei (7 Proben), Scan des Client-Bundles (msw, vitest, faker). Inputs: `libs/**`, `apps/**`, `packages/tooling/**`, `eslint.config.mjs`, `nx.json`, `openapi-clients.json`, `tsconfig.base.json`, `package.json`, Output von `client:build` (dependsOn) |
| `pnpm verify:nx-internals` | `scripts/verify-nx-internals.mjs` | nach `nx migrate` / Angular-Update: run-many `--skip-nx-cache` in frisches `dist/`, dist-Äquivalenz gegen `nx-internals/dist-hashes.json` (oder `--reference <dir>`, `--update-snapshot`), Marker „App baut gegen dist“, MSW-Probe „fehlender Handler → rot“, MSW-Worker aus dem msw-Paket, `tooling-verify:verify` |
