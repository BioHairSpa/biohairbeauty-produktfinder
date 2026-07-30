# Schritt 6 Erweiterung — Sitzungsbasierte Zählung (eindeutige Sitzungen pro Tag)

## Ziel

Zusätzlich zu den bestehenden rohen Tageszählern (`count`/`clicks`/`cart` pro Shop)
soll erkennbar sein, wie viele **unterschiedliche Browser-Sitzungen** (nicht Personen
dauerhaft) den Wizard an einem Tag genutzt haben. Eine Sitzung = ein Tab/Fenster
zwischen Öffnen und Schließen des Browsers — keine dauerhafte Wiedererkennung über
Tage hinweg, deshalb `sessionStorage`, nicht `localStorage` oder Cookies.

Der bestehende rohe Zähler bleibt unverändert bestehen (z. B. "42 Öffnungen" zählt
weiterhin jede einzelne Öffnung, auch mehrfach in derselben Sitzung). Die neue
Sitzungszahl ist eine zusätzliche, unabhängige Information pro Metrik.

## Architektur

```
wizard.js (Browser)
  getOrCreateSessionId() — 1x pro Tab-Sitzung, sessionStorage
  sendUsageBeacon(url)   — Payload jetzt { shop, sessionId }
        |
        v  Beacon (Plain-String, wie bisher)
Worker: /ping | /click | /cart
  handleCounterEvent(request, env, metricPrefix)
        |-- KV: count:/clicks:/cart:<shop>:<datum>            (unveraendert, roh)
        |-- KV: sessions:<metricPrefix>:<shop>:<datum>        (NEU, JSON-Array von IDs)
        v
Cron Trigger (unveraendert, 5:00 UTC)
  sendDailyReport() liest beide KV-Räume pro Shop/Metrik
        v
Resend API --> ag@biohairspa.de
```

## 1. wizard.js — Sitzungs-ID erzeugen und mitschicken

Neue Funktion, platziert direkt vor `sendUsageBeacon` (aktuell `wizard.js:1217`):

```js
const USAGE_SESSION_STORAGE_KEY = 'wizardUsageSessionId';

function createFallbackId() {
  // Nur fuer Browser ohne crypto.randomUUID (sehr alt / kein sicherer Kontext) —
  // muss nicht kryptografisch sicher sein, nur innerhalb eines Tages eindeutig genug.
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function getOrCreateSessionId() {
  try {
    const bestehend = sessionStorage.getItem(USAGE_SESSION_STORAGE_KEY);
    if (bestehend) return bestehend;
    const neu =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : createFallbackId();
    sessionStorage.setItem(USAGE_SESSION_STORAGE_KEY, neu);
    return neu;
  } catch (error) {
    // sessionStorage evtl. nicht verfuegbar (z. B. Safari privat) — dann pro
    // Aufruf neu generieren; Beacon funktioniert weiter, nur ohne
    // Sitzungs-Kontinuitaet innerhalb dieses Edge-Case.
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : createFallbackId();
  }
}
```

`sessionCacheKey`/`readSessionCache`/`writeSessionCache` (Zeilen 289–311) sind das
bestehende Vorbild für das Try/Catch-Muster um `sessionStorage` — dieselbe Begründung
(Safari privat wirft beim Zugriff) gilt hier identisch.

`sendUsageBeacon` (aktuell `wizard.js:1221-1239`) ändert nur die Payload-Zeile:

```js
const payload = JSON.stringify({ shop: config.key, sessionId: getOrCreateSessionId() });
```

Kein sonstiges Verhalten ändert sich — weiterhin Plain-String an `sendBeacon`, kein
`Blob`, kein `application/json`-Content-Type (Preflight-Bug, siehe Commit 1535557,
wird nicht wiederholt). `pingUsage`, `pingProductClick`, `pingCartEvent` bleiben
unverändert, da sie nur `sendUsageBeacon(url)` aufrufen.

## 2. logic.js — neue reine, testbare Funktionen

```js
export function sessionListKvKey(metricPrefix, shop, dateStr) {
  return 'sessions:' + metricPrefix + ':' + shop + ':' + dateStr;
}

export function addSessionIdIfMissing(existingListJson, sessionId) {
  let liste;
  try {
    liste = existingListJson ? JSON.parse(existingListJson) : [];
    if (!Array.isArray(liste)) liste = [];
  } catch (error) {
    liste = [];
  }
  if (liste.indexOf(sessionId) !== -1) {
    return { list: liste, changed: false };
  }
  return { list: liste.concat([sessionId]), changed: true };
}
```

`addSessionIdIfMissing` ist reine Logik ohne KV-Zugriff — direkt mit `node:test`
prüfbar (siehe Abschnitt 5).

`buildReportEmail({ dateStr, counts })`: `counts[shop]` bekommt drei zusätzliche
Felder `opensSessions`, `clicksSessions`, `cartSessions` (Default `0`, wie die
bestehenden Metrik-Felder). Ausgabeformat pro Shop, für alle drei Metriken:

```
Hauptshop: 42 Öffnungen (18 Sitzungen), 15 Klicks (9 Sitzungen), 6 Warenkorb-Ereignisse (4 Sitzungen)
Member-Shop: 7 Öffnungen (5 Sitzungen), 3 Klicks (2 Sitzungen), 1 Warenkorb-Ereignisse (1 Sitzungen)
```

Umsetzung: `METRIC_ORDER`/`METRIC_LABELS` bekommen ein paralleles Sitzungs-Feld pro
Metrik (z. B. `METRIC_SESSION_FIELDS = { opens: 'opensSessions', clicks:
'clicksSessions', cart: 'cartSessions' }`), das beim Zusammenbauen der Zeile an
`value + ' ' + METRIC_LABELS[metric] + ' (' + sessionValue + ' Sitzungen)'`
angehängt wird. Kein Singular/Plural-Sonderfall (konsistent zur bestehenden
"1 Warenkorb-Ereignisse"/"1 Sitzungen"-Handhabung).

## 3. worker.js — Body lesen, Session-Set pflegen

`handleCounterEvent` (aktuell `worker.js:11-53`) erweitert nach dem bestehenden
Zähler-Update (Zeile 40), vor dem Response:

```js
let sessionId = null;
try {
  const body = await request.text();
  const parsed = body ? JSON.parse(body) : null;
  if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId) {
    sessionId = parsed.sessionId;
  }
} catch (err) {
  // Payload-Parsing ist best-effort — ein kaputter/fehlender Body darf den
  // bereits erfolgten Zaehler-Increment oben nicht rueckgaengig machen oder
  // die Antwort auf 500 setzen.
}

if (sessionId) {
  const sessionKey = sessionListKvKey(metricPrefix, shop, todayBerlin());
  try {
    const existing = await env.USAGE_KV.get(sessionKey);
    const { list, changed } = addSessionIdIfMissing(existing, sessionId);
    if (changed) {
      await env.USAGE_KV.put(sessionKey, JSON.stringify(list), {
        expirationTtl: KV_TTL_SECONDS,
      });
    }
  } catch (err) {
    console.error('[usage-tracking] KV-Fehler bei Sitzungs-Liste (' + metricPrefix + '):', err);
    // Auch hier: kein Abbruch — der rohe Zaehler ist bereits geschrieben, das
    // ist die wichtigere Zahl. Sitzungs-Tracking ist additiv, nie blockierend.
  }
}
```

**Race-Bedingung (bewusst nicht vollständig gelöst, wie abgestimmt):** Das
Read-Modify-Write auf `sessionKey` ist nicht atomar. Zwei praktisch gleichzeitige
Requests mit *unterschiedlichen neuen* Sitzungs-IDs lesen ggf. denselben
Ausgangsstand und überschreiben sich gegenseitig (der zweite Schreibvorgang
"gewinnt" und enthält nur seine eigene neue ID, nicht die des ersten — ein
Sitzungs-Zählwert könnte dadurch leicht zu niedrig ausfallen). Dieselbe ID doppelt
zu senden ist dagegen unkritisch (idempotent, `changed=false` beim zweiten Mal,
kein Schreibvorgang). Bei diesem Traffic-Volumen (Handvoll Events pro Tag laut
bisherigem Live-Betrieb) ist ein gelegentlich leicht zu niedriger Sitzungszählwert
akzeptabel — der rohe Zähler bleibt exakt, da er unverändert per einzelnem
KV-Put/Read ohne die Session-Logik läuft.

`sendDailyReport` (aktuell `worker.js:55-95`) liest pro Shop zusätzlich drei
Session-Listen für `yesterdayBerlin()` und übergibt deren `.length`:

```js
const opensSessions = await env.USAGE_KV.get(sessionListKvKey('count', shop, dateStr));
const clicksSessions = await env.USAGE_KV.get(sessionListKvKey('clicks', shop, dateStr));
const cartSessions = await env.USAGE_KV.get(sessionListKvKey('cart', shop, dateStr));
counts[shop] = {
  opens: parseInt(opens || '0', 10),
  clicks: parseInt(clicks || '0', 10),
  cart: parseInt(cart || '0', 10),
  opensSessions: opensSessions ? JSON.parse(opensSessions).length : 0,
  clicksSessions: clicksSessions ? JSON.parse(clicksSessions).length : 0,
  cartSessions: cartSessions ? JSON.parse(cartSessions).length : 0,
};
```

Import-Zeile ergänzt `sessionListKvKey` und `addSessionIdIfMissing` aus `./logic.js`.

## 4. Nicht Teil dieser Erweiterung

- Keine Änderung an der bestehenden rohen Zählung selbst — sie bleibt exakt wie
  bisher, unabhängig davon, ob die Sitzungs-ID mitkommt oder nicht.
- Keine Sitzungs-übergreifende Wiedererkennung (kein Cookie, kein `localStorage`,
  keine IP-/Fingerprint-Logik) — bewusst nur `sessionStorage`.
- Kein Deduplizieren der rohen Zähler selbst (die zählen weiterhin jedes einzelne
  Ereignis, auch mehrfach je Sitzung) — nur die neue Sitzungs-Liste dedupliziert.
- Keine Datenmigration bestehender `count`/`clicks`/`cart`-KV-Einträge — die neuen
  `sessions:*`-Keys sind ein komplett neuer, unabhängiger Key-Raum mit derselben
  30-Tage-TTL.
- Kein Lock/Transaktions-Mechanismus für die Race-Bedingung (siehe Abschnitt 3) —
  bewusst akzeptierter Trade-off bei diesem Traffic-Volumen.

## 5. Tests (`usage-tracking-worker/test/logic.test.js`)

- `sessionListKvKey`: erwarteter Schlüssel, unterschiedliche Metrik-Präfixe ergeben
  unterschiedliche Keys für denselben Shop/Tag.
- `addSessionIdIfMissing`:
  - Neue ID zu leerer Liste (`null`-Input) → `{ list: [id], changed: true }`.
  - Dieselbe ID ein zweites Mal → Liste bleibt bei einem Eintrag, `changed: false`.
  - Zweite, unterschiedliche ID → beide IDs in der Liste, `changed: true`.
  - Kaputtes JSON als Input → wie leere Liste behandelt (kein Crash, ID wird
    trotzdem hinzugefügt).
- `buildReportEmail`: neue Testfälle mit Sitzungszahlen in allen drei Metriken
  (vollständige Werte wie im Beispiel oben), plus ein Fall mit fehlenden
  Sitzungsfeldern (Default `0`, analog zur bestehenden Behandlung fehlender
  Einzelmetriken).
- Worker-Endpunkte (`/ping`, `/click`, `/cart` mit Sitzungs-ID im Body): keine neuen
  automatisierten Tests (gleiche Begründung wie bisher — keine zusätzliche
  Test-Infrastruktur für Cloudflare-Bindings), stattdessen manuelle Verifikation via
  `wrangler dev` + curl vor dem Deployment, analog zu den bestehenden
  `/ping`-Verifikationsschritten.
