# ArchUnitTS — Bewertung (Spike)

Stand: 2.10.2026, `archunit@2.5.4`. Spike-Branches (lokal, nicht gepusht):

| Branch | Basis | Suite | Proben |
|---|---|---|---|
| `tmp/archunit-reduced` | `feat/nx-reduced-blueprint` | 123 Tests grün | 35/38 wie erwartet |
| `tmp/archunit-explicit-config` | `feat/nx-blueprint-explicit-config` | 144 Tests grün | 43/46 wie erwartet |

Die 3 Abweichungen je Branch sind die bekannten Graph-Lücken (unten). Alles hier ist ausgeführt oder im Quellcode von `archunit` (dist, 2.5.4) nachgelesen; Unverifiziertes ist markiert.

```
pnpm arch          # nx run archunit:arch (gecacht)
pnpm arch:probes   # Negativproben: je Probe eine Temp-Datei, Suite laufen lassen, zurückbauen
vitest run --config tools/archunit/vitest.config.mts findings   # verifiziertes Verhalten von archunit als Asserts
```

Dateien: `tools/archunit/{blueprint.ts, architecture.spec.ts, findings.spec.ts, negative-probes.mjs, project.json, vitest.config.mts}`, `tsconfig.archunit.json` (Root).

## Kurzfazit

ArchUnitTS bildet das Regelwerk beider Branches **funktional fast vollständig** nach — aber nur, weil die Nx-depConstraints als Daten portiert und per Code in ~40 Deny-Regeln übersetzt werden (Komplementmenge statt Allow-List). Tags kennt es nicht; „Tags" kommen aus dem Pfad. Der Graph sieht nur `import … from`: **Re-Exports, `import()` und `require()` fallen durch** (Nx fängt alle drei). npm-Verbote und Alias-Deep-Imports gehen nur über Regex auf den Dateiinhalt. Kein IDE-Feedback. **Empfehlung: Nx bleibt das Gate; ArchUnitTS kein Ersatz, höchstens Ergänzung** für Struktur-/Namensregeln, Metriken und Graph-Reports.

## Was ArchUnitTS ist (Recherche)

| Punkt | Befund | Beleg |
|---|---|---|
| API | `projectFiles().inFolder/inPath/withName(...).should[Not]().dependOnFiles()…`, `haveNoCycles()`, `beInFolder/haveName`, `adhereTo(fn)` (eigene Regel auf `FileInfo`: path, name, content, LOC) | `dist/src/files/fluentapi/files.d.ts` |
| Slices | `projectSlices().definedBy('src/(**)/')` + `containDependency` / `adhereToDiagram` (PlantUML) | README, `slices.d.ts` |
| Nx | `nxProjectSlices()` liest `.nx/workspace-data/project-graph.json` — nur Projektnamen + Kanten, **keine Tags** | `extract-nx-graph.js` |
| Metriken | LOC, Methoden/Felder, LCOM-Varianten, Distance (Abstraktheit/Instabilität), eigene Metriken, HTML-Reports | README |
| Graph-Export | DOT, Mermaid, D2, CSV, JSON, HTML (`projectGraph()`) | README |
| npm-Pakete verbieten | **nein** — Ziele in `node_modules` werden verworfen | `extract-graph.js` (`EXCLUDE_NODE_MODULES`) |
| Import-Auflösung | TS Compiler API (`resolveModuleName`) mit der übergebenen tsconfig → `paths`-Aliase korrekt (`@blueprint/booking/data` → `libs/booking/data/src/index.ts`) | `findings.spec.ts` |
| Kantenarten | nur `ImportDeclaration`; kein `export … from`, kein `import()`, kein `require`; nur `.ts/.tsx` (JS: TODO im Code) | `extract-graph.js`, `findings.spec.ts` |
| Test-Integration | `await expect(rule).toPassAsync()` (Jest/Vitest/Jasmine; Vitest braucht `globals: true`), sonst `check()` → Violations-Array | README, Spike |
| Leertest-Schutz | Regel auf 0 Dateien schlägt fehl (abschaltbar `allowEmptyTests`) | README, `depend-on-files.js` |
| Cache | Graph nur im Prozess-Speicher (Map) — jede CLI-/CI-Ausführung baut neu | `extract-graph.js` |
| Abhängigkeiten | bringt eigenes `typescript@^5.9.3` mit (Repo: 6.0.3) → zwei TS-Versionen | `npm view`, pnpm-Store |
| Wartung | MIT, ~500 Stars, 14 Forks, 1 Maintainer; 2.5.4 vom 13.9.2026, letzter Push 1.10.2026; 22 offene Issues/PRs | GitHub-API, npm |

Verifizierte Fallstricke (alle in `findings.spec.ts` als Asserts):

- **Glob mit innerem `**`** (`libs/**/ui/**`) matcht **nichts**, still (Issue #108) → im Spike nur Regex.
- **`should().dependOnFiles()`** ist kein „nur abhängig von": meldet Kanten **aller** Dateien des Projekts (548 Treffer bei 1 Quell-Lib) → Allow-Listen müssen als Deny-Regel mit Komplementmenge gebaut werden.
- **`projectSlices().definedBy('…/(**)/')`** fängt nur `[\w]+` → kebab-case-Ordner (`feat-check-booking`) fallen **still** raus.
- **README zeigt `nxProjectSlices().should().haveNoCycles()`** — existiert nicht.
- tsconfig muss im cwd liegen, sonst sind Pfade relativ zur tsconfig und `FileInfo.content` leer (Issue #109) → `tsconfig.archunit.json` im Root, Suite macht `chdir`.
- Exclude von `node_modules` per Präfix: `@types` eines **übergeordneten** `node_modules` tauchen als Knoten auf (harmlos für die Regeln).

## Umsetzung im Spike

- `blueprint.ts`: Lib-Erkennung wie `verify-boundaries.mjs` (Ordner mit `src/index.ts`), Tags aus dem Pfad (= `expectedTags`), depConstraints aus `eslint.config.mjs` 1:1 als Daten (inkl. Spec-Override).
- `architecture.spec.ts`: pro Constraint eine Regel *Quell-Libs shouldNot dependOnFiles (alle Libs ohne erlaubten Tag)*; Produktion und Specs getrennt (`withName`-Filter). `bannedExternalImports` + Alias-Deep-Imports über `adhereTo` + Regex auf `content`. Relativer Import in fremde Lib: pro Lib eine Regel „von außen nur die `paths`-Datei". Zyklen: Datei-Ebene nativ, Lib-Ebene über `extractGraph` → `projectEdges(sliceByRegex)` → `projectCycles`. Dazu Ordnerschema, Dateiarten (`*.store.ts` nur in data/ui/feature …), kebab-case, Store-Klassenname, lazy-Entry.
- Nichts davon liest `project.json` — es funktioniert genauso mit **Ordnern in einer App/Lib** (Sheriff-Stil); Nx-Libs sind für ArchUnitTS nicht nötig.

## Abbildbarkeit je Regelgruppe

| Regelgruppe | reduziert | explicit-config | Begründung |
|---|---|---|---|
| Layer-Matrix | ja | ja | generierte Deny-Regeln (Komplement), kein natives Allow-List |
| Scope-Isolation (+ `port`) | ja | ja | `port` = Pfad `<slice>/api` |
| Feat-Isolation (+ `feat-port`) | ja | ja | `sameTag` per Code pro Feat generiert (wie in Nx) |
| App nur entry/shared[/port] | ja | ja | |
| Lazy-Entry nicht statisch | teilweise | teilweise | Eigene Inhaltsregel (`import()` sammeln) — Graph kennt `import()` nicht |
| testing nicht in Produktion | ja | ja | |
| Spec-Ausnahmen | ja | ja | Specs per Dateiname getrennt, eigener Constraint-Satz |
| Generierte Clients | ja | ja | Pfad-Klassifikation; Code muss generiert sein (`dependsOn: ^generate`) |
| Zyklen | teilweise | teilweise | Datei nativ; Lib-Zyklen nur über Low-Level-API; Kanten via Re-Export/`import()` fehlen |
| npm-Verbote (HTTP, types npm-frei, msw/vitest) | teilweise | teilweise | nur Regex auf Inhalt; trifft auch Kommentare; `require()` fehlt im Spike-Regex |
| Deep-Import (Alias) | teilweise | teilweise | nicht auflösbar → fehlt im Graphen → Inhaltsregel |
| Relativ in fremde Lib | ja | ja | eine Regel pro Lib (kein Rückbezug „gleiche Lib") |
| Ungetaggte Lib / Ordnerschema | ja | ja | `beInFolder(regex)` — direkter als Nx |
| `enforceBuildableLibDependency` | nein | nein | kein Build-Begriff (durch Layer-Regel ohnehin abgedeckt) |
| Namensregeln | teilweise | teilweise | Dateiname/-art ja; Symbol ↔ Datei, Selector nur per Regex (Selector **unverifiziert**) |
| Tooling-Constraints | teilweise | teilweise | `ng-lib` ist JS → unsichtbar |
| Re-Export / `import()` / `require` | nein | nein | Graph-Lücke (Proben rot in Nx, grün in ArchUnitTS) |

## Negativproben

Je Probe eine Temp-Datei, ganze Suite, danach entfernt (`tools/archunit/negative-probes.mjs`). Spalte Nx nur bei den Lücken-Proben ausgeführt (ESLint mit echter Config).

**reduziert** (Auswahl, alle 38 im Skript-Output):

| Fall | erwartet | ArchUnitTS | Nx |
|---|---|---|---|
| ui → data (auch `import type`) | rot | rot | |
| utils → data, types → utils | rot | rot | |
| fremder Slice (data, layout→domain, shared→domain) | rot | rot | |
| Geschwister-Feat (data, Container) | rot | rot | |
| Feat → Slice-Root, feature → shared/data | grün | grün | |
| App → Slice-Interna, App → shared/testing | rot | rot | |
| App importiert lazy Entry statisch | rot | rot | |
| Produktion → testing; testing → data | rot | rot | |
| Spec → eigenes testing / msw in Spec | grün | grün | |
| Spec → fremdes testing | rot | rot | |
| msw / vitest in Produktion | rot | rot | |
| HttpClient in ui / in data | rot / grün | rot / grün | |
| types → `@angular/core` | rot | rot | |
| fremder Slice → Domain-Client; ui → Client-api | rot | rot | |
| relativ in fremde Lib; Alias-Deep-Import | rot | rot | |
| Zyklus booking/data ↔ feat-check-booking/data | rot | rot | |
| tooling conventions → openapi | rot | rot | |
| Lib außerhalb Schema, `.store.ts` in utils, `TmpProbe.ts` | rot | rot | |
| **`export * from '@blueprint/booking/data'` in ui** | rot | **grün** | rot |
| **`import('@blueprint/checkin/shell')` in booking/ui** | rot | **grün** | rot |
| **`require('msw')` in data** | rot | **grün** | rot |

**explicit-config** (Auswahl, alle 46 im Skript-Output):

| Fall | erwartet | ArchUnitTS | Nx |
|---|---|---|---|
| ui → data/api, utils → api, events/api → data, data → ui | rot | rot | |
| ui → events, data → api | grün | grün | |
| fremde Interna / Shared-Feature-Interna / fremder Entry | rot | rot | |
| fremder Slice über Port, Shared-Feature über Port | grün | grün | |
| Geschwister-Feat-Interna; fremder feat-port | rot | rot | |
| Geschwister über feat-port | grün | grün | |
| App → Port | grün | grün | |
| Spec → fremdes testing (hier erlaubt) | grün | grün | |
| shared-Spec → Domain-testing; testing → api | rot | rot | |
| HttpClient in data (nur api) / in api | rot / grün | rot / grün | |
| Domain-Port → eigener Client / fremde Domain → Client | grün / rot | grün / rot | |
| `.events.ts` in data | rot | rot | |
| Re-Export / `import()` / `require` | rot | **grün** | rot |

## Laufzeiten (macOS, `NX_DAEMON=false`)

| | reduziert | explicit-config |
|---|---|---|
| ArchUnitTS-Suite direkt (vitest, 3 Läufe) | 1,9–2,0 s (123 Tests) | 2,0 s (144 Tests) |
| `nx run archunit:arch` Cache-Miss / Hit | 2,7 s / 0,9 s | 3,1 s / 0,9 s |
| `nx run-many -t lint --skip-nx-cache` (kalt) | 22,3 s (46 Projekte) | 24,6 s (55 Projekte) |
| `nx run-many -t lint` voll gecacht | 1,0 s | 1,6 s |
| `pnpm verify:boundaries` | 35 s | 41 s |
| `negative-probes.mjs` | 83 s (38 Proben) | nicht gemessen (46 Proben) |

ArchUnitTS ist hier ~10× schneller als kaltes `nx lint` — es prüft aber nur Importe, Lint macht mehr. Skalierung **unverifiziert**: `gatherDependOnFileViolations` (`Array.includes` je Kante) und `projectEdges` (`find`) sind quadratisch in der Kantenzahl; Issue #55 berichtet 100+ s bei „100s of features".

## Einbindung in Nx

- Eigenes Projekt `tools/archunit` (Tag `type:tooling`), Target `arch` (`nx:run-commands`, `cache: true`, `dependsOn: ["^generate"]`), Inputs = alle `.ts` unter libs/apps/packages/tooling + tsconfigs + generierte Dateien.
- `implicitDependencies: ["*"]` → `nx affected` enthält `archunit` bei jeder Lib-Änderung (verifiziert: `--files=libs/booking/ui/src/index.ts` → `archunit` affected).
- Granularität: **ein** Cache-Eintrag für alles — jede Änderung in irgendeiner Lib → ganze Suite neu (2–3 s). Nx-Lint cached pro Projekt.
- `verify:boundaries` + `nx lint` bleiben mit dem Zusatzprojekt grün.

## Fehlermeldungen, IDE

- Kantenregel: `libs/booking/ui/src/tmp-probe.ts:1:1 → libs/booking/data/src/index.ts:1:1 (value, named)` + Testname (bei uns der Constraint). Klickbar, aber **Zeile immer 1:1**, kein Import-Text.
- Inhaltsregel (`adhereTo`): nur Datei + Regeltext, **nicht welcher Import** — Diagnose per Hand.
- Kein ESLint-Plugin, keine Squiggles, kein Autofix. Feedback erst beim Testlauf (Vitest-Watch/IDE-Testrunner möglich).

## Pros / Kontras gegenüber Nx + eigenem Tooling

| Pro ArchUnitTS | Kontra ArchUnitTS |
|---|---|
| Regeln als lesbare Tests, beliebige Logik (`adhereTo`) | Graph-Lücken: `export … from`, `import()`, `require`, JS |
| Keine Libs/Tags nötig — Ordner reichen | Keine Tags → Klassifikation selbst aus Pfaden bauen |
| Ordnerschema/Dateinamen direkt prüfbar (`beInFolder`, `haveName`) | Allow-List-Semantik fehlt → Komplementmengen per Code |
| Leertest-Schutz gegen Tippfehler in Pfaden | Glob-Bug (#108), Slices nur `\w+`, README teils falsch — **still** falsch statt Fehler |
| Metriken (LCOM, Distance), PlantUML-Abgleich, Graph-Export | npm-Verbote nur per Regex auf Inhalt |
| Schnell bei dieser Größe (2 s) | Kein IDE-Feedback, Meldung ohne Zeile/Import |
| | Ein Cache-Eintrag für alles; Skalierung quadratisch (unverifiziert) |
| | 1 Maintainer, eigenes TS 5.9 neben TS 6 |

**Besser geeignet** für: Regeln *innerhalb* einer Lib/App (Ordner statt Libs), Struktur- und Namensregeln als Test statt eigener ESLint-Regel, Metriken/Reports, Architektur-Diagramm-Abgleich.
**Schlechter** für: Lib-Grenzen mit Tags, npm-Verbote, alles mit dynamischen Importen (Lazy-Routes!), Entwickler-Feedback im Editor.

## Empfehlung

1. **Nx `enforce-module-boundaries` bleibt das Gate** (beide Branches) — deckt die drei Graph-Lücken ab, gibt IDE-Feedback, cached pro Projekt.
2. ArchUnitTS **nicht** parallel für dieselben Kanten — doppelte Pflege, schwächere Abdeckung.
3. Sinnvolle Ergänzung nur dort, wo Nx nichts hat: Metriken/Graph-Reports als CI-Artefakt, ggf. Regeln **innerhalb** großer Libs (z. B. `internal/`-Ordner, Unterordner-Schichten). Die vorhandenen Namensregeln (ESLint, mit IDE-Feedback) und `verify-boundaries` (Tag ↔ Pfad, liest `project.json`) **nicht** ersetzen: ArchUnitTS sieht `project.json`-Tags nicht und gibt kein Editor-Feedback.

## Abgrenzung Sheriff

| | Sheriff (`@softarc/sheriff-core` 0.19) | ArchUnitTS | Nx |
|---|---|---|---|
| Modul | Ordner, per `modules`-Config getaggt (Platzhalter), Barrel oder barrel-less | kein Modulbegriff, Pfadmuster je Regel | Projekt (Lib) + `project.json`-Tags |
| Regeln | `depRules` Allow-List, Funktionen über Pfade, `sameTag` | Deny-Regeln `shouldNot dependOnFiles`, `adhereTo`, Metriken | `depConstraints` Allow-List, UND über Tags |
| Kapselung | Barrel / `internal/` (encapsulation-Rule), Deep-Import-Regel | selbst bauen (Regel pro Ordner) | Projektgrenze + `no-restricted-imports` |
| npm-Pakete | upstream nein (nur Fork `externalRules`) | nur Inhalts-Regex | `bannedExternalImports` |
| IDE | ESLint-Plugin | nein (Test) | ESLint |
| CLI/CI | `sheriff verify` (nur ab Entry erreichbare Dateien) | Testlauf (vitest/jest) | `nx lint`, `nx affected` |
| Caching | via ESLint/Nx | nur in-process; Nx-Target 1 Eintrag | pro Projekt |
| Extras | — | Metriken, PlantUML, Graph-Export | Projektgraph, affected |

Quellen Sheriff: `docs/architecture.md`, `docs/ansaetze.md`, `packages/sheriff-blueprint/src/blueprint.ts` auf `feat/sheriff-config-blueprint`. Dynamische Importe/Re-Exporte bei Sheriff: **unverifiziert**.

**Wofür was:** Nx für Lib-Grenzen mit Tags (Gate + IDE), Sheriff für dieselben Regeln über *Ordner* innerhalb von Libs/Apps inkl. Editor-Feedback, ArchUnitTS für Prüfungen, die weder Lint-Regel noch Tag sind (Metriken, Diagramm-Abgleich, Struktur-Asserts in Tests).
