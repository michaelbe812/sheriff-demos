# Reduzierter Blueprint mit reinen Nx-Mitteln

Branch `feat/nx-reduced-blueprint` (abgezweigt von `feat/nx-blueprint-explicit-config` bei `f490c0f`). Gleiches Setup wie dort (eine Nx-Lib pro Slice × Layer, explizite Config pro Lib, buildable Libs, Testing/MSW, OpenAPI-Facade, Workspace-Generatoren, Verify), aber mit **reduziertem Regelwerk**:

- **weniger Typen:** `types` · `utils` · `data` · `ui` · `feature` (+ `testing`). `api` und `events` gibt es nicht mehr, beides steckt in `data`.
- **keine Ports:** keine Marker `port`/`feat-port`, kein `InjectionToken`-Contract, kein `provideX()`-Wiring zwischen Contract und Impl.
- **Slices sind geschlossen:** ein Slice importiert nie einen anderen Slice, ein Feat nie ein Geschwister-Feat. Gemeinsames liegt in `shared` bzw. in den Slice-Root-Libs. Die App komponiert Slices nur über ihre Shell (`entry`).

Alles Übrige aus [`nx-umsetzung.md`](./nx-umsetzung.md) gilt unverändert (Build, Cache-Inputs, Testing & MSW, OpenAPI-Clients, Namensschema, Tooling). Dieses Dokument beschreibt nur, was anders ist.

## Struktur

```
apps/client/src/            type:app            dünne Shell: nur entry (Slice-Shells) + shared
libs/
  <slice>/                  booking, checkin, layout
    types/ utils/ data/ ui/                scope:<slice> type:<layer> feat:none
    shell/                                 type:feature + entry   routes/providers = Slice-Root
    feat-<feat>/
      feature/ data/ ui/                   scope:<slice> type:<layer> feat:<feat>
    testing/                               type:testing (nur Specs)
  shared/types|utils|data|ui|testing       scope:shared
  generated/<client>/types|api|core|testing           scope:shared   ┐ api + core = type:data
  <domain>/generated/<client>/types|api|core|testing  scope:<domain> ┘ (HTTP gehört in data)
```

`data` = HTTP-Zugriff (`<name>-api.ts`, Wrapper um generierte Clients), Signal Stores (`.store.ts`), Domain-Events (`.events.ts`), Mapper (`internal/*.mapper.ts`).

## Regeln (`eslint.config.mjs`)

```js
// Layer-Matrix
type:types   -> types                      + bannedExternalImports ['*']
type:utils   -> types, utils
type:data    -> types, utils, data         (HTTP, Stores, Events; generierte api/core)
type:ui      -> types, utils, ui           (NICHT data: Werte per output() raus, Container macht das Event)
type:feature -> alle Produktions-Layer
type:app     -> entry, scope:shared        UND nur Produktions-Layer
type:testing -> types, testing, scope:shared
// sameTag-Ersatz, generiert aus den vorhandenen Tags
scope:shared -> scope:shared
scope:<s>    -> scope:<s>, scope:shared    (je Slice — kein port)
feat:<f>     -> feat:<f>, feat:none        (je Feat — kein feat-port)
// Nx-Extra
utils|ui|feature: bannedExternalImports ['@angular/common/http']
// Specs: + type:testing, Scope-Regeln bleiben (kein fremdes testing)
```

| | `feat/nx-blueprint-explicit-config` | dieser Branch |
|---|---|---|
| Layer | types, utils, events, api, data, ui, feature | types, utils, data, ui, feature |
| Marker | `port`, `feat-port`, `entry`, `generated` | `entry`, `generated` |
| fremder Slice | nur über `port` (`<slice>/api`) | nie |
| Geschwister-Feat | nur über `feat-port` (`feat-x/api`) | nie, geteilt wird über Slice-Root-Libs |
| App-Shell | entry, port, shared | entry, shared |
| Events | eigene Lib `events`, ui darf sie werfen | Datei-Kind `.events.ts` in `data`, ui emittiert Werte |
| HTTP (`@angular/common/http`) | nur `api` | nur `data` |
| generierte `api`/`core` | `type:api` | `type:data` |
| Specs → fremdes Domain-testing | erlaubt | blockiert |
| Inversion (auth) | `AUTH_API`-Token in `auth/api`, `AuthStore` in `auth/data`, `provideAuth()` in `auth/shell` | `AuthStore` in `shared/data`, `providedIn: 'root'`, direkt injiziert |

## Umbau der Demo

| vorher | jetzt | warum |
|---|---|---|
| `booking/api`, `booking/events` | Dateien in `booking/data` | Layer entfallen |
| `checkin/api`, `checkin/events` | Dateien in `checkin/data` | dito |
| `shared/api` | `shared/data` (per `move`-Generator) | dito |
| `auth` (api/data/shell, Token + `provideAuth()`) | `shared/data/auth.store.ts`, `shared/types/auth-user.ts` | ohne Port kann ein Slice Zustand nicht anbieten; was mehrere Slices brauchen, ist shared |
| `feat-check-booking/api` (`describeCheck`) | `booking/utils` | Geschwister teilen über den Slice-Root |
| `feat-checkin/api` (`describeDesk`) | `checkin/utils` | dito |
| `CheckinDeskStore` → `BookingApi` (booking-Port) | `CheckinApi.loadArrivals()` (`/api/arrivals`), Modell `Arrival` in `checkin/types`, MSW `arrivalHandlers`/`arrivalScenarios` in `checkin/testing` | kein Cross-Slice-Import |
| `BookingCard`/`ArrivalList` emittieren Events | emittieren `string` bzw. `Arrival`, Container erzeugt `bookingConfirmed`/`guestArrived` | ui ↛ data |
| `App` injiziert `BookingApi` | entfernt | App nur entry + shared |

## Tooling

| Teil | Änderung |
|---|---|
| `tooling-conventions` | `KNOWN_LAYERS` ohne `api`/`events`, `deriveTags` ohne `port`/`feat-port`, Client-Teile `api`/`core` → `data`, Datei-Kind `events` → `data`, `KIND_ONLY_LAYERS` = types, utils |
| `tooling-workspace` | `domain`: Default `types,data,ui,shell` (+ testing), `data` = `<d>-api.ts` + `<d>.store.ts`; `feat`: kein `--api` mehr (`--data --ui`); `layer`: Liste ohne api/events; `service`: data/feature/shell |
| `tooling-openapi` | Tags kommen aus den Konventionen (`type:data`), Hinweis „in the … data layer“ |
| `tooling-eslint-rules` | unverändert (liest die Konventionen), Specs auf neue Pfade |
| `tooling-verify` | 155 Fälle neu geschnitten (Cross-Slice/Feat jetzt durchweg blockiert), `expectedTags` ohne Ports, Affected-Proben `shared-data`/`booking-data`, nx-internals-Proben auf `booking-data`, dist-Snapshot neu (511 Dateien) |

Generatoren-Aufrufe:

```sh
nx g @blueprint/tooling-workspace:domain payment                        # libs/payment/{types,data,ui,shell,testing} + Spec, Route, Scope
nx g @blueprint/tooling-workspace:feat payment checkout --data --ui     # libs/payment/feat-checkout/{feature,data,ui} + Shell-Route
nx g @blueprint/tooling-workspace:layer payment utils
nx g @blueprint/tooling-workspace:service libs/payment/data/src/payment-cache
nx g @blueprint/tooling-openapi:client things-client --domain=payment --spec=./things.yaml   # api/core = type:data
```

## Verifikation (tatsächlich ausgeführt, `NX_DAEMON=false`)

- `nx run-many -t build lint test typecheck`: 46 Projekte + 6 `generate` grün (inkl. `tooling-openapi:test` mit Jar).
- `pnpm verify`: **155/155 Fälle**, Config-Wächter 38 Libs, Tag-Schema 40 Libs, Test-Isolation, neue Lib, Tooling-Libs, 9 Affected-Proben, 3 Clients, client-Bundle ohne msw/vitest/faker — 0 Probleme.
- `pnpm verify:nx-internals --update-snapshot`: 7/7 grün (run-many `--skip-nx-cache`, dist-Snapshot neu: 511 Dateien, Marker „App baut gegen dist“, MSW-Proben, Vitest-UI-Hasher, verify).
- `nx sync:check` grün.
- **Mutationsprobe:** Scope- und Feat-Constraints um alle Slices/Feats erweitert (= Ports durch die Hintertür) → 22 Fälle rot (`133/155`), danach zurückgesetzt.
- **Generator-E2E:** `domain payment`, `feat payment checkout --data --ui`, `layer payment utils`, `component`/`service`/`store`, `client things-client --domain=payment` (Facade, Adapter openapi-tools) + Nutzung in `payment/data` → `run-many` der payment-Projekte + `client`, `verify` (47 Libs), `sync:check` grün; `remove payment --force` → `git status` wie vorher.

## Trade-offs

**Gewinn**
- Ein Konzept weniger: keine Ports, keine Contract/Impl-Trennung, kein Wiring. Wer eine Lib sucht, findet HTTP, Store und Events an einer Stelle (`data`).
- 9 Libs weniger in der Demo (23 statt 32 Blueprint-Libs ohne testing/generated), keine Token-Indirektion beim Debuggen.
- Klare, leicht erklärbare Regel: „nur eigener Slice + shared“.

**Preis**
- **Wiederverwendung zwischen Slices nur über `shared`.** Was zwei Slices brauchen, wandert nach `shared` (Auth). `shared` wächst und bekommt Zustand (`shared/data`).
- **Doppelter Backend-Zugriff:** checkin holt Ankünfte selbst (`/api/arrivals`), statt den booking-Port zu nutzen. Kein gemeinsames Modell, kein gemeinsamer Cache.
- **Keine Austauschbarkeit per DI-Token:** Tests ersetzen Implementierungen über MSW (HTTP) oder `TestBed`-Provider der Klasse, nicht über einen Contract.
- **ui ohne Events:** Dumme Komponenten geben nur Werte heraus, der Container baut das Event — etwas mehr Code im Container.
- **Generierter Client-Code ist `type:data`:** `client api → domain data` blockt nur noch der Zyklus, nicht mehr die Layer-Regel (Verify-Fall dokumentiert das).

## Offen

- `shared/data` mit Zustand (Auth) begrenzen? Option: eigener Layer/Marker für shared-State, sobald mehr als ein Store dort liegt.
- Soll `layout` als eigener Slice bleiben (nur von der App genutzt) oder nach `shared/ui`?
