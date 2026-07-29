# Schritt 6 Erweiterung — Klick- und Warenkorb-Tracking

## Ziel

Zusätzlich zu den bereits gezählten Wizard-Öffnungen (`/ping`, KV-Präfix `count`)
sollen zwei weitere Ereignisse pro Shop und Tag gezählt werden:

- **Produktlink-Klicks**: Kunde klickt im Wizard auf einen Produktlink (öffnet die
  Produktseite in neuem Tab).
- **Warenkorb-Ereignisse**: Ein Produkt wurde erfolgreich in den Ecwid-Warenkorb gelegt.

Beide werden in derselben täglichen Bericht-E-Mail ergänzt, getrennt pro Shop, ohne
den bestehenden Öffnungs-Zähler oder das bestehende Mail-Format grundlegend zu ändern.

## Architektur

```
wizard.js (Browser)  --Beacon (Plain-String)-->  Worker: /ping | /click | /cart
                                                        |
                                              gemeinsamer handleCounterEvent()
                                                        |
                                                  KV: count:/clicks:/cart:<shop>:<datum>
                                                        |
                                              Cron Trigger (unverändert, 5:00 UTC)
                                                        |
                                                   Resend API  -->  ag@biohairspa.de
```

Der bestehende `/ping`-Handler wird zu einem generischen `handleCounterEvent(request,
env, metricPrefix)` verallgemeinert (Origin-Check, OPTIONS/405/403-Routing, KV-Try/Catch
— alles unverändert in der Logik, nur der KV-Key-Präfix wird parametrisiert), statt die
gleiche Sicherheits-/Fehlerbehandlungslogik drei Mal zu duplizieren.

## 1. wizard.js — zwei neue Ping-Aufrufe

Beide nutzen exakt dasselbe Fire-and-forget-Muster wie der bestehende, bereits live
verifizierte Öffnungs-Ping — **Plain-String an `sendBeacon`**, kein `Blob`, kein
`application/json`-Content-Type (das hatte beim Öffnungs-Ping nachweislich den
CORS-Preflight-Bug verursacht: Firmen-Log zeigte nur `OPTIONS`, nie den echten `POST`).

- **Produktlink-Klick** (`wizard.js:744-752`, `<a class="wizard-produkt-link">`): Die
  bestehende `el('a', { attrs: {...} }, [...])`-Definition bekommt zusätzlich
  `onClick: function () { pingProductClick(); }`. Da kein `preventDefault()` aufgerufen
  wird und der Link `target="_blank"` hat, bleibt die Standard-Navigation unangetastet —
  der Beacon feuert parallel dazu.
- **Warenkorb-Erfolg** (`wizard.js:670`, im `onDone`-Callback von `addToCart()`, Zweig
  `if (success) { ... }`): direkt nach dem bestehenden `update({ cartAdded: ... })` wird
  `pingCartEvent();` aufgerufen. Dieser Zweig deckt sowohl den normalen
  `Ecwid.Cart.addProduct`-Erfolg als auch den `Cart.get()`-Fallback ab (beide münden in
  denselben `onDone(true, ...)`-Aufruf), es ist also nur eine Stelle nötig.
- Zwei neue Konstanten analog zu `USAGE_PING_URL`: `USAGE_CLICK_URL` und
  `USAGE_CART_URL`, mit demselben TODO-Kommentarmuster, vorerst `''` (Tracking
  deaktiviert bis Worker-Deployment).
- `pingProductClick()`/`pingCartEvent()` sind dünne Wrapper um dieselbe
  Fire-and-forget-Logik wie `pingUsage()` (Payload `{ shop: config.key }`, try/catch,
  sendBeacon-dann-fetch-Fallback) — die drei Funktionen teilen sich intern eine
  gemeinsame `sendUsageBeacon(url)`-Hilfsfunktion, um die Beacon-Logik nicht dreimal zu
  duplizieren.

## 2. Worker — generischer Counter-Endpoint

`usage-tracking-worker/src/worker.js`:

- `handlePing` wird zu `handleCounterEvent(request, env, metricPrefix)` — identische
  Logik wie bisher (Origin-Check via `resolveShopFromOrigin`, OPTIONS→204/403,
  Non-POST→405, kein Origin→403, KV-Read-Modify-Write mit Try/Catch→500-mit-CORS-Header,
  Erfolg→200-mit-CORS-Header), nur dass der KV-Key jetzt über
  `kvKeyForShopDate(metricPrefix, shop, todayBerlin())` gebaut wird statt fest auf
  `'count'`.
- `fetch` routet:
  - `POST/OPTIONS /ping` → `handleCounterEvent(request, env, 'count')`
  - `POST/OPTIONS /click` → `handleCounterEvent(request, env, 'clicks')`
  - `POST/OPTIONS /cart` → `handleCounterEvent(request, env, 'cart')`
  - alles andere → 404 (unverändert)

## 3. logic.js — Signatur- und Formatänderungen

- `kvKeyForShopDate(shop, dateStr)` → `kvKeyForShopDate(prefix, shop, dateStr)`,
  Rückgabe `prefix + ':' + shop + ':' + dateStr`. Bestehende Aufrufstellen (Ping-Handler,
  Cron-Report-Lesezugriff) werden auf `kvKeyForShopDate('count', shop, dateStr)`
  angepasst — die historischen KV-Keys für Öffnungen bleiben dadurch unverändert
  (`count:<shop>:<datum>`), keine Datenmigration nötig.
- `buildReportEmail({ dateStr, counts })`: `counts` ist ab jetzt verschachtelt —
  `{ hauptshop: { opens, clicks, cart }, member: { opens, clicks, cart } }` statt der
  bisherigen flachen `{ hauptshop: number, member: number }`. Fehlende Einzelwerte
  weiterhin als `0` behandelt (pro Metrik, nicht nur pro Shop). Betreff bleibt
  unverändert (`Wizard-Nutzung <Datum>`), Textzeile pro Shop wird zu:
  ```
  Hauptshop: 42 Öffnungen, 15 Klicks, 6 Warenkorb-Ereignisse
  Member-Shop: 7 Öffnungen, 3 Klicks, 1 Warenkorb-Ereignisse
  ```
  (Kein Singular/Plural-Sonderfall für "1 Warenkorb-Ereignisse" — konsistent einfache
  Pluralform, analog zur bestehenden Behandlung von "1 Öffnungen" im Ist-Zustand.)

## 4. Cron-Report (`sendDailyReport`)

Liest pro Shop jetzt drei KV-Keys für `yesterdayBerlin()` statt einem:
`kvKeyForShopDate('count', shop, dateStr)`, `kvKeyForShopDate('clicks', shop, dateStr)`,
`kvKeyForShopDate('cart', shop, dateStr)` — baut daraus die verschachtelte
`counts`-Struktur für `buildReportEmail`. Der Resend-Versand (try/catch,
Observability-Logging) bleibt unverändert.

## 5. Tests

- `kvKeyForShopDate`: bestehender Test angepasst auf neue Signatur, plus ein Test, der
  bestätigt, dass unterschiedliche Prefixe unterschiedliche Keys für denselben
  Shop/Tag ergeben (`count:hauptshop:X` ≠ `clicks:hauptshop:X`).
- `buildReportEmail`: Tests für die neue verschachtelte Struktur — vollständige Werte,
  fehlende Einzelmetrik (z. B. `clicks` fehlt, `cart` vorhanden) als 0, komplett leeres
  `counts`-Objekt.
- Worker-Endpunkte (`/click`, `/cart`): keine automatisierten Tests (gleiche
  Begründung wie bei `/ping` — keine zusätzliche Test-Infrastruktur für
  Cloudflare-Bindings), stattdessen manuelle Verifikation via `wrangler dev` + curl,
  analog zu den bestehenden `/ping`-Verifikationsschritten, inklusive der
  Origin-Check-Edge-Cases (erlaubter Origin, `evil.example.com`, `constructor` als
  Origin-String — letzteres deckt exakt die zuvor gefundene Prototype-Lücke ab und
  muss für `/click` und `/cart` genauso `null`/403 ergeben wie für `/ping`, da alle drei
  denselben `resolveShopFromOrigin`-Aufruf nutzen).

## Nicht Teil dieser Erweiterung

- Keine neue Schritt-Nummer in der README — dies ist eine Erweiterung von Schritt 6,
  keine eigenständige Stufe.
- Keine Änderung an der bestehenden Öffnungs-Zählung (`/ping`) selbst, nur strukturelle
  Verallgemeinerung der zugrunde liegenden Funktionen.
- Kein Unique-Visitor-Tracking für Klicks/Warenkorb — rohe Anzahl, konsistent mit dem
  bestehenden Öffnungs-Zähler.
- Keine Datenmigration bestehender KV-Einträge — das Präfix `count` bleibt für Öffnungen
  unverändert, `clicks`/`cart` sind komplett neue Key-Räume.
