# Ansätze mit reinem Nx (ohne Sheriff)

Gegenstück zu [`ansaetze.md`](./ansaetze.md): dieselben drei Ansätze, aber nur mit Nx-Libs, Tags und `@nx/enforce-module-boundaries`. Sheriff war nur für Regeln innerhalb einer Lib erlaubt. Gebraucht wurde es am Ende **in keinem** der drei Ansätze.

Alle Angaben stammen aus tatsächlich ausgeführten Läufen (Stand 23. September 2026). Die Details stehen je Branch in `docs/nx-umsetzung.md`.

## Läuft es?

| Branch | Basis | Libs | `nx run-many` | Boundary-Tests | Sheriff |
|---|---|---|---|---|---|
| `feat/nx-blueprint` | `feat/sheriff-config-blueprint` | 32 | ✅ build, lint, test, typecheck (34 Projekte) | ✅ 38/38 | entfernt |
| `feat/nx-inverted-domain-ports` | `feat/inverted-domain-ports` | 34 | ✅ build, lint, test (36 Projekte) | ✅ 46/46 | entfernt |
| `feat/nx-hexagonal-core` | `feat/hexagonal-framework-core` | 17 | ✅ build, lint, typecheck (19 Projekte) | ✅ 47/47 | entfernt |

- Die Boundary-Tests laufen je Branch mit `pnpm verify:boundaries` (`tools/verify-boundaries.mjs`). Das Skript lintet echte Verstöße und erlaubte Imports über die ESLint-API und prüft dazu das Tag-Schema.
- Mit einer Mutationsprobe ist belegt, dass die Tests rot werden, wenn man eine Regel abschwächt.

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

## Je Ansatz

### Blueprint → `feat/nx-blueprint`

- Eine Lib pro Slice × Layer (`booking/{types,utils,events,api,data,ui,shell}`). Die Unterordner eines Feats (`feat-x/{feature,api,data,ui}`) sind ebenfalls eigene Libs.
- Feat-Isolation: Nx kennt keine Negation. Deshalb gibt es den positiven Marker `feat:none` für alles außerhalb eines Feats, dazu `feat:<f>` und `feat-port`.
- `sharedFeatures` fällt weg, auth und layout sind normale Scopes.

### Inverted Domain Ports → `feat/nx-inverted-domain-ports`

- Die Inversion ist sauber abgebildet: api↛infra, data↛infra und feat↛infra sind rot, nur `type:shell` darf infra.
- Das Tag-Schema ist hierarchisch: `scope:<slice>/feat-<f>`, zusammengefasst per Regex. Die Negation läuft über einen Regex-Lookahead (`/^type:(?!shell$)/`).
- ⚠️ **Der self-providing port (`fe846c0`, auf main `f9de900`) ist zurückgedreht.** Grund:
  - Mit api und infra als getrennten Libs ist api→infra→api ein Projekt-Zyklus, den Nx immer meldet.
  - Deshalb gilt wieder die harte Inversion: `provideBooking()` liegt in `booking/shell`.
  - Wer den self-providing port behalten will, muss api und infra zu einer Lib zusammenlegen. Die Regel api↔infra wäre dann nur noch per Sheriff innerhalb der Lib prüfbar.

### Hexagonal-Core → `feat/nx-hexagonal-core`

- Pro Slice gibt es 7 Libs: `domain`, `port-in`, `port-out`, `adapter-driving`, `adapter-driven`, `providers`, `shell`.
- Der Kern hat `allowedExternalImports` (`@angular/core`, rxjs). HttpClient, Router und `rxjs/ajax` sind damit ohne Fork verboten.
- Zyklus `domain ↔ port-out`: Nx unterscheidet `import type` nicht von normalen Imports.
  - Lösung: `ignoredCircularDependencies`, gezielt pro Slice erzeugt.
  - Dazu erlaubt `no-restricted-imports` in port-out nur `import type` aus der Domain.
- `providers` und `shell` sind getrennt, weil Nx eine Lib nicht zugleich statisch und lazy importieren lässt.
- **Strikter Hexagon (frameworkfreier Kern) ist mit Nx ohne Fork machbar**, indem man dem Kern `allowedExternalImports: []` gibt. Die `core:*`-Achse fällt weg. Der Signal-Store braucht aber weiterhin eine Lib mit Angular. Das ist nur skizziert, nicht umgesetzt.

## Limitierungen (alle drei)

| Limitierung | Lösung |
|---|---|
| Nx prüft nur zwischen Libs | eine Lib pro Layer, dadurch viele Libs (17–34 für eine kleine Demo) |
| kein `sameTag`, keine Negation | Constraints per Helfer erzeugen, Marker-Tags, Regex-Lookahead. Ein Tag-Tippfehler würde still einen neuen Scope erzeugen, deshalb gleicht das Verify-Skript Tags gegen den Ordnerpfad ab. |
| `notDependOnLibsWithTags` wirkt transitiv | nur für echte „nie, auch nicht indirekt"-Regeln einsetzen, sonst Allow-Listen |
| Zyklen-Check läuft vor dem Tag-Check | Verstoß bleibt rot, aber die Meldung heißt „Circular dependency". Das Skript belegt die Tag-Entscheidung separat. |
| Nx erkennt Deep-Imports über den Alias nicht | `no-restricted-imports`, generiert aus den tsconfig-Paths |
| ohne Projekt-Graph überspringt die Regel still | Skript bzw. CI baut den Graph vorher |
| Globals (`fetch`, `new Date()`) sind unsichtbar | offen. Sheriff konnte das auch nicht, Option: `no-restricted-globals` |
| Code innerhalb der App ist nicht prüfbar | alles, wofür Regeln gelten sollen, muss eine Lib sein |

## Bewertung

- **Nx allein reicht für alle drei Ansätze.** Sheriff innerhalb einer Lib war nicht nötig.
- Nx bringt ohne Fork die beiden Fork-Features mit: Verbote und Regeln für npm-Pakete.
- Preis: viel Boilerplate (4 Dateien pro Lib) und ohne Generator viel Reibung.
- Sheriff ist leichter (Ordner statt Libs), braucht aber für Verbote und npm-Regeln den Fork.

## Offen

- Generator für das Nx-Layout, der einen Slice bzw. ein Feat als Lib-Set anlegt. Die bestehenden Generatoren erzeugen noch das Sheriff-Layout.
- `verify:boundaries` als Nx-Target bzw. in die CI (CI-Workflow fehlt auf den Branches).
- Lint-Targets auf inferred migrieren (`@nx/eslint:lint` ist deprecated).
- Self-providing port unter Nx: api und infra zusammenlegen oder bei der harten Inversion bleiben?
