# Sheriff Demos

Mehrere durchgespielte Wege, mit [Sheriff](https://github.com/softarc-consulting/sheriff) Kopplung in einem Angular/Nx-Monorepo zu begrenzen. Jeder Ansatz liegt auf einem eigenen Branch, ist lauffähig und mit `sheriff verify` + ESLint verifiziert.

> **`main` ist bewusst leer.** Hier liegt nur der Ausgangspunkt: eine aus einem anderen Projekt übernommene `sheriff.config.ts` (Confora, `app/features/`-Struktur) — der Startpunkt, von dem aus die Ansätze entstanden sind, **nicht** deren Ergebnis. Die Arbeit steckt in den Branches unten.

## Wo anfangen

| | Branch | Was es ist |
|---|---|---|
| ⭐ | [`feat/inverted-domain-ports`](../../tree/feat/inverted-domain-ports) | **Empfohlen.** Vertical Slice mit invertierten Ports (`api/` = Contract, `infra/` = Impl) |
| 📖 | [`feat/sheriff-config-blueprint`](../../tree/feat/sheriff-config-blueprint/docs/ansaetze.md) | Vergleich **aller** Ansätze mit Kosten/Nutzen — die Übersicht |

Beide Branches enthalten `docs/architecture.md` mit dem vollständigen Regelwerk inkl. Mermaid-Diagrammen.

## Alle Branches

| Branch | Ansatz | Status | Fork nötig? |
|---|---|---|---|
| `feat/inverted-domain-ports` | Vertical Slice, invertierte Ports | ✅ 35/35 Tests, verify grün | nein |
| `feat/sheriff-config-blueprint` | Vertical Slice + shareable npm-Package | ✅ verify grün | nein |
| `feat/hexagonal-framework-core` | Hexagonal, framework-bewusster Kern | ✅ verify grün | nein |
| `feat/hexagonal-ports-adapters` | Hexagonal, strikt (frameworkfreier Kern) | ✅ läuft auf Upstream | nein |
| `feat/deny-rules-config` | dito + `denyRules` aus dem Fork | ❌ **läuft nicht** | ja, nicht installiert |

Die letzten beiden gehören zusammen: `hexagonal-ports-adapters` ist die strikte Variante auf Upstream, `deny-rules-config` baut darauf auf und ersetzt die Workarounds durch `denyRules` aus dem Fork. Weil der Fork nicht installiert ist, scheitert dieser Branch mit `Cannot find module '@lambda-solutions/sheriff-core'` — als Referenz für den Fork-Nutzen brauchbar, als Branch nicht auscheckbar.

## Das Grundprinzip (inverted)

**Alles ist ein Slice mit derselben Layer-Matrix; Zugriff von außen nur über einen Port.**

```
<slice>/
  <slice>.routes.ts       entry       einziger Einstieg für die App-Shell
  <slice>.providers.ts    entry       verdrahtet Port → Impl (einziger Ort)
  api/                    port        PUBLIC PORT — Contract, keine Impl
  infra/                  type:infra  Impl des Ports — slice-privat
  types/ utils/ events/ data/ ui/
  feat-<feat>/            feat:<feat> strikt privat, gleiche Buckets
    api/                  feat-port   public für Geschwister-Feats
```

Zwei Eigenschaften, die den Ansatz tragen:

**Die Inversion ist strukturell, nicht Disziplin.** `type:api` hat keine Clearance zu `type:infra` — der Contract kann seine eigene Implementierung nicht benennen. Auch `data` sieht `infra` nicht; verdrahtet wird ausschließlich am Slice-Root.

**App-intern und Nx-Lib sind identisch.** Dieselbe Slice-Definition wird auf `apps/<app>/src/app/domains/<d>` und `libs/domains/<d>/src` angewandt — gleiche Tags, gleiche Regeln. Eine Domain zu extrahieren ist ein Ordner-Move plus Alias, **keine** Regeländerung. Im Repo liegen beide Fälle parallel: `checkin` app-intern, `booking` als Lib.

## Ausprobieren

```sh
git checkout feat/inverted-domain-ports
pnpm install                 # baut das Blueprint-Package mit (prepare)
npx sheriff verify           # alle Entry Points
npx nx run-many -t lint      # ESLint ist die Autorität
npx nx test sheriff-blueprint
```

In den Quellen markieren Kommentare `// sheriff-violation-example:` verbotene Imports (z.B. in `apps/client/src/app/app.ts`). Einkommentieren ⇒ genau die dokumentierte Violation feuert.

> **Wichtig:** Die Regeln leben in `packages/sheriff-blueprint` und Sheriff lädt sie aus `dist/`. Nach einem Branch-Wechsel ohne `pnpm install` kann ein veraltetes `dist/` durchgesetzt werden — lautlos. Siehe [Issue #31](https://github.com/lambda-solutions-io/sheriff/issues/31).

## Bekannte Sheriff-Limitierungen

Vier Stellen, an denen Sheriff etwas still erlaubt, das die Config klar verbietet — reproduziert und upstream gemeldet in [lambda-solutions-io/sheriff#31](https://github.com/lambda-solutions-io/sheriff/issues/31):

1. **`fromTags` fehlt im Rule-Context** — eine Regel kann gegen den Fork grün testen und upstream still alles durchlassen
2. **Verschachteltes `internal/`** wird ignoriert (nur top-level greift), ohne Hinweis
3. **Streunende `index.ts`** kippt ein barrel-less Modul lautlos — `list`, `eslint`, `verify` bleiben grün
4. **Veraltetes `dist/`** eines Config-Packages wird still durchgesetzt

Gemeinsamer Nenner: alle vier sind **stille** Fehlschläge. Nichts ist rot, und die Architektur ist trotzdem nicht durchgesetzt.
