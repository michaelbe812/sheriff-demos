# @berger-engineering/sheriff-blueprint

Geteiltes Sheriff-Regelwerk (vertical slices, Ports auf jeder Ebene) + Nx-Generatoren. Regel-Doku: `docs/architecture.md` im Blueprint-Repo.

## Setup in einem Projekt

```sh
pnpm add -D @berger-engineering/sheriff-blueprint @softarc/sheriff-core @softarc/eslint-plugin-sheriff
```

`sheriff.config.ts` (Workspace-Root):

```ts
import { createSheriffConfig } from '@berger-engineering/sheriff-blueprint';

export const config = createSheriffConfig({
  sharedFeatures: ['auth', 'layout'],
  entryPoints: { client: 'apps/client/src/main.ts' },
  // extraModules / extraDepRules für Projekt-Sonderfälle
});
```

`eslint.config.mjs`:

```js
import sheriff from '@softarc/eslint-plugin-sheriff';
import { nxModuleBoundariesOptions } from '@berger-engineering/sheriff-blueprint';

export default [
  // ...nx configs
  sheriff.configs.all,
  { files: ['**/*.ts'], rules: { '@nx/enforce-module-boundaries': ['error', nxModuleBoundariesOptions('@blueprint')] } },
];
```

Wichtig: Die Config wird von Sheriff transpiliert und ge-evalt — das Package muss als **gebautes** Package in node_modules liegen (npm-Registry oder workspace-Link mit `prepare`-Build). Relative Imports in sheriff.config.ts funktionieren nicht.

## Generatoren

```sh
nx g @berger-engineering/sheriff-blueprint:domain booking            # Lib unter libs/domains/ + Alias + project.json
nx g @berger-engineering/sheriff-blueprint:domain billing --app client   # app-intern
nx g @berger-engineering/sheriff-blueprint:feat check-booking --domain booking [--app client]
nx g @berger-engineering/sheriff-blueprint:shared-feature auth --app client   # danach in sharedFeatures eintragen!
```

## Konventionen (load-bearing)

- `feat-<name>/` Prefix (pfadbasierte Feat-Isolation) · Domains unter `domains/` · Shared-Features im Root, explizit in `sharedFeatures` gelistet
- top-level `internal/` in einem Modul = modul-privat
- Libs flach unter `src/`, **kein `index.ts`**, Wildcard-Alias `@blueprint/domains/<d>/*`

## Tests

`nx test sheriff-blueprint` — Unit (Regel-Funktionen), Generatoren (devkit-Tree), e2e (echtes Workspace: `sheriff verify` + eslint-Violations über die gesamte Kette Package → Sheriff → ESLint).
