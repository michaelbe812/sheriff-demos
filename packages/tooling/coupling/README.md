# @blueprint/tooling-coupling

Schnitt-Analyse für **beliebige** TS/JS-Repos: misst, wo Slices (Features, Domains) miteinander gekoppelt sind, und leitet daraus Indizien für den richtigen Schnitt und die Schritte in die Zielarchitektur ab (Slices geschlossen, shared unten, App komponiert). Projekt `tooling-coupling` (`type:tooling`, `tooling:coupling`), importiert bewusst keine andere Tooling-Lib: Es soll auch auf Repos laufen, die den Blueprint-Konventionen (noch) nicht folgen. Übersicht: [`packages/tooling`](../README.md).

## Benutzen

```sh
pnpm coupling --repo ../legacy-app --out dist/coupling          # coupling-report.md + coupling-report.json
pnpm coupling --repo ../legacy-app --detective                   # + Detective als Gegenprobe (headless)
pnpm coupling --repo ../legacy-app --detective-serve             # Detective-UI mit den Slices als Scopes
pnpm coupling --repo . --range <sha> --fail-on high              # reproduzierbar, als Gate
nx run tooling-coupling:analyze                                  # dieses Repo → dist/coupling
```

Läuft direkt aus den Quellen (`node --experimental-strip-types`, Node ≥ 22.6), kein Build. Nur lesend: `git ls-files`, `git log`, Dateien. Einzige Ausnahme: `--detective` legt `.detective/config.json` an und stellt danach den vorherigen Zustand wieder her. `--detective-serve` lässt ihn stehen.

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
- **Historie:** Change Coupling braucht fachliche Commits. Umbau-Commits (wie die Blueprint-Umbauten in diesem Repo) fängt nur `maxFilesPerCommit` ab. Bei vielen kleinen Commits pro Feature ggf. `ignoreMessages` nutzen.
- **Nicht automatisiert:** fachliche Sprache (EventStorming), Duplikate (jscpd), Endpunkt-Überlappung. Das sind mögliche Erweiterungen.
- **Detective** zählt pro Ordner und ohne Commit-Filter. Seine Zahlen sind eine Gegenprobe, die Indizien basieren nur auf der eigenen Messung.

## Ergebnisse in diesem Repo

| Stand | unerwartete Kanten | Indizien |
|---|---|---|
| `feat/nx-blueprint-explicit-config` (Ports) | checkin → booking, checkin → auth | `merge-candidate` checkin + booking (Import + 3 gemeinsame Commits), `stable-dependency` checkin → auth, `move-into-slice` shared/api + shared/ui (nur checkin) |
| `feat/nx-reduced-blueprint` (Zielarchitektur) | 0 | `hidden-coupling` booking ↔ checkin (gemeinsame Umbau-Commits), `move-into-slice` shared/data-access, shared/state, shared/ui (nur checkin) |

Die Indizien auf dem Ports-Stand decken sich mit dem, was der reduzierte Blueprint von Hand umgebaut hat (checkin lädt Ankünfte selbst, auth → `shared/state`).

## Tests

`nx test tooling-coupling`: Globs, Metriken (Tarjan, Martin, Tornhill, Git-Log-Filter), Detective-Aggregation sowie End-to-End gegen temporäre Git-Repos (Legacy-App mit jedem Indiz einmal, Nx-Workspace mit Tags + Aliasen, Determinismus).
