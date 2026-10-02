# Reduzierter Blueprint mit reinen Nx-Mitteln

Branch `feat/nx-reduced-blueprint` (abgezweigt von `feat/nx-blueprint-explicit-config` bei `f490c0f`). Gleiches Setup wie dort (eine Nx-Lib pro Slice × Layer, explizite Config pro Lib, buildable Libs, Testing/MSW, OpenAPI-Facade, Workspace-Generatoren, Verify), aber mit **reduziertem Regelwerk**:

- **weniger Typen, kein Port:** `types` · `utils` · `data-access` · `state` · `ui` · `feature` (+ `testing`). `api` und `events` als Layer gibt es nicht mehr: HTTP liegt in `data-access` (einziger Layer mit `@angular/common/http`), Stores und Events in `state`.
- **keine Ports:** keine Marker `port`/`feat-port`, kein `InjectionToken`-Contract, kein `provideX()`-Wiring zwischen Contract und Impl.
- **Slices sind geschlossen:** ein Slice importiert nie einen anderen Slice, ein Feat nie ein Geschwister-Feat. Gemeinsames liegt in `shared` bzw. in den Slice-Root-Libs. Die App komponiert Slices nur über ihre Shell (`entry`).

Alles Übrige aus [`nx-umsetzung.md`](./nx-umsetzung.md) gilt unverändert (Build, Cache-Inputs, Testing & MSW, OpenAPI-Clients, Namensschema, Tooling). Dieses Dokument beschreibt nur, was anders ist.

## Struktur

```
apps/client/src/            type:app            dünne Shell: nur entry (Slice-Shells) + shared
libs/
  <slice>/                  booking, checkin, layout
    types/ utils/ data-access/ state/ ui/  scope:<slice> type:<layer> feat:none
    shell/                                 type:feature + entry   routes/providers = Slice-Root
    feat-<feat>/
      feature/ state/ ui/                  scope:<slice> type:<layer> feat:<feat>   (data-access erlaubt, Demo braucht keins)
    testing/                               type:testing (nur Specs)
  shared/types|utils|data-access|state|ui|testing     scope:shared
  generated/<client>/types|api|core|testing           scope:shared   ┐ api + core = type:data-access
  <domain>/generated/<client>/types|api|core|testing  scope:<domain> ┘ (HTTP gehört in data-access)
```

- `data-access` = HTTP-Zugriff: `<name>-api.ts` (Klasse `<Name>Api`), Wrapper um generierte Clients (`booking-notifications.ts`), `ApiHttp` (`shared/data-access/http-client.ts`). Keine Stores, keine Events.
- `state` = Signal Stores (`.store.ts`), Domain-Events (`.events.ts`), Mapper (`internal/*.mapper.ts`). Lädt über `data-access`.
- `api`/`core` sind nur noch Ordnernamen der generierten Clients, kein Layer.

## Regeln (`eslint.config.mjs`)

```js
// Layer-Matrix
type:types       -> types                                 + bannedExternalImports ['*']
type:utils       -> types, utils
type:data-access -> types, utils, data-access             (HTTP-Wrapper; generierte api/core)
type:state       -> types, utils, data-access, state      (Stores, Events, Mapper)
type:ui          -> types, utils, ui                      (NICHT state/data-access: Werte per output() raus)
type:feature     -> alle Produktions-Layer
type:app     -> entry, scope:shared        UND nur Produktions-Layer
type:testing -> types, testing, scope:shared
// sameTag-Ersatz, generiert aus den vorhandenen Tags
scope:shared -> scope:shared
scope:<s>    -> scope:<s>, scope:shared    (je Slice — kein port)
feat:<f>     -> feat:<f>, feat:none        (je Feat — kein feat-port)
// Nx-Extra: HTTP nur in data-access
utils|state|ui|feature: bannedExternalImports ['@angular/common/http']
// Specs (*.spec.ts): jeder Layer darf zusätzlich type:testing — utils, data-access, state, ui, feature/shell
//   Ausnahme types: testing baut auf types auf (Zyklus). Scope-Regeln bleiben (kein fremdes testing)
//   Produktionscode darf testing nie importieren
```

| | `feat/nx-blueprint-explicit-config` | dieser Branch |
|---|---|---|
| Layer | types, utils, events, api, state, ui, feature | types, utils, data-access, state, ui, feature |
| Marker | `port`, `feat-port`, `entry`, `generated` | `entry`, `generated` |
| fremder Slice | nur über `port` (`<slice>/api`) | nie |
| Geschwister-Feat | nur über `feat-port` (`feat-x/api`) | nie, geteilt wird über Slice-Root-Libs |
| App-Shell | entry, port, shared | entry, shared |
| Events | eigene Lib `events`, ui darf sie werfen | Datei-Kind `.events.ts` in `state`, ui emittiert Werte |
| HTTP (`@angular/common/http`) | nur `api` (Port + HTTP) | nur `data-access` (kein Port, nur HTTP) |
| Stores | `state` | `state` |
| generierte `api`/`core` | `type:api` | `type:data-access` |
| Specs → fremdes Domain-testing | erlaubt | blockiert |
| Inversion (auth) | `AUTH_API`-Token in `auth/api`, `AuthStore` in `auth/state`, `provideAuth()` in `auth/shell` | `AuthStore` in `shared/state`, `providedIn: 'root'`, direkt injiziert |

## Umbau der Demo

Gegenüber `feat/nx-blueprint-explicit-config` (Endstand, Schritt 1 = ohne Ports mit `data`, Schritt 2 = Split in `data-access` + `state`):

| vorher | jetzt | warum |
|---|---|---|
| `booking/api`, `booking/events` | HTTP in `booking/data-access`, Events + Store in `booking/state` | Layer entfallen, HTTP getrennt von Zustand |
| `checkin/api`, `checkin/events` | `checkin/data-access` (`CheckinApi`, `CheckinNotifications`), `checkin/state` (Store, Events, `internal/checkin.mapper.ts`) | dito |
| `shared/api` | `shared/data-access` (`ApiHttp`, `PetApi`) | dito |
| `auth` (api/state/shell, Token + `provideAuth()`) | `shared/state/auth.store.ts`, `shared/types/auth-user.ts` | ohne Port kann ein Slice Zustand nicht anbieten; was mehrere Slices brauchen, ist shared |
| `feat-check-booking/data`, `feat-checkin/data` | `feat-check-booking/state`, `feat-checkin/state` | Feat-Stores sind state |
| `feat-check-booking/api` (`describeCheck`) | `booking/utils` | Geschwister teilen über den Slice-Root |
| `feat-checkin/api` (`describeDesk`) | `checkin/utils` | dito |
| `CheckinDeskStore` → `BookingApi` (booking-Port) | `CheckinApi.loadArrivals()` (`/api/arrivals`), Modell `Arrival` in `checkin/types`, MSW `arrivalHandlers`/`arrivalScenarios` in `checkin/testing` | kein Cross-Slice-Import |
| `BookingCard`/`ArrivalList` emittieren Events | emittieren `string` bzw. `Arrival`, Container erzeugt `bookingConfirmed`/`guestArrived` | ui ↛ state |
| `App` injiziert `BookingApi` | entfernt | App nur entry + shared |

### Schritt 2: `data` → `data-access` + `state`

Erst die Konventionen (`KNOWN_LAYERS`, `CLIENT_PARTS`, `FILE_KINDS`), dann die Libs mit den eigenen Generatoren:

```sh
nx g @blueprint/tooling-workspace:move booking/data booking/state            # dito checkin, shared, feat-check-booking, feat-checkin
# HTTP-Dateien nach libs/<slice>/data-access/src (booking-api, booking-notifications, checkin-api, checkin-notifications,
# http-client, pet-api + Specs), dann Config + paths über den Layer-Generator:
nx g @blueprint/tooling-workspace:layer booking data-access                  # dito checkin, shared
nx sync                                                                      # lib-tags: client api/core type:data → type:data-access
```

`move` schreibt alle `@blueprint/<slice>/data`-Importe auf `…/state` um, `layer` legt nur fehlende Dateien an (`writeIfMissing`) und leitet die `peerDependencies` aus den schon verschobenen Quellen ab. Von Hand: `index.ts` der neuen Libs, Stores importieren `<Name>Api` aus `@blueprint/<slice>/data-access`, `peerDependencies` von `state` (nur noch `@angular/core`), `shared/state` ohne Specs → ohne `test`-Target/`tsconfig.spec.json` (verify meldet beides), Template-Datei `shared-api.ts` des Layer-Generators gelöscht. Danach `nx reset`: ohne Daemon hielt der Graph-Cache die alten Import-Auflösungen (`checkin-state` ohne Kante auf `checkin-data-access` → Build zog Quellen statt dist).

## Tooling

| Teil | Änderung |
|---|---|
| `tooling-conventions` | `KNOWN_LAYERS` = types, utils, data-access, state, ui, shell, feature, testing; `FEAT_LAYERS` generisch (alles außer shell/testing, also auch feat-eigenes `data-access`); `deriveTags` ohne `port`/`feat-port`; Client-Teile `api`/`core` → `data-access`; Datei-Kinds `store` → state/ui/feature, `events`/`mapper` → state; `KIND_ONLY_LAYERS` = types, utils; Fixture `testing/blueprint-tree.ts` mit `booking/data-access` + `booking/state` + `shared/data-access` |
| `tooling-workspace` | Sync-Generator `lib-tags` (`nx sync` leitet die Tags jeder Lib aus dem Pfad neu ab, `sync:check` meldet Abweichungen); `domain`: Default `types,data-access,state,ui,shell` (+ testing), `data-access` = `<d>-api.ts` über `ApiHttp`, `state` = `<d>.store.ts` + Store-Spec; `feat`: `--state --ui` (kein `--api`/`--data`); `layer`: Liste aus den Konventionen; `service`: data-access/state/feature/shell; `store`: state/ui/feature; alle Schemas mit `additionalProperties: false` (`feat payment x --data` → `'data' is not found in schema`) |
| `tooling-openapi` | Tags kommen aus den Konventionen (`type:data-access`), Hinweis „in the … data-access layer“ |
| `tooling-eslint-rules` | Logik unverändert (liest die Konventionen), Specs auf neue Pfade + Fälle `.store.ts`/`.events.ts`/`.mapper.ts` in data-access → `kindLayer` |
| `tooling-verify` | 181 Fälle (neu u.a.: state → data-access erlaubt, data-access → state blockiert, ui → data-access/state blockiert, HTTP in state blockiert, HTTP in data-access erlaubt, generierte Client-api von state erlaubt/von ui blockiert, `.store.ts` in data-access), `expectedTags`/`LAYERS`/Client-Typ-Map mit data-access/state, Affected-Proben `booking-state`/`shared-data-access`/`booking-data-access`, nx-internals-Proben auf `booking-state`, dist-Snapshot neu (532 Dateien) |

Generatoren-Aufrufe:

```sh
nx g @blueprint/tooling-workspace:domain payment                        # libs/payment/{types,data-access,state,ui,shell,testing} + Spec, Route, Scope
nx g @blueprint/tooling-workspace:feat payment checkout --state --ui    # libs/payment/feat-checkout/{feature,state,ui} + Shell-Route
nx g @blueprint/tooling-workspace:layer payment utils
nx g @blueprint/tooling-workspace:service libs/payment/data-access/src/payment-cache
nx g @blueprint/tooling-workspace:store libs/payment/state/src/payment-filter
nx g @blueprint/tooling-openapi:client things-client --domain=payment --spec=./things.yaml   # api/core = type:data-access
```

## Verifikation (tatsächlich ausgeführt, `NX_DAEMON=false`)

Stand nach `data` → `data-access` + `state`:

- `nx run-many -t build lint test typecheck`: 49 Projekte + 6 `generate` grün (inkl. `tooling-openapi:test` mit Jar), 52 Projekte im Graph.
- `pnpm verify`: **181/181 Fälle** (49 generierte Clients, 20 Tooling, 17 Namensregeln), Config-Wächter 41 Libs, Tag-Schema 43 Libs, Test-Isolation, neue Lib, Tooling-Libs, 9 Affected-Proben, 3 Clients (94 generierte Dateien), client-Bundle (14 Dateien) ohne msw/vitest/faker — 0 Probleme.
- `pnpm verify:nx-internals --update-snapshot`: 7/7 grün (run-many `--skip-nx-cache`, dist-Snapshot neu: 532 Dateien, Marker „App baut gegen dist“, MSW-Probe auf `booking-state:test`, MSW-Worker, Vitest-UI-Hasher, verify).
- `nx sync:check` grün, `nx run client:build` grün.
- **Mutationsprobe:** `type:ui` darf `type:state` → 4 Fälle rot (`177/181`: ui → state, ui → state in checkin, Spec ui → state, neue Lib ui → state), danach zurückgesetzt.
- Davor (Schritt 1, ohne data-access): Scope- und Feat-Constraints um alle Slices/Feats erweitert (= Ports durch die Hintertür) → 22 Fälle rot (`133/155`).
- **App im Browser** (`nx run client:serve`, nach dem Split auf data-access + state erneut durchgeklickt): `/bookings` (Bestätigen → Status `confirmed`), `/bookings/manage` (`describeCheck` aus `booking/utils`), `/checkin` („Agent: Michael“ aus `shared/state`, Walk-in → „Checked in today (1)“), `/checkin/history` (`describeDesk` aus `checkin/utils`) laufen ohne Konsolenfehler. „Load arrivals“ scheitert, weil die Demo kein Backend hat (Dev-Server liefert `index.html` für `/api/arrivals`). Auf dem Vorgänger-Branch war das bei `/api/bookings` genauso.
- **Generator-E2E:** `domain payment`, `feat payment checkout --state --ui`, `layer payment utils`, `component` (ui), `service` (data-access), `store` (state; in data-access abgelehnt), `feat … --data` → `'data' is not found in schema`, `client things-client --domain=payment` (Tags `type:data-access`, Facade, Adapter openapi-tools) + Wrapper `PaymentThings` mit Spec gegen `thingsClientHandlers` in `payment/data-access` → `run-many` der 14 payment-Projekte, `verify` (181/181, 55 Libs Config, 57 Libs Tag-Schema, 4 Clients), `sync:check` grün; `remove payment --force` → `git status` wie vorher.

## Trade-offs

**Gewinn**
- Ein Konzept weniger: keine Ports, keine Contract/Impl-Trennung, kein Wiring. HTTP liegt an genau einer Stelle (`data-access`), Zustand an einer anderen (`state`) — die Lint-Regel trennt sie, nicht eine Konvention.
- 6 Libs weniger in der Demo (26 statt 32 Blueprint-Libs ohne testing/generated), keine Token-Indirektion beim Debuggen.
- Klare, leicht erklärbare Regel: „nur eigener Slice + shared“.

**Preis**
- **Wiederverwendung zwischen Slices nur über `shared`.** Was zwei Slices brauchen, wandert nach `shared` (Auth). `shared` wächst und bekommt Zustand (`shared/state`).
- **Doppelter Backend-Zugriff:** checkin holt Ankünfte selbst (`/api/arrivals`), statt den booking-Port zu nutzen. Kein gemeinsames Modell, kein gemeinsamer Cache.
- **Keine Austauschbarkeit per DI-Token:** Tests ersetzen Implementierungen über MSW (HTTP) oder `TestBed`-Provider der Klasse, nicht über einen Contract.
- **ui ohne Events:** Dumme Komponenten geben nur Werte heraus, der Container baut das Event — etwas mehr Code im Container.
- **Generierter Client-Code ist `type:data-access`:** `client api → domain data-access` blockt nur der Zyklus, nicht die Layer-Regel (Verify-Fall dokumentiert das); `client api → domain state` blockt zusätzlich die Matrix.
- **Eine Lib mehr pro Slice** (`data-access` neben `state`): Store und HTTP-Wrapper liegen nicht mehr zusammen.

## Entscheidungen

- **`shared/state` darf Zustand halten** (z.B. `AuthStore`). Ohne Ports ist `shared` der einzige Ort für Zustand, den mehrere Slices brauchen. Kein eigener Marker.
- **Mapper in `state`** (`internal/checkin.mapper.ts`, DTO → Domäne beim Laden in den Store). `data-access` liefert DTOs bzw. Domänenmodelle, die Wrapper um generierte Clients mappen weiter selbst (`toBooking`, Anti-Corruption direkt am generierten Service).
- **Feat-eigenes `data-access` erlaubt** (Konvention generisch: alle Layer außer shell/testing), der `feat`-Generator bietet nur `--state --ui`, die Demo braucht keins.
- **`app` darf `shared/data-access`** (über `scope:shared` + Produktions-Layer), Slice-`data-access` nicht.
- **`layout` bleibt eigener Slice**, nur von der App über `layout/shell` komponiert.
