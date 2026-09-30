# Ansätze mit reinem Nx (ohne Sheriff)

Gegenstück zu [`ansaetze.md`](./ansaetze.md): dieselben drei Ansätze, aber nur mit Nx-Libs, Tags und `@nx/enforce-module-boundaries`. Sheriff war nur für Regeln innerhalb einer Lib erlaubt. Gebraucht wurde es am Ende **in keinem** der drei Ansätze.

Alle Angaben stammen aus tatsächlich ausgeführten Läufen (Stand 30. September 2026). Details je Ansatz: [Blueprint](./nx-umsetzung-blueprint.md) · [Inverted](./nx-umsetzung-inverted.md) · [Hexagonal-Core](./nx-umsetzung-hexcore.md). Auf den Branches liegen sie jeweils als `docs/nx-umsetzung.md`.

## Läuft es?

| Branch | Basis | Libs (alle buildable) | `nx run-many` | Boundary-Tests | App-Build | Sheriff |
|---|---|---|---|---|---|---|
| `feat/nx-blueprint` | `feat/sheriff-config-blueprint` | 32 | ✅ build, lint, test, typecheck (34 Projekte) | ✅ 38/38 | gegen `dist/` | entfernt |
| `feat/nx-inverted-domain-ports` | `feat/inverted-domain-ports` | 34 | ✅ build, lint, test, typecheck (36 Projekte) | ✅ 52/52 | aus Source (`dist/` getestet, Option) | entfernt |
| `feat/nx-hexagonal-core` | `feat/hexagonal-framework-core` | 19 | ✅ build, lint, typecheck (21 Projekte) | ✅ 60/60 | gegen `dist/` | entfernt |

- Die Boundary-Tests laufen je Branch mit `pnpm verify:boundaries` (`tools/verify-boundaries.mjs`). Das Skript lintet echte Verstöße und erlaubte Imports über die ESLint-API und prüft dazu das Tag-Schema.
- Mit einer Mutationsprobe ist belegt, dass die Tests rot werden, wenn man eine Regel abschwächt.
- `type:types` darf in allen drei Ansätzen andere `type:types`-Libs importieren, sonst nichts (vorher Blueprint/Inverted: types → nichts). Die Scope-Regeln gelten weiter: eigener Scope + `scope:shared` ja, fremde Slice-Types nein, auch nicht über `port`.

## Grundmuster

Nx kennt nur Grenzen zwischen Projekten. Deshalb wird aus jedem Sheriff-Modul (Ordner) eine eigene Lib.

| Sheriff | Nx |
|---|---|
| Modul = Ordner, Tags in `sheriff.config.ts` | Lib = Ordner mit `project.json`, Tags dort |
| `depRules` (Allow-Liste) | `depConstraints` → `onlyDependOnLibsWithTags` |
| kein Verbot möglich (nur mit dem Fork: `denyRules`) | `notDependOnLibsWithTags`. Jede passende Constraint muss den Import erlauben (UND), also braucht es keinen „kein `'*'`"-Workaround. |
| keine Regeln für npm-Pakete (nur mit dem Fork: `externalRules`) | `bannedExternalImports` / `allowedExternalImports`, z.B. HttpClient nur in infra bzw. adapter-driven, Kern nur `@angular/core` + rxjs |
| `sameTag` | gibt es nicht. Eine Helfer-Funktion in `eslint.config.mjs` erzeugt eine Constraint pro Scope aus `libs/**/project.json`. |
| Barrel / `enableBarrelLess` | `src/index.ts` als Public API, genau ein Pfad-Alias pro Lib. Deep-Imports blockt ein aus den Paths generiertes `no-restricted-imports`. |
| Slice-Root über Dateipfad (`inAnyFeat`) | eigene Lib `type:shell` bzw. `providers`. In Nx ist das natürlicher als Sheriffs Pfad-Hack. |
| noTag | Projekt ohne passende Tags darf nichts importieren |
| – | extra: Zyklen-Check, Lazy-Load-Check, Build-Cache/`affected` pro Lib |
| – | extra: buildable Libs, incremental Build pro Lib |

## Buildable Libs (alle drei)

| Punkt | Stand |
|---|---|
| Executor | `@nx/angular:ng-packagr-lite` (`ng-packagr` ~22.0 als devDep), Target-Config in `nx.json` → `targetDefaults.build` (`dependsOn: ["^build"]`, cache, Output `dist/{projectRoot}`) |
| Pro Lib zusätzlich | `package.json` (Name = Import-Alias, `private: true`, `peerDependencies`), `ng-package.json`, `tsconfig.lib.json`, `tsconfig.lib.prod.json`. Inverted/hexcore erzeugen sie per `node tools/make-libs-buildable.mjs` (idempotent) |
| Output | `esm2022/` + `.d.ts`, full compilation, **kein FESM**. Reicht für den Workspace, **nicht publizierbar**. Publizierbar wäre `@nx/angular:package` |
| Source-Aliase | `tsconfig.base.json` zeigt weiter auf `src/index.ts` (IDE, typecheck, lint). ng-packagr-lite biegt nur beim Lib-Build auf `dist/` um |
| App incremental | blueprint und hexcore: `@nx/angular:application` + `buildLibsFromSource: false`, bündelt aus `dist/`. Lazy-Chunks bleiben. Inverted: getestet, aber nicht umgesetzt (bringt bei 34 Mini-Libs kaum Zeit) |
| `serve` | bleibt `@angular/build:dev-server` aus Source. Gegen `dist/` bräuchte es `@nx/angular:dev-server` + `@angular-devkit/build-angular` |
| `enforceBuildableLibDependency` | an. Greift nur noch bei neuer Lib ohne `build` |
| Nebeneffekt | Nx leitet aus der lib-`package.json` das Tag `npm:private` ab. Keine Constraint nutzt es |
| Dauer | inverted: `run-many -t build` ≈17 s kalt, hexcore ≈10 s kalt. Einzelne Lib ≈0,4–2 s, danach Cache |

## ESLint ohne Projekt-Graph (gefixt)

- `@nx/enforce-module-boundaries` liest nur den **gecachten** Projekt-Graph. Fehlt er (frischer Clone, `nx reset`, `eslint` direkt, IDE, lint-staged), wurde die Regel **still übersprungen**: nur eine Warnung, Exit 0.
- `nx lint` war nicht betroffen, weil es den Graph vorher baut.
- Fix in allen drei `eslint.config.mjs`: beim Laden den Graph bauen/aktualisieren (`createProjectGraphAsync()`, top-level `await`). Fehler brechen die Config ab statt zu überspringen. Nebeneffekt: kein veralteter Cache mehr.
- Kosten ≈0,4–2 s pro ESLint-Start ohne Daemon.
- Geprüft: echter Verstoß + `eslint <datei>` ohne Graph-Cache → Fehler statt Skip. Hexcore prüft das im Verify-Skript mit leerem `NX_WORKSPACE_DATA_DIRECTORY`.

## Je Ansatz

### Blueprint → `feat/nx-blueprint`

- Eine Lib pro Slice × Layer (`booking/{types,utils,events,api,data,ui,shell}`). Die Unterordner eines Feats (`feat-x/{feature,api,data,ui}`) sind ebenfalls eigene Libs.
- Feat-Isolation: Nx kennt keine Negation. Deshalb gibt es den positiven Marker `feat:none` für alles außerhalb eines Feats, dazu `feat:<f>` und `feat-port`.
- `sharedFeatures` fällt weg, auth und layout sind normale Scopes.
- Buildable + App baut gegen `dist/` (Chunks identisch zum Source-Build).

### Inverted Domain Ports → `feat/nx-inverted-domain-ports`

- Die Inversion ist sauber abgebildet: api↛infra, data↛infra und feat↛infra sind rot, nur `type:shell` darf infra.
- Das Tag-Schema ist hierarchisch: `scope:<slice>/feat-<f>`, zusammengefasst per Regex. Die Negation läuft über einen Regex-Lookahead (`/^type:(?!shell$)/`).
- ⚠️ **Der self-providing port (`fe846c0`, auf main `f9de900`) ist zurückgedreht.** Grund:
  - Mit api und infra als getrennten Libs ist api→infra→api ein Projekt-Zyklus, den Nx immer meldet.
  - Deshalb gilt wieder die harte Inversion: `provideBooking()` liegt in `booking/shell`.
  - Wer den self-providing port behalten will, muss api und infra zu einer Lib zusammenlegen. Die Regel api↔infra wäre dann nur noch per Sheriff innerhalb der Lib prüfbar.
- **Feat-Alias `…/feat-x/feature`** statt `…/feat-x`. Grund: ng-packagr hält jeden Import `<eigener Paketname>/…` für einen Secondary Entry Point. `…/feat-check-booking` → `…/feat-check-booking/data` bricht den Build. Kein Paketname darf Präfix eines anderen sein.
- **`type:tooling`** auf `packages/*`: darf nur `type:tooling`. Den noTag-Fall prüft das Verify-Skript jetzt mit einem Wegwerf-Projekt (`tools/verify-untagged`).

### Hexagonal-Core → `feat/nx-hexagonal-core`

- Pro Slice gibt es 8 Libs: `model`, `domain`, `port-in`, `port-out`, `adapter-driving`, `adapter-driven`, `providers`, `shell`.
- Der Kern hat `allowedExternalImports` (`@angular/core`, rxjs). HttpClient, Router und `rxjs/ajax` sind damit ohne Fork verboten.
- **Zyklus `domain ↔ port-out` aufgelöst durch `<slice>-model`-Lib** (Entitäten, IDs, reine Werte-Funktionen).
  - Vorher: `ignoredCircularDependencies` + „nur `import type`" per `no-restricted-imports`. Mit buildable Libs geht das nicht mehr: der Zyklus blockiert den Task-Graph (`booking-domain:build → booking-port-out:build → booking-domain:build`), und ng-packagr bräuchte gegenseitig die `.d.ts` aus `dist/`.
  - Jetzt DAG `model ← port-out ← domain`. `ignoredCircularDependencies` und der `no-restricted-imports`-Block sind weg.
  - `type:port-out` → nur `model`/`types` (enger als vorher `domain`). `type:model` → nur `model`/`types`, `allowedExternalImports: []`, also frameworkfrei erzwungen.
  - Fall „port-out: `import type` der Domain" ist jetzt rot statt grün.
- `providers` und `shell` sind getrennt, weil Nx eine Lib nicht zugleich statisch und lazy importieren lässt.
- **Strikter Hexagon (frameworkfreier Kern) ist mit Nx ohne Fork machbar**, indem man dem Kern `allowedExternalImports: []` gibt. Die `core:*`-Achse fällt weg. Der Signal-Store braucht aber weiterhin eine Lib mit Angular. Das ist nur skizziert, nicht umgesetzt.

## Limitierungen (alle drei)

| Limitierung | Lösung |
|---|---|
| Nx prüft nur zwischen Libs | eine Lib pro Layer, dadurch viele Libs (19–34 für eine kleine Demo) |
| kein `sameTag`, keine Negation | Constraints per Helfer erzeugen, Marker-Tags, Regex-Lookahead. Ein Tag-Tippfehler würde still einen neuen Scope erzeugen, deshalb gleicht das Verify-Skript Tags gegen den Ordnerpfad ab. |
| `notDependOnLibsWithTags` wirkt transitiv | nur für echte „nie, auch nicht indirekt"-Regeln einsetzen, sonst Allow-Listen |
| Zyklen-Check läuft vor dem Tag-Check | Verstoß bleibt rot, aber die Meldung heißt „Circular dependency". Das Skript belegt die Tag-Entscheidung separat. |
| Nx erkennt Deep-Imports über den Alias nicht | `no-restricted-imports`, generiert aus den tsconfig-Paths |
| ohne gecachten Projekt-Graph überspringt die Regel still (IDE, `eslint` direkt) | gefixt: `eslint.config.mjs` baut den Graph beim Laden (≈0,4–2 s pro Start ohne Daemon) |
| Globals (`fetch`, `new Date()`) sind unsichtbar | offen. Sheriff konnte das auch nicht, Option: `no-restricted-globals` |
| Code innerhalb der App ist nicht prüfbar | alles, wofür Regeln gelten sollen, muss eine Lib sein |
| Lib-Zyklen blockieren den Build (Task-Graph) | Zyklen nicht per Ignore dulden, sondern auflösen (hexcore: `model`-Lib) |
| ng-packagr: Paketname als Präfix eines anderen = Secondary Entry Point | Alias ohne Präfix-Überlappung (inverted: `…/feature`) |
| buildable Output nicht publizierbar | für Publish `@nx/angular:package` |

## Bewertung

- **Nx allein reicht für alle drei Ansätze.** Sheriff innerhalb einer Lib war nicht nötig.
- Nx bringt ohne Fork die beiden Fork-Features mit: Verbote und Regeln für npm-Pakete.
- Preis: viel Boilerplate (7 Dateien pro Lib inkl. Build-Dateien, dazu 1 Path) und ohne Generator viel Reibung.
- Sheriff ist leichter (Ordner statt Libs), braucht aber für Verbote und npm-Regeln den Fork.

## Offen

- Generator für das Nx-Layout, der einen Slice bzw. ein Feat als buildable Lib-Set anlegt (inkl. Build-Dateien). Die bestehenden Generatoren erzeugen noch das Sheriff-Layout.
- `verify:boundaries` als Nx-Target bzw. in die CI (CI-Workflow fehlt auf den Branches).
- Lint-Targets auf inferred migrieren (`@nx/eslint:lint` ist deprecated).
- Self-providing port unter Nx: api und infra zusammenlegen oder bei der harten Inversion bleiben?
- Inverted: App auch gegen `dist/` bauen (wie blueprint/hexcore)?
- `serve` gegen `dist/` (`@nx/angular:dev-server`)? Aktuell bewusst nicht.
- Kern-Globals (`new Date()`, `fetch`) per `no-restricted-globals` absichern.
