# Schritt 6 Erweiterung — Sitzungsbasierte Zählung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zusätzlich zur bestehenden rohen Tageszählung (Öffnungen/Klicks/Warenkorb pro
Shop) erfassen und im täglichen Report ausweisen, wie viele *unterschiedliche
Browser-Sitzungen* pro Metrik/Shop/Tag den Wizard genutzt haben.

**Architecture:** Der Browser erzeugt einmal pro Tab-Sitzung eine zufällige
Sitzungs-ID (`sessionStorage`, geht beim Schließen des Tabs verloren) und schickt sie
in jedem bestehenden Tracking-Beacon (`/ping`, `/click`, `/cart`) mit. Der Worker
pflegt zusätzlich zum bestehenden Zähler pro Metrik/Shop/Tag eine deduplizierte
Liste der gesehenen Sitzungs-IDs in KV (`sessions:<metrik>:<shop>:<datum>`, JSON-Array,
30 Tage TTL). Der tägliche Report liest `.length` dieser Listen und zeigt sie neben
der rohen Zahl an.

**Tech Stack:** Vanilla JS (Browser, `wizard.js`), Cloudflare Worker + KV
(`usage-tracking-worker/`), `node:test` für die Worker-Logik.

## Global Constraints

- Sitzungs-ID lebt in `sessionStorage`, nie `localStorage` oder Cookies — keine
  dauerhafte Wiedererkennung über Tage hinweg.
- Beacon-Payload bleibt ein Plain-String an `sendBeacon` (kein `Blob`, kein
  `application/json`-Content-Type) — das hatte beim ursprünglichen Öffnungs-Ping
  einen CORS-Preflight-Bug verursacht (Commit 1535557), darf nicht wiederholt werden.
- Neue KV-Keys folgen dem Schema `sessions:<metricPrefix>:<shop>:<dateStr>` mit
  denselben `metricPrefix`-Werten wie die bestehenden Zähler (`count`, `clicks`,
  `cart`).
- Gleiche TTL wie bestehende Zähler: `KV_TTL_SECONDS` (30 Tage), aus `logic.js`
  wiederverwenden, nicht neu definieren.
- Der bestehende rohe Zähler-Increment darf durch kaputtes/fehlendes
  Sitzungs-Payload oder einen KV-Fehler bei der Sitzungs-Liste **niemals**
  beeinträchtigt werden (kein 500, kein übersprungener Increment) — Sitzungs-Tracking
  ist rein additiv.
- Race Conditions beim Read-Modify-Write der Sitzungs-Liste werden bewusst **nicht**
  gelöst (kein Lock/Transaktion), nur per Code-Kommentar dokumentiert — akzeptabel bei
  diesem Traffic-Volumen.
- Report-Zeile pro Metrik: `<Zahl> <Label> (<Sitzungszahl> Sitzungen)`, für alle drei
  Metriken, kein Singular/Plural-Sonderfall (konsistent zur bestehenden Behandlung von
  z. B. "1 Warenkorb-Ereignisse").
- Keine neuen automatisierten Tests für die Worker-HTTP-Schicht (`worker.js`) —
  bestehende Projekt-Konvention, stattdessen manuelle Verifikation via `wrangler dev`
  + `curl`. Reine Logik-Funktionen (`logic.js`) werden weiterhin vollständig mit
  `node:test` abgedeckt.

---

## File Structure

- Modify: `usage-tracking-worker/src/logic.js` — zwei neue reine Funktionen
  (`sessionListKvKey`, `addSessionIdIfMissing`) plus Erweiterung von
  `buildReportEmail`.
- Modify: `usage-tracking-worker/test/logic.test.js` — neue Tests für die beiden
  neuen Funktionen, bestehende `buildReportEmail`-Tests auf das neue Textformat
  angepasst.
- Modify: `usage-tracking-worker/src/worker.js` — `handleCounterEvent` liest den
  Body und pflegt die Sitzungs-Liste, `sendDailyReport` liest die drei
  Sitzungs-Listen für den Report.
- Modify: `wizard.js` — neue Funktion `getOrCreateSessionId()` plus Erweiterung der
  Beacon-Payload in `sendUsageBeacon`.
- Modify: `README.md` — ein Satz zum neuen Sitzungs-Feld im Report-Absatz.

---

### Task 1: `logic.js` — Sitzungs-Deduplizierung (reine Funktionen)

**Files:**
- Modify: `usage-tracking-worker/src/logic.js`
- Test: `usage-tracking-worker/test/logic.test.js`

**Interfaces:**
- Produces: `sessionListKvKey(metricPrefix: string, shop: string, dateStr: string) -> string`
- Produces: `addSessionIdIfMissing(existingListJson: string|null, sessionId: string) -> { list: string[], changed: boolean }`

- [ ] **Step 1: Failing Tests für `sessionListKvKey` schreiben**

Am Ende von `usage-tracking-worker/test/logic.test.js` (nach dem letzten bestehenden
Test) einfügen:

```js
test('sessionListKvKey baut den erwarteten Schluessel', () => {
  assert.equal(
    sessionListKvKey('count', 'hauptshop', '2026-07-27'),
    'sessions:count:hauptshop:2026-07-27'
  );
});

test('sessionListKvKey baut unterschiedliche Schluessel fuer unterschiedliche Metrik-Praefixe', () => {
  assert.equal(sessionListKvKey('clicks', 'hauptshop', '2026-07-27'), 'sessions:clicks:hauptshop:2026-07-27');
  assert.equal(sessionListKvKey('cart', 'hauptshop', '2026-07-27'), 'sessions:cart:hauptshop:2026-07-27');
});
```

Import-Zeile am Dateianfang ergänzen (`sessionListKvKey` zur bestehenden
`import { ... } from '../src/logic.js';`-Liste hinzufügen).

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — `sessionListKvKey is not defined` (oder Import-Fehler, da die
Funktion in `logic.js` noch nicht existiert).

- [ ] **Step 3: `sessionListKvKey` implementieren**

In `usage-tracking-worker/src/logic.js` direkt nach der bestehenden
`kvKeyForShopDate`-Funktion (nach Zeile 41) einfügen:

```js
export function sessionListKvKey(metricPrefix, shop, dateStr) {
  return 'sessions:' + metricPrefix + ':' + shop + ':' + dateStr;
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS für die beiden neuen `sessionListKvKey`-Tests.

- [ ] **Step 5: Failing Tests für `addSessionIdIfMissing` schreiben**

An `usage-tracking-worker/test/logic.test.js` anhängen:

```js
test('addSessionIdIfMissing fuegt neue ID zu leerer Liste (null) hinzu', () => {
  const result = addSessionIdIfMissing(null, 'session-a');
  assert.deepEqual(result, { list: ['session-a'], changed: true });
});

test('addSessionIdIfMissing erkennt dieselbe ID als bereits vorhanden', () => {
  const bestehend = JSON.stringify(['session-a']);
  const result = addSessionIdIfMissing(bestehend, 'session-a');
  assert.deepEqual(result, { list: ['session-a'], changed: false });
});

test('addSessionIdIfMissing fuegt eine zweite, unterschiedliche ID hinzu', () => {
  const bestehend = JSON.stringify(['session-a']);
  const result = addSessionIdIfMissing(bestehend, 'session-b');
  assert.deepEqual(result, { list: ['session-a', 'session-b'], changed: true });
});

test('addSessionIdIfMissing behandelt kaputtes JSON wie eine leere Liste', () => {
  const result = addSessionIdIfMissing('{nicht valides json', 'session-a');
  assert.deepEqual(result, { list: ['session-a'], changed: true });
});
```

Import-Zeile um `addSessionIdIfMissing` ergänzen.

- [ ] **Step 6: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — `addSessionIdIfMissing is not defined`.

- [ ] **Step 7: `addSessionIdIfMissing` implementieren**

In `usage-tracking-worker/src/logic.js` direkt nach `sessionListKvKey` einfügen:

```js
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

- [ ] **Step 8: Alle Tests laufen lassen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — alle bisherigen Tests plus die 6 neuen aus diesem Task.

- [ ] **Step 9: Commit**

```bash
git add usage-tracking-worker/src/logic.js usage-tracking-worker/test/logic.test.js
git commit -m "feat: Sitzungs-Deduplizierung (sessionListKvKey, addSessionIdIfMissing) in logic.js"
```

---

### Task 2: `logic.js` — `buildReportEmail` um Sitzungszahlen erweitern

**Files:**
- Modify: `usage-tracking-worker/src/logic.js`
- Test: `usage-tracking-worker/test/logic.test.js`

**Interfaces:**
- Consumes: nichts Neues aus Task 1 (unabhängige Änderung an derselben Datei).
- Produces: `buildReportEmail({ dateStr, counts })` — `counts[shop]` akzeptiert jetzt
  zusätzlich die optionalen Felder `opensSessions`, `clicksSessions`, `cartSessions`
  (Default `0`, analog zu den bestehenden Metrik-Feldern). Rückgabeformat der
  Textzeile pro Shop: `<Zahl> <Label> (<Sitzungszahl> Sitzungen)` für jede der drei
  Metriken.

- [ ] **Step 1: Bestehende `buildReportEmail`-Tests auf neues Format anpassen (failing)**

Die drei bestehenden Tests in `usage-tracking-worker/test/logic.test.js`
(`'buildReportEmail formatiert Betreff und Text mit beiden Shops und allen
Metriken'`, `'buildReportEmail behandelt komplett leeres counts-Objekt als 0'`,
`'buildReportEmail behandelt fehlende Einzelmetrik als 0'`) komplett durch diese
drei ersetzen (gleicher Testname, neuer Inhalt):

```js
test('buildReportEmail formatiert Betreff und Text mit beiden Shops, allen Metriken und Sitzungszahlen', () => {
  const { subject, text } = buildReportEmail({
    dateStr: '2026-07-27',
    counts: {
      hauptshop: { opens: 42, clicks: 15, cart: 6, opensSessions: 18, clicksSessions: 9, cartSessions: 4 },
      member: { opens: 7, clicks: 3, cart: 1, opensSessions: 5, clicksSessions: 2, cartSessions: 1 },
    },
  });
  assert.equal(subject, 'Wizard-Nutzung 27.07.2026');
  assert.equal(
    text,
    'Hauptshop: 42 Öffnungen (18 Sitzungen), 15 Klicks (9 Sitzungen), 6 Warenkorb-Ereignisse (4 Sitzungen)\n' +
      'Member-Shop: 7 Öffnungen (5 Sitzungen), 3 Klicks (2 Sitzungen), 1 Warenkorb-Ereignisse (1 Sitzungen)'
  );
});

test('buildReportEmail behandelt komplett leeres counts-Objekt als 0 (inkl. Sitzungen)', () => {
  const { text } = buildReportEmail({ dateStr: '2026-07-27', counts: {} });
  assert.equal(
    text,
    'Hauptshop: 0 Öffnungen (0 Sitzungen), 0 Klicks (0 Sitzungen), 0 Warenkorb-Ereignisse (0 Sitzungen)\n' +
      'Member-Shop: 0 Öffnungen (0 Sitzungen), 0 Klicks (0 Sitzungen), 0 Warenkorb-Ereignisse (0 Sitzungen)'
  );
});

test('buildReportEmail behandelt fehlende Einzelmetrik und fehlende Sitzungsfelder als 0', () => {
  const { text } = buildReportEmail({
    dateStr: '2026-07-27',
    counts: {
      hauptshop: { opens: 10, cart: 2, opensSessions: 6 },
      member: { opens: 1 },
    },
  });
  assert.equal(
    text,
    'Hauptshop: 10 Öffnungen (6 Sitzungen), 0 Klicks (0 Sitzungen), 2 Warenkorb-Ereignisse (0 Sitzungen)\n' +
      'Member-Shop: 1 Öffnungen (0 Sitzungen), 0 Klicks (0 Sitzungen), 0 Warenkorb-Ereignisse (0 Sitzungen)'
  );
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — die drei angepassten Tests schlagen fehl, weil `buildReportEmail`
noch das alte Format ohne `(N Sitzungen)` liefert.

- [ ] **Step 3: `buildReportEmail` erweitern**

In `usage-tracking-worker/src/logic.js` den bestehenden Block ab `const
METRIC_ORDER = [...]` bis zum Ende der Datei komplett ersetzen durch:

```js
const METRIC_ORDER = ['opens', 'clicks', 'cart'];

const METRIC_LABELS = {
  opens: 'Öffnungen',
  clicks: 'Klicks',
  cart: 'Warenkorb-Ereignisse',
};

const METRIC_SESSION_FIELDS = {
  opens: 'opensSessions',
  clicks: 'clicksSessions',
  cart: 'cartSessions',
};

export function buildReportEmail(input) {
  const dateStr = input.dateStr;
  const counts = input.counts;
  const germanDate = formatGermanDate(dateStr);
  const lines = SHOP_IDS.map(function (shop) {
    const shopCounts = counts[shop] || {};
    const parts = METRIC_ORDER.map(function (metric) {
      const value = shopCounts[metric] || 0;
      const sessionValue = shopCounts[METRIC_SESSION_FIELDS[metric]] || 0;
      return value + ' ' + METRIC_LABELS[metric] + ' (' + sessionValue + ' Sitzungen)';
    });
    return SHOP_LABELS[shop] + ': ' + parts.join(', ');
  });
  return {
    subject: 'Wizard-Nutzung ' + germanDate,
    text: lines.join('\n'),
  };
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — alle Tests, inklusive der drei angepassten.

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/logic.js usage-tracking-worker/test/logic.test.js
git commit -m "feat: buildReportEmail zeigt eindeutige Sitzungszahlen pro Metrik"
```

---

### Task 3: `worker.js` — `handleCounterEvent` liest Body, pflegt Sitzungs-Liste

**Files:**
- Modify: `usage-tracking-worker/src/worker.js`

**Interfaces:**
- Consumes: `sessionListKvKey` und `addSessionIdIfMissing` aus Task 1
  (`usage-tracking-worker/src/logic.js`).
- Produces: keine neuen exportierten Funktionen — `handleCounterEvent` bleibt intern,
  Verhalten nach außen (HTTP-Status, CORS-Header) unverändert für alle bestehenden
  Fälle; neu ist nur die zusätzliche, best-effort Sitzungs-Liste in KV.

- [ ] **Step 1: Import-Zeile erweitern**

In `usage-tracking-worker/src/worker.js` Zeile 1-9 (bestehender Import-Block) auf
folgenden Inhalt bringen:

```js
import {
  resolveShopFromOrigin,
  todayBerlin,
  yesterdayBerlin,
  kvKeyForShopDate,
  sessionListKvKey,
  addSessionIdIfMissing,
  KV_TTL_SECONDS,
  buildReportEmail,
  SHOP_IDS,
} from './logic.js';
```

- [ ] **Step 2: `handleCounterEvent` um Sitzungs-Liste erweitern**

Die komplette bestehende `handleCounterEvent`-Funktion (Zeilen 11-53) durch folgende
Version ersetzen:

```js
async function handleCounterEvent(request, env, metricPrefix) {
  const origin = request.headers.get('Origin');
  const shop = resolveShopFromOrigin(origin);

  if (request.method === 'OPTIONS') {
    if (!shop) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!shop) {
    return new Response('Forbidden', { status: 403 });
  }

  const key = kvKeyForShopDate(metricPrefix, shop, todayBerlin());
  try {
    const current = parseInt((await env.USAGE_KV.get(key)) || '0', 10);
    await env.USAGE_KV.put(key, String(current + 1), { expirationTtl: KV_TTL_SECONDS });
  } catch (err) {
    console.error('[usage-tracking] KV-Fehler beim Zaehlen (' + metricPrefix + '):', err);
    return new Response('Internal error', {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': origin },
    });
  }

  let sessionId = null;
  try {
    const body = await request.text();
    const parsed = body ? JSON.parse(body) : null;
    if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId) {
      sessionId = parsed.sessionId;
    }
  } catch (err) {
    // Payload-Parsing ist best-effort - ein kaputter/fehlender Body darf den
    // bereits erfolgten Zaehler-Increment oben nicht rueckgaengig machen oder
    // die Antwort auf 500 setzen.
  }

  // Sitzungs-Liste aktualisieren: rein additiv, darf den obigen Zaehler-Erfolg
  // nicht beeintraechtigen. Race-Bedingung bewusst nicht geloest: Dieses
  // Read-Modify-Write ist nicht atomar. Zwei praktisch gleichzeitige Requests mit
  // unterschiedlichen neuen Sitzungs-IDs koennten sich gegenseitig ueberschreiben
  // (der zweite Schreibvorgang gewinnt und enthaelt nur seine eigene neue ID).
  // Dieselbe ID doppelt zu senden ist dagegen unkritisch (idempotent, kein
  // Schreibvorgang beim zweiten Mal). Bei diesem Traffic-Volumen (Handvoll
  // Events pro Tag) akzeptabel.
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
    }
  }

  return new Response('OK', {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}
```

- [ ] **Step 3: Bestehende Tests laufen lassen (Regressionscheck)**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — `worker.js` wird von `logic.test.js` nicht direkt importiert, aber
dieser Lauf stellt sicher, dass Task 1/2 durch diese Änderung nicht kaputtgegangen
sind.

- [ ] **Step 4: Manuelle Verifikation via `wrangler dev` + `curl`**

Terminal 1:

```bash
cd usage-tracking-worker
npx wrangler dev
```

Terminal 2 — erste Sitzung, erstes Event:

```bash
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" \
  -H "Content-Type: text/plain" \
  --data '{"shop":"hauptshop","sessionId":"test-session-a"}'
```

Expected: `HTTP/1.1 200 OK`.

KV-Inhalt prüfen (lokaler Simulator, daher `--local`):

```bash
npx wrangler kv key get "sessions:count:hauptshop:$(date -u +%F)" --binding=USAGE_KV --local
```

Expected: `["test-session-a"]`

Dieselbe Sitzungs-ID nochmal senden (Dedup-Check):

```bash
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" \
  -H "Content-Type: text/plain" \
  --data '{"shop":"hauptshop","sessionId":"test-session-a"}'
npx wrangler kv key get "sessions:count:hauptshop:$(date -u +%F)" --binding=USAGE_KV --local
```

Expected: weiterhin `["test-session-a"]` (keine Verdopplung).

Andere Sitzungs-ID senden:

```bash
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" \
  -H "Content-Type: text/plain" \
  --data '{"shop":"hauptshop","sessionId":"test-session-b"}'
npx wrangler kv key get "sessions:count:hauptshop:$(date -u +%F)" --binding=USAGE_KV --local
```

Expected: `["test-session-a","test-session-b"]`

Kaputtes/fehlendes Payload darf den rohen Zähler nicht stoppen:

```bash
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" \
  --data 'nicht-valides-json'
npx wrangler kv key get "count:hauptshop:$(date -u +%F)" --binding=USAGE_KV --local
```

Expected: `HTTP/1.1 200 OK`, Zähler ist um 1 gestiegen (jetzt `4`, da dies der vierte
`/ping`-Aufruf in diesem Verifikationslauf ist), keine 500.

`wrangler dev` mit Ctrl+C beenden.

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/worker.js
git commit -m "feat: handleCounterEvent pflegt Sitzungs-Liste pro Metrik/Shop/Tag"
```

---

### Task 4: `worker.js` — `sendDailyReport` liest Sitzungs-Listen; README dokumentieren

**Files:**
- Modify: `usage-tracking-worker/src/worker.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `sessionListKvKey` aus Task 1, `buildReportEmail`-Erweiterung aus Task 2
  (erwartet `opensSessions`/`clicksSessions`/`cartSessions` in `counts[shop]`).
- Produces: keine neuen exportierten Funktionen.

- [ ] **Step 1: `sendDailyReport` erweitern**

Die bestehende `sendDailyReport`-Funktion (Zeilen 55-95) — konkret den Schleifenkörper
mit den drei `await env.USAGE_KV.get(...)`-Zeilen und dem `counts[shop] = {...}`-Block
— durch folgende Version ersetzen (Rest der Funktion ab `const { subject, text } =
buildReportEmail(...)` bleibt unverändert):

```js
async function sendDailyReport(env) {
  const dateStr = yesterdayBerlin();
  const counts = {};
  for (const shop of SHOP_IDS) {
    const opens = await env.USAGE_KV.get(kvKeyForShopDate('count', shop, dateStr));
    const clicks = await env.USAGE_KV.get(kvKeyForShopDate('clicks', shop, dateStr));
    const cart = await env.USAGE_KV.get(kvKeyForShopDate('cart', shop, dateStr));
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
  }

  const { subject, text } = buildReportEmail({ dateStr, counts });

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.REPORT_FROM_EMAIL,
        to: env.REPORT_TO_EMAIL,
        subject: subject,
        text: text,
      }),
    });

    const body = await response.text();
    if (response.ok) {
      console.log('[usage-tracking] Resend-Antwort:', response.status, body);
    } else {
      console.error('[usage-tracking] Resend-Fehler:', response.status, body);
    }
  } catch (err) {
    console.error('[usage-tracking] Netzwerkfehler beim Versand des Tagesreports:', err);
  }
}
```

Kein neuer automatisierter Test für `sendDailyReport` selbst — die Formatierungslogik
ist bereits vollständig über die `buildReportEmail`-Tests aus Task 2 abgedeckt, das
KV-Lesemuster ist eine reine Wiederholung des bereits dreifach bestehenden Musters
(jetzt sechsfach), analog zur bisherigen Projekt-Konvention (kein Test-Harness für die
Worker-I/O-Schicht).

- [ ] **Step 2: Bestehende Tests laufen lassen (Regressionscheck)**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS.

- [ ] **Step 3: README um Sitzungs-Hinweis ergänzen**

In `README.md`, Abschnitt `## Manuelle Schritte: Nutzungs-Tracking einrichten (Schritt
6)`, den bestehenden Einleitungsabsatz (endet aktuell mit "... alle drei erscheinen in
derselben täglichen Bericht-E-Mail.") um folgenden Satz ergänzen:

```
Pro Metrik wird zusätzlich die Anzahl eindeutiger Browser-Sitzungen ausgewiesen (z. B.
"42 Öffnungen (18 Sitzungen)") — eine Sitzung endet mit dem Schließen des Tabs
(`sessionStorage`, keine dauerhafte Wiedererkennung über Tage hinweg).
```

- [ ] **Step 4: Commit**

```bash
git add usage-tracking-worker/src/worker.js README.md
git commit -m "feat: sendDailyReport liest Sitzungs-Listen; README dokumentiert Sitzungszahl"
```

---

### Task 5: `wizard.js` — Sitzungs-ID erzeugen und an jeden Beacon anhängen

**Files:**
- Modify: `wizard.js`

**Interfaces:**
- Produces: `getOrCreateSessionId() -> string`. Konsumiert von `sendUsageBeacon`
  intern, kein neuer Export nötig (`wizard.js` ist eine IIFE ohne Modul-Exports).

- [ ] **Step 1: `getOrCreateSessionId` implementieren**

In `wizard.js` direkt vor der bestehenden `function sendUsageBeacon(url) {`-Zeile
(aktuell Zeile 1221) folgenden Block einfügen:

```js
const USAGE_SESSION_STORAGE_KEY = 'wizardUsageSessionId';

function createFallbackId() {
  // Nur fuer Browser ohne crypto.randomUUID (sehr alt / kein sicherer Kontext) -
  // muss nicht kryptografisch sicher sein, nur innerhalb eines Tages eindeutig genug.
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function neueSessionId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : createFallbackId();
}

function getOrCreateSessionId() {
  try {
    const bestehend = sessionStorage.getItem(USAGE_SESSION_STORAGE_KEY);
    if (bestehend) return bestehend;
    const neu = neueSessionId();
    sessionStorage.setItem(USAGE_SESSION_STORAGE_KEY, neu);
    return neu;
  } catch (error) {
    // sessionStorage evtl. nicht verfuegbar (z. B. Safari privat) - dann pro
    // Aufruf neu generieren; Beacon funktioniert weiter, nur ohne
    // Sitzungs-Kontinuitaet innerhalb dieses Edge-Case.
    return neueSessionId();
  }
}
```

- [ ] **Step 2: Payload in `sendUsageBeacon` erweitern**

In `wizard.js` (aktuell Zeile 1225) diese Zeile:

```js
    const payload = JSON.stringify({ shop: config.key });
```

ersetzen durch:

```js
    const payload = JSON.stringify({ shop: config.key, sessionId: getOrCreateSessionId() });
```

- [ ] **Step 3: Syntax-Check**

Run: `node --check wizard.js`
Expected: kein Output, Exit-Code 0.

- [ ] **Step 4: Manuelle Verifikation im Browser**

```bash
cd /pfad/zum/worktree
python3 -m http.server 8899
```

Im Browser `http://localhost:8899/index.html?wizardStore=hauptshop` öffnen, Wizard
per Klick auf "Beautyfinder" öffnen. In der DevTools-Konsole:

```js
sessionStorage.getItem('wizardUsageSessionId')
```

Expected: eine UUID-artige Zeichenkette (z. B.
`"3fa85f64-5717-4562-b3fc-2c963f66afa6"`), kein `null`.

Seite neu laden (gleicher Tab), Wizard erneut öffnen, denselben Befehl erneut
ausführen — Expected: identische ID wie zuvor (Sitzung bleibt im selben Tab
bestehen). Danach einen neuen, unabhängigen Tab öffnen (nicht nur neuer Tab
desselben Fensters mit geteiltem `sessionStorage`, sondern z. B. Inkognito-Fenster)
und denselben Befehl ausführen — Expected: andere ID.

Im DevTools-Network-Tab den `/ping`-Request suchen (Filter z. B. nach
`workers.dev`) und den Request-Payload prüfen — Expected: enthält sowohl `"shop"`
als auch `"sessionId"` als Plain-Text-JSON, kein `Content-Type:
application/json`-Header (weiterhin `text/plain` von `sendBeacon`).

- [ ] **Step 5: Commit**

```bash
git add wizard.js
git commit -m "feat: Sitzungs-ID erzeugen und an alle Nutzungs-Tracking-Beacons anhaengen"
```

---

## Nach Abschluss aller Tasks

- Finaler Whole-Branch-Review (siehe subagent-driven-development-Ablauf).
- Kein Deployment des Workers und kein Push nach master ohne explizite Bestätigung —
  wie bei den vorherigen Erweiterungen dieses Projekts.
