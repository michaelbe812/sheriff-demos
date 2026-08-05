# @lambda-solutions/arc-presets

Sheriff architecture presets as an Nx plugin: a config factory, code generators,
and a one-shot installer that wires [Sheriff](https://sheriff.softarc.io) into a
workspace from a chosen architecture preset — using the
[`@lambda-solutions` Sheriff fork](https://www.npmjs.com/package/@lambda-solutions/sheriff-core)
(published v1) where a preset needs it.

The four presets and the reasoning behind each are documented in
[`docs/ansaetze.md`](../../docs/ansaetze.md).

## Presets

| id | architecture | fork required |
|---|---|---|
| `inverted` *(default)* | Vertical slice, `api/` contract + `infra/` impl | no |
| `blueprint` | Vertical slice, base (no `infra/`) | no |
| `hexagonal-fwcore` | Ports & Adapters, framework-aware core (3 layers) | no |
| `hexagonal-strict` | Ports & Adapters, framework-free core (`denyRules`) | **yes** |

## Setup in a target repo

```sh
pnpm add -D @lambda-solutions/arc-presets
nx g @lambda-solutions/arc-presets:init --preset inverted --app client
pnpm install          # installs the Sheriff engine the init added
pnpm sheriff:verify
```

`init` does four things:
1. writes `sheriff.config.ts` for the chosen preset,
2. adds the Sheriff engine deps (fork v1, or upstream `@softarc` with `--installFork=false`),
3. wires `sheriff.configs.all` into `eslint.config.*` (or prints a snippet),
4. adds a `sheriff:verify` npm script (and, with `--ci`, a GitHub Actions workflow).

### init options

| flag | default | meaning |
|---|---|---|
| `--preset` | `inverted` | one of the four ids above |
| `--app` | – | primary app name (seeds `entryPoints`) |
| `--installFork` | `true` | install the fork; `false` uses upstream `@softarc` (blocked for `hexagonal-strict`) |
| `--skipEslint` | `false` | don't touch `eslint.config.*`; print a snippet |
| `--ci` | `false` | drop `.github/workflows/sheriff.yml` |
| `--aliasPrefix` | `@blueprint` | tsconfig path-alias prefix for extracted libs |

## Generators

```sh
# vertical-slice presets (blueprint / inverted)
nx g @lambda-solutions/arc-presets:domain booking            # lib under libs/domains/
nx g @lambda-solutions/arc-presets:domain billing --app client
nx g @lambda-solutions/arc-presets:feat check-in --domain booking [--app client]
nx g @lambda-solutions/arc-presets:shared-feature auth --app client

# hexagonal presets (hexagonal-fwcore / hexagonal-strict)
nx g @lambda-solutions/arc-presets:hexagon booking --app client

# utilities
nx g @lambda-solutions/arc-presets:migrate         # blueprint -> inverted
nx g @lambda-solutions/arc-presets:doctor          # check config/deps/eslint/script
```

The slice generators detect the active preset from `sheriff.config.ts` (a marker
comment written by `init`); pass `--preset` to override.

## Library API

`sheriff.config.ts` on the vertical-slice presets calls the factory:

```ts
import { verticalSliceConfig } from '@lambda-solutions/arc-presets';

export const config = verticalSliceConfig('inverted', {
  sharedFeatures: ['auth', 'layout'],
  entryPoints: { client: 'apps/client/src/main.ts' },
});
```

Hexagonal presets use `hexagonalConfig(preset, { apps: { client: ['booking'] } })`.
Also exported: `nxModuleBoundariesOptions`, `slice`, `hexSlice`, `sameApp`,
`inAnyFeat`, `appOf`, `configTemplate`.

> Sheriff transpiles and evals `sheriff.config.ts`, so this package must be a
> **built** package in `node_modules` (npm registry or a workspace link with a
> `prepare` build). Relative imports in `sheriff.config.ts` do not work.

## Tests

`vitest run` — unit (preset factories produce valid configs), generators
(devkit `Tree`), and e2e (a scaffolded workspace where `sheriff verify` + eslint
run over the full chain).
