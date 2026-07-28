# Schritt 6 — Tägliches Nutzungs-Tracking (Cloudflare Worker + KV + Resend)

## Ziel

Für beide Shops (Hauptshop, Member-Shop) getrennt zählen, wie oft der Produkt-Finder-Wizard
pro Tag geöffnet wird, und daraus täglich um ca. 7:00 Uhr (Europe/Berlin) einen kurzen
E-Mail-Bericht an ag@biohairspa.de verschicken.

## Zähl-Ereignis

Gezählt wird jede **Wizard-Öffnung**, nicht der vollständige Durchlauf und nicht der
Warenkorb-Klick. Als "Öffnung" gilt:

- Klick auf den schwebenden Auslöser-Button (Overlay wird geöffnet), **oder**
- initiales Rendern auf der dedizierten "Beautyfinder"-Seite (Inline-Mount).

Navigation zwischen den Wizard-Schritten selbst löst **keinen** weiteren Zähl-Event aus —
nur der einmalige Öffnen-/Mount-Moment.

Gezählt wird die **rohe Anzahl aller Öffnungen** (kein Unique-Visitor-Tracking, keine
Cookies/IDs auf Client-Seite nötig — bewusst einfach und datenschutzfreundlich).

## Architektur

```
wizard.js (Browser)  --Beacon/fetch-->  Cloudflare Worker  <-->  KV Namespace
                                              |
                                    Cron Trigger (täglich, 5:00 UTC)
                                              |
                                         Resend API  -->  ag@biohairspa.de
```

Ein Cloudflare Worker übernimmt zwei Aufgaben in einem Skript:

1. Einen `POST /ping`-Endpoint, den `wizard.js` beim Öffnen des Wizards aufruft.
2. Einen täglichen Cron-Job, der die Zahlen des Vortages ausliest und per Resend verschickt.

KV wurde bewusst gegenüber Analytics Engine (mächtiger, aber Overkill für zwei einfache
Zähler) und einer KV-Liste mit Einzel-Events (unnötige Komplexität, da nur die rohe Anzahl
zählt) als einfachster passender Baustein gewählt.

## 1. Ping vom Wizard (`wizard.js`)

- Beim ersten Rendern des Wizards (Overlay-Öffnung **oder** Inline-Mount) wird einmalig
  `navigator.sendBeacon(USAGE_PING_URL, JSON.stringify({ shop: 'hauptshop' | 'member' }))`
  aufgerufen. Fallback auf `fetch(USAGE_PING_URL, { method: 'POST', keepalive: true, body: ... })`,
  falls `sendBeacon` nicht verfügbar ist oder fehlschlägt.
- Fire-and-forget: keine Fehlerbehandlung, kein Warten auf Antwort, kein Fehler-UI für den
  Kunden — analog zur bestehenden Philosophie "still zurückfallen" bei der Live-Prüfung.
- `USAGE_PING_URL` ist eine neue Konstante/Konfigurationswert in `wizard.js` (Worker-URL,
  nach Deployment einzutragen, analog zu `publicToken` in `STORE_CONFIG`).

## 2. Worker: Ping-Endpoint

- `POST /ping` prüft den `Origin`-Header gegen eine feste Allowlist
  (`https://www.biohairbeauty.shop`, `https://member.biohairbeauty.shop`).
  Alles andere → HTTP 403, kein KV-Zugriff.
- Der Shop wird aus dem geprüften `Origin` abgeleitet, **nicht** ungeprüft aus dem
  Request-Body übernommen — verhindert, dass ein Shop die Zahlen des anderen verfälscht.
- Tagesschlüssel in **Europe/Berlin**-Zeit (nicht UTC), Format `count:<shop>:<YYYY-MM-DD>`.
- Read-modify-write auf den KV-Wert (Zähler als Zahl), bei jedem Schreiben
  `expirationTtl` neu auf 30 Tage gesetzt.
- **Bekannter Kompromiss:** KV-Writes sind nicht atomar. Bei zwei nahezu gleichzeitigen
  Requests kann ein Inkrement verloren gehen. Für "grobe Nutzungszahlen" ohne
  Massenansturm ist das tolerierbar. Falls Traffic/Genauigkeitsanspruch später steigen,
  wäre eine Durable-Object-basierte Zählung der nächste Ausbauschritt (aktuell nicht
  Teil dieses Schritts).

## 3. Worker: täglicher Cron-Report

- Cron Trigger fest auf `5:00 UTC` (≈ 7:00 Uhr Berlin im Sommer/CEST, ≈ 6:00 Uhr im
  Winter/CET — Cloudflare Cron kennt nur UTC, keine DST-Umrechnung; die ±1h-Verschiebung
  über die Zeitumstellung wird als akzeptierter Kompromiss übernommen statt zusätzlicher
  DST-Logik).
- Berechnet das gestrige Datum in Europe/Berlin-Zeit, liest
  `count:hauptshop:<gestern>` und `count:member:<gestern>` aus KV (fehlender Key → 0).
- Verschickt eine einfache Text-E-Mail über die Resend-API an `ag@biohairspa.de`:

  ```
  Betreff: Wizard-Nutzung <Datum>
  Hauptshop: <N> Öffnungen
  Member-Shop: <N> Öffnungen
  ```

- Kein Trend/Vergleich in dieser Version — nur die reinen Vortages-Zahlen pro Shop.

## 4. Aufbewahrung

Tages-Zähler bleiben 30 Tage in KV (via `expirationTtl`), danach laufen sie automatisch
ab. Reicht für kurzfristige Vergleiche, hält den KV-Namespace klein.

## 5. Repo-Struktur

Neuer Ordner `usage-tracking-worker/` mit `wrangler.toml` und `src/worker.js`, getrennt
vom bestehenden `wizard.js`/`wizard.css` — kein Build-Schritt-Zwang für den Haupt-Wizard,
der Worker ist ein unabhängig deploybares Stück Code.

```
usage-tracking-worker/
├── wrangler.toml       Worker-Konfiguration (KV-Binding, Cron Trigger, Routes)
└── src/worker.js        Ping-Handler + Cron-Handler
```

## 6. Manuelle Schritte (analog zu "Manuelle Schritte in Ecwid" im README)

Diese Schritte macht der Auftraggeber selbst, kein Code:

1. Cloudflare-Account prüfen/anlegen, Zugriff auf Workers + KV sicherstellen.
2. `wrangler` lokal einrichten (`wrangler login`).
3. KV-Namespace erstellen, Binding-Name in `wrangler.toml` eintragen.
4. Worker deployen (`wrangler deploy`), Cron Trigger ist über `wrangler.toml` aktiv.
5. Resend-Account prüfen/anlegen, Absender-Domain verifizieren (SPF/DKIM-Einträge beim
   DNS-Provider der Domain setzen).
6. Resend-API-Key erzeugen, als Worker-Secret hinterlegen:
   `wrangler secret put RESEND_API_KEY`.
7. Nach Deployment: Worker-URL in `wizard.js` als `USAGE_PING_URL` eintragen.

## Nicht Teil dieses Schritts (bewusst ausgeklammert)

- Unique-Visitor-Zählung.
- Trend-/Vergleichsdaten in der E-Mail.
- Zählung von Durchläufen oder Warenkorb-Klicks (nur Öffnungen).
- Shared-Secret zusätzlich zum Origin-Check (Origin-Check als ausreichend bewertet, da
  es nur um grobe Nutzungszahlen geht, kein Missbrauchsrisiko mit echtem Schaden).
