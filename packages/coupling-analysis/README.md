# @berger-engineering/coupling-analysis

Schnitt-Analyse für **beliebige** TypeScript/JavaScript-Repos: misst, wo Slices (Features, Domains) miteinander gekoppelt sind, und leitet daraus Indizien für den richtigen Schnitt und die Schritte in die Zielarchitektur ab (Slices geschlossen, shared unten, App komponiert). Eigenständiges CLI + Library, keine Annahmen über Framework oder Workspace-Konventionen: Slices kommen aus Nx-Tags oder aus Ordnermustern.

**Was es kann:** Cross-Slice-Importe (inkl. tsconfig-Aliase), Zyklen, Ca/Ce/Instability, Change Coupling aus der git-Historie (Tornhill), Indizien mit Migrationsschritt, Schnittvorschlag, Report als Markdown (mit Mermaid-Graph) + JSON, CI-Gate, Detective als Gegenprobe.
**Was es nicht kann:** fachliche Sprache bewerten, Duplikate finden, Backend-Endpunkte vergleichen, Code umbauen. Die Indizien sind Hypothesen, die fachlich geprüft werden müssen (siehe [Grenzen](#grenzen)).

## Installation

Voraussetzung: Node ≥ 20.10, `git` im `PATH`. Abhängigkeiten (`typescript`, `@softarc/detective`) installiert npm mit, im Zielrepo muss nichts vorhanden sein.

| Weg | Befehl | Aufruf |
|---|---|---|
| einmalig, ohne Installation | – | `npx @berger-engineering/coupling-analysis --repo <pfad>` |
| global | `npm i -g @berger-engineering/coupling-analysis` | `coupling-analysis --repo <pfad>` |
| im Zielrepo (z. B. für CI) | `npm i -D @berger-engineering/coupling-analysis` | `npx coupling-analysis` (analysiert das cwd) |
| lokal bauen, ohne npm-Registry | im Quell-Repo: `cd packages/coupling-analysis && npm pack` → `npm i -g ./berger-engineering-coupling-analysis-<version>.tgz` | `coupling-analysis --repo <pfad>` |
| aus den Quellen (Entwicklung, Node ≥ 22.6) | – | `node --experimental-strip-types src/cli.ts --repo <pfad>` bzw. im Quell-Repo `pnpm coupling --repo <pfad>` |

`npm pack` baut vorher automatisch (`prepack` → `dist/`). Das Tarball enthält nur `dist/`, `README.md`, `LICENSE`.

## Benutzen

```sh
coupling-analysis --repo ../legacy-app --out reports/legacy      # coupling-report.md + coupling-report.json
coupling-analysis --repo ../legacy-app --detective               # + Detective als Gegenprobe (headless)
coupling-analysis --repo ../legacy-app --detective-serve         # Detective-UI mit den Slices als Scopes
coupling-analysis --range <sha> --fail-on high                   # im Zielrepo: reproduzierbar, als CI-Gate
coupling-analysis --help | --version
```

| Option | Bedeutung |
|---|---|
| `--repo <pfad>` | zu analysierendes Repo (Default: cwd). Muss ein git-Repo mit Historie sein |
| `--config <datei>` | Config (Default: `<repo>/coupling.config.json`, sonst Defaults). Erlaubt Config außerhalb des Zielrepos |
| `--out <dir>` | schreibt `coupling-report.json` + `coupling-report.md`; ohne: Markdown auf stdout |
| `--range <rev>` | git-Range (`HEAD`, `v3.0..HEAD`, `<sha>`), überschreibt die Config |
| `--max-commits <n>` | nur die neuesten n Commits |
| `--detective` | Detective-Matrizen als Gegenprobe in den Report |
| `--detective-serve` | Detective-UI öffnen, Scopes = Slices (kein Report) |
| `--fail-on <high\|medium\|low>` | Exit-Code 1, wenn ein Indiz mindestens diese Schwere hat |

Schritt für Schritt: [Anleitung: Fremd-Repo analysieren](#anleitung-fremd-repo-analysieren), [Report lesen](#report-lesen), [Beispielkonfigurationen](#beispielkonfigurationen).

Nur lesend: `git ls-files`, `git log`, Dateien. Einzige Ausnahme: `--detective` legt `.detective/config.json` an und stellt danach den vorherigen Zustand wieder her. `--detective-serve` lässt ihn stehen (ggf. `.detective` in die `.gitignore` des Zielrepos).

### Als Library

```ts
import { analyze, mergeConfig, toMarkdown } from '@berger-engineering/coupling-analysis';

const report = await analyze({ repo: '../legacy-app', config: mergeConfig({ slices: ['src/app/{slice}/**'] }) });
console.log(report.findings.filter((finding) => finding.severity === 'high'));
console.log(toMarkdown(report));
```

Exportiert: `analyze`, `loadConfig`, `mergeConfig`, `defaultConfig`, `toJson`, `toMarkdown`, `TOOL` und die Typen `CouplingReport`, `CouplingConfig`, `Finding`, `FindingKind`, `Severity`, `Step`. ESM only.

## Anleitung: Fremd-Repo analysieren

Voraussetzung: das Tool installiert (siehe [Installation](#installation)), das Fremd-Repo als git-Klon mit vollständiger Historie (kein `--depth`). Im Fremd-Repo muss nichts installiert sein.

1. **Erster Lauf ohne Config**
   ```sh
   coupling-analysis --repo ../legacy-app --out tmp/legacy
   ```
   Kopfzeile in `tmp/legacy/coupling-report.md` prüfen: `Slices aus` (nx/patterns), `ohne Slice`, `Commits (analysiert/gelesen)`.
2. **Schnitt konfigurieren:** `ohne Slice` listet die größten nicht zugeordneten Ordner. Liegt dort Fachcode, `coupling.config.json` im Fremd-Repo anlegen (oder per `--config` von außen übergeben, z. B. `tmp/legacy.config.json`), siehe [Beispielkonfigurationen](#beispielkonfigurationen):
   - `slices`: welche Ordner Slices sind (`{slice}` = Name). Ziel: alle fachlichen Ordner zugeordnet, Tooling/Build-Ordner bewusst nicht
   - `shared`: Slices, in die jeder importieren darf (Importe dorthin sind kein Indiz)
   - `app`: Slices, die komponieren (Importe aus ihnen heraus sind kein Indiz). Im Nx-Modus automatisch
   - `ignore`: Slices ganz weglassen (generierter Code, Spielwiesen)
3. **Rauschen der Historie prüfen:** Viel Abstand zwischen `analysiert` und `gelesen` bedeutet viele große Commits (Formatierung, Renames, Migrationen). Wiederkehrende Sweeps per `git.ignoreMessages` ausschließen (z. B. `"prettier"`, `"chore(deps)"`, `"nx migrate"`), ggf. `maxFilesPerCommit` senken. Bei sehr langer Historie: `--max-commits 1000` oder eine Range ab dem letzten großen Umbau (`--range v3.0..HEAD`), damit alter Schnitt die Werte nicht verfälscht.
4. **Festschreiben:** Range auf einen sha festlegen (`--range <sha>`), Config versionieren. Dann ist der Report reproduzierbar und Läufe vor/nach einem Umbau sind vergleichbar.
5. **Gegenprobe (optional):** `--detective`. Weichen die Import-Zahlen stark ab, Slice-Zuordnung oder tsconfig prüfen (`tsconfig`-Liste in der Config). Detective zählt Specs nicht und läuft nur über Einstiegspunkte (`index.ts`/`main.ts`).
6. **Report lesen und fachlich bewerten** (nächster Abschnitt). Die Indizien sind Hypothesen: Jedes vor dem Umbau mit Fachlichkeit und Team abgleichen.
7. **Umbauen in Report-Reihenfolge**, nach jedem Schritt neu laufen lassen. Ziel: `0 unerwartete Kanten`. Danach `--fail-on high` (oder `medium`) in die CI, damit der Schnitt hält.

## Report lesen

| Wert | Bedeutung | Faustregel |
|---|---|---|
| **unerwartete Kanten** | Importe Slice → Slice, shared → Slice, Slice → App | Ziel 0. Jede Kante ist ein Indiz |
| **Grad** (Change Coupling) | gemeinsame Commits / ⌀ Commits beider Slices | ≥ 0.3 bei ≥ 3 gemeinsamen Commits = gekoppelt (Default). ≥ 0.5 = fast immer gemeinsam geändert |
| **gemeinsam** | absolute Zahl gemeinsamer Commits | unter `minSharedCommits` nicht belastbar, auch bei Grad 1.0 (1 von 1 Commit) |
| **Ca / Ce / I** | Dateien außerhalb, die importieren / die importiert werden; Instability | Slice mit I ≈ 0 und hohem Ca trägt andere: eigentlich shared oder Domain. Feature-Slices sollten I ≈ 1 haben |
| **SoC** | Sum of Coupling: wie viele andere Slices in denselben Commits mitgeändert wurden | hoher Wert = Slice wird selten allein geändert |
| **Hauptautor-Anteil** | Anteil der Commits des häufigsten Autors | niedrig bei vielen Autoren = kein klarer Owner (Conway-Hinweis) |
| **Dateien über Slice-Grenzen** | konkrete Datei-Paare mit gemeinsamem Änderungsmuster | Beleg hinter `hidden-coupling` und `merge-candidate`: hier zuerst hinschauen |

**Typische Fehlalarme**

- **Umbau-Commits** (Migration, Architektur-Umbau) erzeugen Change Coupling zwischen allen Slices. Erkennbar an wenigen gemeinsamen Commits mit Commit-Messages wie `refactor`/`chore`. Abhilfe: `ignoreMessages` oder Range ab dem Umbau.
- **Barrels:** `shared-candidate` oder `move-into-slice` auf einer `index.ts` betrifft die ganze Public API. Welche Exporte wirklich genutzt werden, im Code prüfen.
- **`move-into-slice` in jungen Repos:** shared-Libs, die bisher nur ein Slice nutzt, sind oft bewusst vorbereitet. Kein Handlungsbedarf, solange sie fachneutral sind.
- **`stable-dependency` auf Querschnitt** (Auth, Config, Logging), der als Slice zugeordnet ist: eigentlich `shared`. Config anpassen statt umbauen.
- **Specs** sind per Default ausgeschlossen. Kopplung, die nur in Tests besteht, taucht nicht auf (gewollt).

## Beispielkonfigurationen

Angular CLI ohne Nx, Features unter `src/app`:

```json
{
  "slices": ["src/app/features/{slice}/**", "src/app/{slice}/**"],
  "shared": ["shared", "core"],
  "app": ["app"],
  "ignore": ["environments", "assets"]
}
```

Die Muster werden der Reihe nach geprüft, das erste passende gewinnt: `src/app/features/orders/x.ts` → `orders`, `src/app/core/x.ts` → `core`. Dateien direkt unter `src/app` (z. B. `app.config.ts`) haben keinen Slice und zählen unter `ohne Slice`.

Nx ohne `scope:`-Tags (Libs nach Domain gruppiert):

```json
{
  "slices": ["libs/{slice}/**", "apps/{slice}/**"],
  "shared": ["shared", "ui-kit"],
  "app": ["shop", "admin"]
}
```

Nx mit anderem Tag-Schema (`domain:orders` statt `scope:orders`):

```json
{
  "slices": "nx",
  "nxScopeTagPrefix": "domain:",
  "shared": ["shared", "platform"]
}
```

Monorepo mit mehreren Paketen und viel Historie:

```json
{
  "slices": ["packages/{slice}/src/**"],
  "shared": ["common"],
  "ignore": ["tooling", "e2e"],
  "git": { "range": "HEAD", "maxCommits": 2000, "maxFilesPerCommit": 20, "ignoreMessages": ["chore(release)", "chore(deps)", "prettier"] },
  "thresholds": { "minSharedCommits": 5 }
}
```

Muster-Syntax: `{slice}` = genau ein Ordner als Name, `*` = Teil eines Ordner-/Dateinamens, `**` = beliebig tief. Keine Klammer-Alternativen (`{a,b}`): dafür mehrere Muster angeben. `thresholds`/`git` werden feldweise mit den Defaults gemischt.

## Was gemessen wird

| Blickwinkel | Quelle | Messung |
|---|---|---|
| statisch | TypeScript-Compiler-API (`preProcessFile` + `resolveModuleName`, tsconfig `paths`/`baseUrl`) | Importe zwischen Slices, Zyklen (Tarjan), Ca/Ce/Instability (Martin), wer welche Datei nutzt |
| evolutionär | `git log --no-merges --name-only` | Change Coupling nach Tornhill (Grad = gemeinsame Commits / ⌀ Commits beider), Datei-Paare über Slice-Grenzen, Sum of Coupling, Hauptautor-Anteil |
| Gegenprobe | [Detective](https://github.com/angular-architects/detective) (`--detective`) | Import-Matrix (Sheriff) und Co-Change-Matrix (roh), auf Slices aggregiert |

## Indizien → Überführung

Jedes Indiz hat einen Schritt. Der Report sortiert danach, sodass die Reihenfolge der Migration vorgegeben ist:

| Schritt | Indiz | Regel | Maßnahme |
|---|---|---|---|
| 1 merge | `mutual-dependency` | A → B **und** B → A | zusammenlegen, sonst Zyklus brechen |
| | `merge-candidate` | A → B **und** change-gekoppelt | zusammenlegen oder Teile nach A |
| | `cycle` | Zyklus über > 2 Slices | zusammenlegen / entkoppeln |
| 2 fix-direction | `shared-depends-on-slice`, `depends-on-app` | shared → Slice, Slice → App | Richtung umkehren |
| 3 move-file | `misplaced-file` | Datei in B nur von A genutzt, A nutzt sie öfter als B (Feature Envy; nicht innerhalb eines merge-Paars) | nach A verschieben |
| | `move-into-slice` | shared-Datei/-Lib nur von einem Slice genutzt | in den Slice verschieben |
| 4 extract-shared | `shared-candidate` | Datei in B von ≥ 2 anderen Slices genutzt | nach shared / eigene Domain-Lib |
| 5 invert | `stable-dependency` | A → B, **nicht** change-gekoppelt | Typen/Utils nach shared, Contract + DI, App-Komposition |
| 6 review-cut | `hidden-coupling` | kein Import, aber change-gekoppelt | Backend-Vertrag, Events, Duplikate prüfen |

Der **Schnittvorschlag** fasst alle merge-Indizien transitiv zusammen (Union-Find): welche Slices ein Kontext sind, welche eigenständig bleiben. Erwartete Kanten (→ shared, App →) erzeugen keine Indizien.

## Konfiguration (`coupling.config.json` im analysierten Repo, alles optional)

```jsonc
{
  "slices": "auto",                       // "nx" (scope:-Tag je Projekt) | ["src/app/{slice}/**", "libs/{slice}/**"]
  "nxScopeTagPrefix": "scope:",
  "shared": ["shared", "core", "common", "util", "utils"],
  "app": [],                              // Nx: Apps (type:app / application) automatisch
  "ignore": [],                           // Slices ganz weglassen
  "exclude": ["**/*.spec.*", "**/dist/**", "..."],
  "tsconfig": ["tsconfig.base.json", "tsconfig.json"],
  "git": { "range": "HEAD", "maxCommits": null, "since": null, "maxFilesPerCommit": 30, "ignoreMessages": [] },
  "thresholds": { "minSharedCommits": 3, "changeCouplingDegree": 0.3, "minFileRevisions": 3, "fileChangeCouplingDegree": 0.5, "maxListed": 20 }
}
```

`auto` = Nx-Modus, wenn `nx.json` existiert und Projekte `scope:`-Tags tragen, sonst die Muster `libs/{slice}/**`, `src/app/{slice}/**`. Der Report listet die größten Ordner ohne Slice, damit man die Muster für ein Fremd-Repo schnell anpassen kann.

## Determinismus

Gleiches Repo + gleiche Config + gleiche Range → byte-gleicher Report: sortierte Ausgaben, keine Zeitstempel, nur getrackte Dateien. Für reproduzierbare Läufe die Range auf einen sha pinnen (`--range <sha>`), `since` mit relativem Datum vermeiden. Die Spec prüft das (zwei Läufe → gleiches JSON/Markdown).

## Grenzen

- **Barrels:** Importe über `index.ts` zählen auf den Barrel, nicht auf die eigentliche Datei. `shared-candidate` auf einem Barrel heißt: Public API eines Slices wird von mehreren genutzt, die konkreten Exporte muss man bestimmen.
- **Historie:** Change Coupling braucht fachliche Commits. Umbau-Commits (Migrationen, Architektur-Umbauten) fängt nur `maxFilesPerCommit` ab. Bei vielen kleinen Commits pro Feature ggf. `ignoreMessages` nutzen.
- **Nicht automatisiert:** fachliche Sprache (EventStorming), Duplikate (jscpd), Endpunkt-Überlappung. Das sind mögliche Erweiterungen.
- **Detective** zählt pro Ordner und ohne Commit-Filter. Seine Zahlen sind eine Gegenprobe, die Indizien basieren nur auf der eigenen Messung.
- **Sprachen:** nur TS/JS (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`). Imports in Templates (Vue SFC, Svelte) werden nicht gelesen.
- **Laufzeit-Kopplung** (DI-Tokens, Events, Router-Strings, HTTP) ist für die statische Analyse unsichtbar und taucht höchstens als `hidden-coupling` über die Historie auf.

## Validierung

Erprobt im Quell-Repo [sheriff-blue-print](https://github.com/michaelbe812/sheriff-demos) an zwei Ständen derselben Demo-App:

| Stand | unerwartete Kanten | Indizien |
|---|---|---|
| `feat/nx-blueprint-explicit-config` (Ports, Cross-Slice-Importe) | checkin → booking, checkin → auth | `merge-candidate` checkin + booking (Import + 3 gemeinsame Commits), `stable-dependency` checkin → auth, `move-into-slice` shared/api + shared/ui (nur checkin) |
| `feat/nx-reduced-blueprint` (Zielarchitektur) | 0 | `hidden-coupling` booking ↔ checkin (gemeinsame Umbau-Commits), `move-into-slice` shared/data-access, shared/state, shared/ui (nur checkin) |

Die Indizien auf dem Ports-Stand decken sich mit dem manuellen Umbau zur Zielarchitektur (checkin lädt Ankünfte selbst, auth → `shared/state`).

## Entwicklung

Quellen in `src/` (TypeScript mit `.ts`-Imports, nur löschbare Syntax: läuft direkt per `node --experimental-strip-types`). Der Build (`tsconfig.lib.json`, `rewriteRelativeImportExtensions`) schreibt ESM nach `dist/`; `scripts/fix-declarations.mjs` schreibt die `.ts`-Importe in den `.d.ts` auf `.js` um.

| Befehl (im Quell-Workspace) | Zweck |
|---|---|
| `nx test coupling-analysis` | Specs: Globs, Metriken (Tarjan, Martin, Tornhill, Git-Log-Filter), Detective-Aggregation, End-to-End gegen temporäre git-Repos (Legacy-App mit jedem Indiz, Nx-Workspace mit Tags + Aliasen, Determinismus) |
| `nx run-many -t lint typecheck build -p coupling-analysis` | Lint, Typen, `dist/` |
| `nx run coupling-analysis:analyze` | Analyse des Quell-Workspace → `dist/coupling` |

## Veröffentlichen

```sh
cd packages/coupling-analysis
npm version patch            # oder minor/major; Version steht im Report (meta.tool)
npm pack --dry-run           # Inhalt prüfen: dist/, README.md, LICENSE
npm login                    # einmalig, Account mit Zugriff auf den Scope @berger-engineering
npm publish                  # prepack baut dist/, publishConfig.access = public
```

Ohne Registry weitergeben: `npm pack` und das `.tgz` verteilen (`npm i -g ./berger-engineering-coupling-analysis-<version>.tgz`).

## Lizenz

MIT
