# Sheriff Blueprint — Architektur & Regelwerk

Skalierbare `sheriff.config.ts` für alle Projekte. Funktioniert identisch für app-interne Domains (`apps/<app>/src/app/domains/…`) und extrahierte Nx-Libs (`libs/domains/…`) — Extraktion = reiner Folder-Move, null Regeländerung.

## Grundprinzip

**Alles ist ein Slice mit derselben Layer-Matrix; Zugriff von außen nur über einen Port.**

- Domain-`api/` → Tag `port` — public API für andere Domains
- Feat-`api/` → Tag `feat-port` — public API für Geschwister-Feats, nie sichtbar außerhalb der Domain
- Shared-Features (auth, layout, …) = Domains mit gleichem Mechanismus (deep modules, schmale API)

## Struktur

```
apps/<app>/src/
  main.ts                      root (implizites Root-Modul)
  app/                         app:<app>        Shell: app.ts, app.config.ts, app.routes.ts
    shared/                    shared + type:*  dumm: types/utils/api/ui (KEIN data!)
    shared-features/<sf>/      domain:<sf>      Slice-Shape (s.u.)
    domains/<domain>/          domain:<domain>  Slice-Shape (s.u.)

libs/
  shared/<bucket>/src/         shared + type:<bucket>
  shared-features/<sf>/src/    domain:<sf>      gleiches Slice-Shape
  domains/<domain>/src/        domain:<domain>  gleiches Slice-Shape

Slice-Shape (Domain, Shared-Feature — app-intern oder Lib):
  <slice>.routes.ts / shell    + entry           einziger Einstieg für App-Shell
  types/   utils/   events/   data/   ui/
  api/                         + port            PUBLIC PORT
  feat-<feat>/                 + feat:<feat>     strikt privat, gleiche Buckets
    api/                       + feat-port       public für Geschwister-Feats
```

Kein `/internal`-Bucket nötig: barrel-less gibt jedem Modul per Default einen privaten `internal/`-Ordner (`encapsulationPattern`).

## Layer-Matrix (type-Achse)

| from \ to | types | utils | events | api | data | ui | feature |
|---|---|---|---|---|---|---|---|
| **types**   | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **utils**   | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **events**  | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **api**     | ✓ | ✓ | ✗* | ✓ | ✗ | ✗ | ✗ |
| **data**    | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| **ui**      | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| **feature** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

*api→events bei Bedarf: `'type:events'` in der `'type:api'`-Regel ergänzen (Einzeiler).

- `data` = Signal Stores + Business-Logic-Services (domain- oder feat-shared)
- `events` = Signal-Store-Events, definition-only (Type + Creator). ui/feature werfen, data handelt → deshalb eigener Bucket, den ui importieren darf (data nicht)
- ui-**lokale** Stores: colocated im ui-Bucket = type:ui bzw. intra-Modul (wird nie geprüft) → erlaubt
- Store-Regel aus README erfüllt: Domain-/Feat-Store (type:data) in ui → Violation

## Scope-Regeln

| von | darf |
|---|---|
| `root` (main.ts) | app:*, entry, port, shared — nur eigene App |
| `app:<app>` (Shell) | eigene App: entry (Slice-Roots), port, shared |
| `domain:<x>` | eigene Domain komplett; fremde Domain/SF nur `port`; shared |
| `feat:<f>` | eigenes Feat; alles außerhalb von `feat-*`-Ordnern; fremde Feats nur `feat-port` |
| `shared` | nur shared (Layer-Matrix gilt weiter) |
| `noTag` | nichts — unkonfigurierte Module fallen sofort auf |

- **App-Isolation:** pfadbasierter `sameApp`-Guard. Ziel in `apps/<x>` ⇒ gleiche App; Libs app-frei; lib→app blockiert. Kein app-Tag pro Modul nötig ⇒ Domain-Tags ortsunabhängig.
- **Cross-Domain-Types:** Port ist einziger Zugang — benötigte Types aus `api/` re-exportieren oder nach `shared/types` promoten.
- **Port mit State (Muster):** Port = Contract (InjectionToken + Interface), Impl in `data/`, Verdrahtung am Slice-Root (`provideAuth()` in `auth.providers.ts`). Konsument injiziert Token aus dem Port, sieht den Store nie.
- **AND-Semantik:** jedes from-Tag muss den Import unabhängig erlauben; ein Tag ist erfüllt, wenn EIN Ziel-Tag passt. Marker (`entry`, `port`, `feat-port`) sind deshalb als from-Tag transparent (`anyTag`) — Constraints kommen von den anderen Achsen.

## Naming-Konventionen (load-bearing!)

- `feat-<name>/` — Prefix wird von der Feat-Isolations-Regel per Pfad erkannt
- `domains/` bzw. `shared-features/` als Eltern-Ordner — verhindert Platzhalter-Kollisionen mit `shared`
- Libs: flach unter `src/` (kein `src/lib/`), **kein `index.ts`** (Barrel würde Modul-Semantik kippen), Wildcard-Alias `@blueprint/domains/<d>/*` in `tsconfig.base.json`

## Varianten-Vergleich

| | Variante | Pro | Contra |
|---|---|---|---|
| **A ✅** | Eine Root-Config, Platzhalter für Apps+Libs, pfadbasierte App-Isolation | Eine Regelsprache; Tags identisch vor/nach Extraktion (Zero-Config-Refactor); Port auf Bucket-Ebene; Slice-Generator hält Config klein | Key-Reihenfolge dokumentationspflichtig; Guard-Funktionen = eigener Code |
| B | Config je App/Lib | kleine Configs, Team-Ownership | Duplikation & Drift; App-Isolation nicht ausdrückbar; widerspricht "ein Blueprint" |
| C | Sheriff nur intern + Nx-Boundaries für Libs | Nx-native | Nx ist projekt-granular: "nur api-Bucket public" nicht ausdrückbar ohne Lib-pro-Bucket-Explosion (killt 1 Lib/Domain); zwei Regelsprachen |

Nx `@nx/enforce-module-boundaries` bleibt als grobes Netz (Projekt-Zyklen, buildable-Constraint). `checkDynamicDependenciesExceptions: ["@blueprint/**"]` nötig: statischer Port-Import in lazy geladene Domain-Lib ist bei uns gewollt (Sheriff governt das).

## Gotchas (verifiziert am Sheriff-0.19-Quellcode)

1. **AND-Semantik + Marker-Tags:** ohne `port: anyTag` dürfte ein api/port-Bucket seine eigenen types nicht importieren (Bug der ursprünglich kopierten Config).
2. **Kein `'*': 'shared'`-Catch-all:** gäbe JEDEM from-Tag Freigabe auf shared-Module und hebelt die Layer-Matrix innerhalb shared aus (utils→api wäre legal; ebenfalls Bug der kopierten Config). Stattdessen shared explizit pro Scope-Regel.
3. **Matching ist first-match-wins in Deklarationsreihenfolge** (nicht most-specific-wins). Unkritisch, weil Leaf-Keys nur komplette Modulpfade matchen — aber Literal-Keys (`shared`) vor Platzhaltern deklarieren.
4. **Verirrte `index.ts`** macht aus einem barrel-less Modul ein Barrel-Modul (alles nicht Re-exportierte wird privat, Modul ggf. `noTag`).
5. **`noTag: noDependencies`**: unkonfigurierte Module fallen sofort auf statt still durchzurutschen.
6. **CLI `sheriff verify`** prüft nur import-erreichbare Files ab Entry Point — ESLint ist die Autorität, CLI der CI-Cross-Check. Jede Lib braucht ein `tsconfig.json` neben dem Entry.
7. **TS 6:** `paths`-Targets relativ angeben (`./libs/…`), `baseUrl` ist deprecated.
8. **Intra-Modul-Imports werden nie geprüft** — deshalb sind component-lokale Stores im ui-Bucket frei.

## Entscheidungslog

| # | Entscheidung |
|---|---|
| D1 | Type-Achse: types/utils/events/api/data/ui/feature (api=http, data=stores getrennt) |
| D2 | ui: nur types/utils/events + lokale Stores; NICHT api, NICHT data |
| D3 | Cross-Domain nur via Port (= api-Bucket); Types re-exportieren/promoten |
| D4 | Kein core-Scope; stattdessen shared-features als Domain-Slices mit Port |
| D5 | Geschwister-Feats strikt privat; Austausch nur via feat-port |
| D6 | events als eigener Bucket (type:events) |
| D7 | Kein shared/data — stateful Singletons gehören in shared-features |
| D8 | Libs ohne Barrel, Wildcard-Aliase, 1 Lib/Domain, flach unter src/ |
| D9 | App-Isolation pfadbasiert (sameApp), nicht per Tag |

## Verifikation

```sh
npx sheriff list apps/client/src/main.ts   # Module + Tags, keine noTag erwartet
npx sheriff verify                          # alle entryPoints
npx nx run-many -t lint                     # ESLint = Autorität
npx nx build client
```

Negativbeispiele: In den Quellen markieren Kommentare `// sheriff-violation-example: import …` verbotene Imports (ui→data, ui→api, utils→api, cross-domain internals, SF internals, Geschwister-Feat internals, shell→ui). Einkommentieren ⇒ genau diese Violations feuern.

## Neues Projekt aufsetzen

1. `sheriff.config.ts` + ESLint-Block kopieren, `entryPoints` anpassen
2. Ordnerkonventionen einhalten (`domains/`, `shared-features/`, `feat-`, Buckets)
3. Domain extrahieren: Ordner nach `libs/domains/<d>/src` moven, Alias + `tsconfig.json` + `project.json` ergänzen, Imports von relativ auf Alias umstellen — Regeln unverändert
