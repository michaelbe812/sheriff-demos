# Architektur-Ansätze im Vergleich

Wir haben mehrere Wege durchgespielt, mit Sheriff Kopplung zu begrenzen. Dieses Dokument fasst alle zusammen: was jeder Ansatz macht, auf welchem Branch er liegt, ob er **heute lauffähig** ist und was er kostet.

Alle Status­angaben stammen aus tatsächlich ausgeführtem `sheriff verify` bzw. `vitest` (Stand 21. Juli 2026) — nicht aus dem Code gelesen.

---

## Läuft es? — die kurze Antwort

| Branch | Worktree · Commit | Status | Fork nötig? |
|---|---|---|---|
| `feat/inverted-domain-ports` | sheriff-inverted · `f2fc32f` | ✅ 35/35, verify grün | nein |
| `feat/hexagonal-framework-core` | sheriff-fwcore · `19c7f56` | ✅ verify grün | nein |
| `feat/sheriff-config-blueprint` | sheriff-blue-print · `9af33b9` | ✅ verify grün | nein |
| `feat/deny-rules-config` | sheriff-hexagonal · `5d7941d` | ❌ läuft nicht | ja (nicht installiert) |
| `feat/nx-blueprint` | nx-blueprint | ✅ 38/38 Boundary-Fälle, run-many grün | nein (ganz ohne Sheriff) |
| `feat/nx-blueprint-explicit-config` | – | ✅ 135/135 verify-Fälle, run-many grün | nein (wie 5, explizite Config statt Crystal-Plugins) |
| `feat/nx-reduced-blueprint` | – | ✅ 155/155 verify-Fälle, run-many grün | nein (wie explicit-config, reduziert: ohne api/events, ohne Ports) |

`feat/deny-rules-config` importiert in `sheriff.config.ts` aus `@lambda-solutions/sheriff-core`, die `package.json` listet aber nur `@softarc/sheriff-core`, und der Fork ist nicht installiert → `Cannot find module '@lambda-solutions/sheriff-core'`. War als Fork-Branch gedacht; in dem Zustand aber weder mit noch ohne Fork benutzbar.

---

## Die zwei Philosophien

Beide lösen dasselbe Problem, schneiden den Code aber an unterschiedlichen Achsen.

|  | Hexagonal (Ports & Adapters) | Vertical Slice (invertiert) |
|---|---|---|
| **Einheit** | Ein Hexagon pro Slice | Ein Slice mit Layer-Matrix |
| **Ordner** | `domain` · `ports/{in,out}` · `adapters/{driving,driven}` | `types` · `utils` · `events` · `api` · `infra` · `data` · `ui` · `feat-<x>` |
| **Öffentliche Fläche** | `ports/in` (Tag `port`) | `api/` (Tag `port`), pro Feat `feat-port` |
| **Inversion** | Kern nennt `ports/out`, nie den Adapter | `api/` = Contract, `infra/` = Impl, getrennt |
| **Verdrahtung** | `ports/*.providers.ts` | Slice-Root `<slice>.providers.ts` |
| **Schichten** | 3 (fwcore) bzw. 4 (strikt) | Flache Matrix + optionale Feats |
| **Fork nötig?** | strikt: ja · fwcore: nein | nein |

---

## Die Ansätze im Detail

### 1. Vertical Slice, invertiert — `feat/inverted-domain-ports`

Der empfohlene Ansatz. Jeder Slice hat dieselbe Layer-Matrix; Zugriff von außen nur über einen Port. Die Inversion sitzt in der Trennung `api/` (Contract: Interfaces + `InjectionToken`, keine Impl) von `infra/` (HTTP-Clients, Mapper, SDKs).

**Layer-Matrix** (X darf Y importieren):

```
types   → (nichts)
utils   → types, utils
events  → types, utils, events
api     → types, utils, api              (Contract, NICHT infra)
infra   → types, utils, api, infra
data    → types, utils, api, data, events (Stores binden ans Token, nie infra)
ui      → types, utils, ui, events       (NICHT api, NICHT data)
feature → jedes type: AUSSER infra       (nur der Slice-Root darf infra wiren)
```

Warum die Inversion strukturell erzwungen ist: `type:api` hat **keine** Clearance zu `type:infra`. Der Contract kann seine eigene Impl nicht benennen — der Abhängigkeitspfeil zeigt von der Infrastruktur weg, nicht zu ihr. Auch `type:data` sieht `infra` nicht; Stores binden ans Token, verdrahtet wird ausschließlich am Slice-Root.

**Heute gefixt — die `type:feature`-Lücke** (`f2fc32f`): `type:feature` hängt am Slice-Root *und* an jedem `feat-<x>/`. Die alte Regel `to.startsWith('type:')` ließ pauschal alles durch, sodass ein Feat `infra/` direkt greifen konnte — am eigenen Port vorbei.

```ts
// vorher
'type:feature': ({ to }) => to.startsWith('type:'),

// jetzt
'type:feature': ({ to, fromFilePath }) =>
  to.startsWith('type:') &&
  (to !== 'type:infra' || !inAnyFeat(fromFilePath)),
```

Der erste Fix unterschied Slice-Root und Feat am `entry`-Tag — und war gegen die Fork-Engine bereits grün getestet. Beim Build kam `TS2339`: **Upstream 0.19.6 legt `fromTags` nicht in den Regel-Kontext**, nur der Fork tut das. Der Kontext ist dort exakt `{fromModulePath, toModulePath, fromFilePath, toFilePath}`. Die Tag-Variante hätte gegen den Fork sauber typgecheckt und hier still alles durchgelassen — genau die Lücke, die sie schließen soll, mit grünem Anstrich. Deshalb der Dateipfad über `inAnyFeat`.

Zwei e2e-Tests decken beide Seiten ab: Feat → `infra` blockiert, **und** Slice-Root → `infra` weiterhin erlaubt (sonst stirbt das Wiring mit). Mutationsprobe: Fix zurückgedreht → Block-Test rot, Rest grün.

**Kosten / Nutzen:** läuft auf Upstream, 35 grüne Tests inkl. echter e2e-Kette über ESLint, letzte bekannte Lücke geschlossen, kein Fork.

### 2. Hexagonal, framework-bewusster Kern — `feat/hexagonal-framework-core`

Ein Hexagon pro Slice, aber der Kern **darf Angular kennen** (DI, Signals, `InjectionToken`) — nur kein I/O. Damit fällt die vierte Schicht weg: `application/` ist in `domain/` aufgegangen (3 statt 4 Schichten), denn die existierte nur, weil der frameworklose Kern kein `inject()` haben durfte.

```
domain/ application/ ports/ adapters/   →   domain/ ports/ adapters/
```

Was bleibt und es hexagonal macht: genau eine Regel. `type:domain` darf seine eigenen Ports, `shared` und Angular, aber **keinen Adapter**. I/O bleibt hinter Ports — `new Date()` und `fetch` leben weiter in `adapters/driven`, der Kern bleibt durch Fake-Ports testbar. Fällt diese Regel auch, wäre es keine Ports-&-Adapters-Architektur mehr, sondern eine schlichte Layer-Architektur.

**Trade-off:** man tauscht die härteste Garantie (Domänenlogik ohne TestBed testbar, weil framework-frei) gegen deutlich weniger Boilerplate — eine Schicht und eine ganze Tag-Achse (`core:*`) weniger. Austauschbarkeit der Infrastruktur bleibt, absolute Reinheit des Kerns nicht.

**Kosten / Nutzen:** läuft ohne Fork; für alle, die den Hexagon wollen, aber den Fork nicht.

### 3. Hexagonal, strikt + `denyRules` — `feat/deny-rules-config` ⚠️ läuft nicht

Der klassische Hexagon mit frameworklosem Kern. Der Kern ist framework-frei: kein Angular, kein rxjs, kein `inject()`. Das erzwingt eine separate `application/`-Schicht für alles mit `inject()` und versiegelt den Kern mit einer eigenen `core:<slice>`-Scope-Achse.

Dieser Branch war der Praxis-Test für `denyRules` aus dem Fork und **importiert deshalb aus `@lambda-solutions/sheriff-core`** — läuft ohne installierten Fork nicht.

Der Nutzen von `denyRules` ist hier real, weil die strikte Config fast vollständig aus Workarounds für eine fehlende Veto-Möglichkeit besteht: `depRules` können nur erweitern, nie einschränken.

| Setup | Kern → driven Adapter |
|---|---|
| `'*'` drin, kein deny | erlaubt ← der ursprüngliche Bug |
| `'*'` + `denyRules` | blockiert |
| Kern → eigener Port | erlaubt |

Verifiziert gegen die echte Fork-Engine. Mit `denyRules` darf `'*'` zurück, die `shared`-Erlaubnis muss nicht mehr auf der Type-Achse huckepack reiten, und die künstliche `core:*`-Achse fällt weg.

### 4. Der Ausgangs-Blueprint — `feat/sheriff-config-blueprint`

Der ursprüngliche Vertical-Slice-Blueprint als teilbares Package (`@berger-engineering/sheriff-blueprint`) mit Nx-Generatoren. **Ohne `infra/`** — die Port-Inversion aus Ansatz 1 lebt nur auf jenem Branch. Dieser Branch (der aktuelle) ist die Basis, von der die anderen abzweigen. Details in [`architecture.md`](./architecture.md).

### 5. Ausgangs-Blueprint mit reinen Nx-Mitteln — `feat/nx-blueprint`

Dasselbe Regelwerk wie Ansatz 4, aber **ohne Sheriff**: eine Nx-Lib pro Slice × Layer (32 Libs), Tags `scope:` / `type:` / `feat:` plus die Marker `port`, `feat-port` und `entry`, erzwungen durch `@nx/enforce-module-boundaries`. `sameTag` gibt es in Nx nicht; es wird durch eine generierte Constraint pro Scope bzw. Feat ersetzt. Was Nx zusätzlich kann: Zyklen, `bannedExternalImports`, affected/Cache pro Layer. Der Preis sind viele Libs und viel Boilerplate. Details, Limitierungen und Testergebnisse in [`nx-umsetzung.md`](./nx-umsetzung.md).

**Variante `feat/nx-blueprint-explicit-config`:** dasselbe ohne Crystal-Plugins: jede Lib trägt `project.json`, `package.json`, `ng-package.json` und `tsconfig*.json` selbst (Generatoren schreiben und pflegen sie, `verify` prüft sie), Standard-Executoren statt Wrapper, exakte `paths` statt Wildcard. Unterschiede, Vor- und Nachteile oben in [`nx-umsetzung.md`](./nx-umsetzung.md#variante-explizite-config).

**Variante `feat/nx-reduced-blueprint`:** explicit-config mit reduziertem Regelwerk — Layer nur `types`/`utils`/`data`/`ui`/`feature`, keine Ports (`port`/`feat-port`, kein Token-Contract), Slices und Feats sind gegeneinander geschlossen; Gemeinsames (z.B. Auth) liegt in `shared`. Tooling (Generatoren, OpenAPI-Facade, `/testing`, Verify) unverändert lauffähig. Details in [`nx-reduziert.md`](./nx-reduziert.md).


---

## Wo der Fork wirklich trägt — und wo nicht

Der Fork (`@lambda-solutions/sheriff-core`) bringt zwei Features:

- **`denyRules`** — eine Regel, die *verbietet*; schlägt jeden `depRules`-Treffer. Löst den „kein `'*'`"-Workaround im strikten Hexagon auf.
- **`externalRules`** — Regeln für `node_modules`-Imports. **AND**-kombiniert über die Tags (`if (!isAllowed) return false`), invers zu `depRules`, also wirklich einschränkend. `externalRules: { 'type:domain': [] }` ersetzt den `no-restricted-imports`-ESLint-Block und entfernt damit ein zweites Pfad-Matching-Schema, das schon einmal still versagt hat (projekt-relativer Glob statt root-relativ).

**Wichtig — dem Blueprint bringt der Fork fast nichts.** Erwartet war, `denyRules` würde die `api/infra`-Trennung vereinfachen. Der Test gegen die echte Engine widerlegt das: `type:api ↛ type:infra` und `type:data ↛ type:infra` blocken die Allow-Listen längst — der Blueprint hat kein `'*'`, um das er herumarbeiten müsste. Nur die `type:feature`-Lücke war echt, und die ging ohne Fork.

Als Kommentar an der jeweils betroffenen Stelle festgehalten:

- **fwcore** `19c7f56` — wie `denyRules` den „kein `'*'`"-Workaround auflöst
- **strict** `5d7941d` — wie `externalRules` den `no-restricted-imports`-Block ersetzt
- **inverted** `1939c0f` — die Lücke; durch `f2fc32f` inzwischen erledigt

---

## Empfehlung

**Für den produktiven Blueprint: `feat/inverted-domain-ports`.** Läuft heute auf Upstream, 35 grüne Tests inkl. echter e2e-Kette, letzte bekannte Lücke geschlossen, kein Fork. Solange der Fork weder upstream gemerged noch publiziert ist, ist jede Fork-Bindung eine Abhängigkeit von einem Repo auf einer einzelnen Festplatte.

Der Hexagon ist die strengere Architektur, aber die Strenge kostet: der strikte Variant existiert nur mit Fork, der framework-bewusste gibt die härteste Garantie auf. Wer den Hexagon will, nimmt **fwcore** — der läuft ohne Fork.

### Offen

- **`feat/deny-rules-config` reparieren oder verwerfen.** Aktuell nicht lauffähig. Als Referenz für den Fork-Nutzen taugt er weiter, als Branch nicht.
- **Fork upstreamen.** Erst danach sind die drei TODOs mehr als Notizen.
- **Nicht reviewed:** die neuere Fork-Arbeit (Daemon, MCP-Server, Plugin-System, `dependency-universe.ts`).
