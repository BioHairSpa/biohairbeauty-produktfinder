# Schritt 6 Erweiterung — Klick- und Warenkorb-Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zusätzlich zu den bereits laufenden Wizard-Öffnungen zwei weitere Ereignisse
pro Shop und Tag zählen — Produktlink-Klicks und erfolgreiche Warenkorb-Ereignisse —
und beide in derselben täglichen Bericht-E-Mail ergänzen.

**Architecture:** Der bestehende `/ping`-Handler in `usage-tracking-worker/src/worker.js`
wird zu einer generischen `handleCounterEvent(request, env, metricPrefix)` verallgemeinert
und für drei Routen genutzt (`/ping` → `count`, `/click` → `clicks`, `/cart` → `cart`).
`kvKeyForShopDate` bekommt dafür einen `prefix`-Parameter. `wizard.js` bekommt zwei neue
Fire-and-forget-Beacons (Produktlink-Klick, Warenkorb-Erfolg), die sich dieselbe
Plain-String-Sendelogik wie der bereits live verifizierte Öffnungs-Ping teilen.
`buildReportEmail` und `sendDailyReport` werden auf eine verschachtelte
Drei-Metriken-Struktur pro Shop erweitert.

**Tech Stack:** Unverändert — Cloudflare Workers, Cloudflare KV, Cloudflare Cron
Triggers, Resend HTTP-API, Node.js eingebauter Test-Runner (`node:test`).

## Global Constraints

- Keine Secrets im Code oder in Commits.
- `wizard.js` darf durch keinen der drei Beacons je blockiert werden oder einen
  sichtbaren Fehler werfen — alle drei sind strikt Fire-and-forget, wie der bestehende
  Öffnungs-Ping.
- Alle drei Beacons senden den Payload als **Plain-String an `sendBeacon`** (kein
  `Blob`, kein `application/json`-Content-Type) — das hatte beim Öffnungs-Ping
  nachweislich einen CORS-Preflight-Bug verursacht (Live-Test zeigte nur `OPTIONS`, nie
  den echten `POST`), siehe Commit `1535557`.
- Gezählt wird die rohe Anzahl aller Ereignisse pro Tag/Shop — kein
  Unique-Visitor-Tracking, für alle drei Metriken (Öffnungen, Klicks, Warenkorb).
- Alle KV-Tageszähler laufen nach 30 Tagen automatisch ab (`KV_TTL_SECONDS`,
  unverändert für alle drei Metriken).
- Origin-Check (Allowlist `www.biohairbeauty.shop` / `member.biohairbeauty.shop`,
  Shop wird aus dem validierten Origin abgeleitet, nie aus dem Body) gilt identisch für
  alle drei Endpunkte (`resolveShopFromOrigin`, unverändert).
- Die tägliche E-Mail geht weiterhin ausschließlich an `ag@biohairspa.de`, enthält nur
  die Vortages-Zahlen, keinen Trend/Vergleich.
- Keine neue Schritt-Nummer in der README — dies ist eine Erweiterung von Schritt 6.

Spec: `docs/superpowers/specs/2026-07-29-usage-tracking-extension-design.md`

---

### Task 1: `kvKeyForShopDate` bekommt einen `prefix`-Parameter

**Files:**
- Modify: `usage-tracking-worker/src/logic.js`
- Modify: `usage-tracking-worker/test/logic.test.js`
- Modify: `usage-tracking-worker/src/worker.js:37,59`

**Interfaces:**
- Produces: `kvKeyForShopDate(prefix: string, shop: string, dateStr: string): string`
  (Rückgabe `prefix + ':' + shop + ':' + dateStr`) — ab hier von Task 2 (Worker-Routing)
  und Task 4 (Cron-Report) mit den Prefixen `'count'`, `'clicks'`, `'cart'` genutzt.

- [ ] **Step 1: Bestehenden Test auf neue Signatur anpassen (RED)**

In `usage-tracking-worker/test/logic.test.js`, aktueller Test:

```js
test('kvKeyForShopDate baut den erwarteten Schluessel', () => {
  assert.equal(kvKeyForShopDate('hauptshop', '2026-07-27'), 'count:hauptshop:2026-07-27');
});
```

Ersetzen durch:

```js
test('kvKeyForShopDate baut den erwarteten Schluessel', () => {
  assert.equal(kvKeyForShopDate('count', 'hauptshop', '2026-07-27'), 'count:hauptshop:2026-07-27');
});

test('kvKeyForShopDate baut unterschiedliche Schluessel fuer unterschiedliche Prefixe', () => {
  assert.equal(kvKeyForShopDate('clicks', 'hauptshop', '2026-07-27'), 'clicks:hauptshop:2026-07-27');
  assert.equal(kvKeyForShopDate('cart', 'hauptshop', '2026-07-27'), 'cart:hauptshop:2026-07-27');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — der erste Assert schlägt fehl, weil `kvKeyForShopDate('count', 'hauptshop', '2026-07-27')`
mit der alten 2-Parameter-Implementierung `'count:count:hauptshop'`
(dritter Parameter wird ignoriert, `dateStr` bleibt `undefined`) statt
`'count:hauptshop:2026-07-27'` ergibt.

- [ ] **Step 3: `kvKeyForShopDate` in `usage-tracking-worker/src/logic.js` anpassen**

Aktueller Code:

```js
export function kvKeyForShopDate(shop, dateStr) {
  return 'count:' + shop + ':' + dateStr;
}
```

Ändern zu:

```js
export function kvKeyForShopDate(prefix, shop, dateStr) {
  return prefix + ':' + shop + ':' + dateStr;
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — 17 von 17 Tests grün (16 bisherige minus 1 geänderter plus 2 neue).

- [ ] **Step 5: Aufrufstellen in `usage-tracking-worker/src/worker.js` anpassen**

Aktueller Code (Zeile 37, in `handlePing`):

```js
  const key = kvKeyForShopDate(shop, todayBerlin());
```

Ändern zu:

```js
  const key = kvKeyForShopDate('count', shop, todayBerlin());
```

Aktueller Code (Zeile 59, in `sendDailyReport`):

```js
    const value = await env.USAGE_KV.get(kvKeyForShopDate(shop, dateStr));
```

Ändern zu:

```js
    const value = await env.USAGE_KV.get(kvKeyForShopDate('count', shop, dateStr));
```

- [ ] **Step 6: Regressionstest für `/ping` — lokal starten und prüfen**

Run: `cd usage-tracking-worker && npx wrangler dev`
Expected: `Ready on http://localhost:8787`.

In einem zweiten Terminal:
```bash
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expected: `HTTP/1.1 200 OK`.

```bash
npx wrangler kv key list --binding=USAGE_KV --local
```
Expected: ein Eintrag `count:hauptshop:<heutiges-Berlin-Datum>` (unverändertes Format,
da Prefix weiterhin `'count'` ist). `wrangler dev`-Terminal mit Strg+C beenden.

- [ ] **Step 7: Commit**

```bash
git add usage-tracking-worker/src/logic.js usage-tracking-worker/test/logic.test.js usage-tracking-worker/src/worker.js
git commit -m "feat: kvKeyForShopDate bekommt Prefix-Parameter fuer mehrere Metriken"
```

---

### Task 2: Worker-Routing für `/click` und `/cart` (generischer Handler)

**Files:**
- Modify: `usage-tracking-worker/src/worker.js`

**Interfaces:**
- Consumes: `kvKeyForShopDate(prefix, shop, dateStr)` aus Task 1.
- Produces: `handleCounterEvent(request, env, metricPrefix)` — ersetzt `handlePing`,
  von `fetch` für alle drei Routen genutzt.

Kein automatisierter Test (gleiche Begründung wie beim bestehenden `/ping`-Endpoint,
siehe Spec Abschnitt 5) — manuelle Verifikation via `wrangler dev` + curl, inklusive der
Origin-Check-Edge-Cases.

- [ ] **Step 1: `handlePing` zu `handleCounterEvent` verallgemeinern**

Aktueller Code in `usage-tracking-worker/src/worker.js`:

```js
async function handlePing(request, env) {
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

  const key = kvKeyForShopDate('count', shop, todayBerlin());
  try {
    const current = parseInt((await env.USAGE_KV.get(key)) || '0', 10);
    await env.USAGE_KV.put(key, String(current + 1), { expirationTtl: KV_TTL_SECONDS });
  } catch (err) {
    console.error('[usage-tracking] KV-Fehler beim Zaehlen:', err);
    return new Response('Internal error', {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': origin },
    });
  }

  return new Response('OK', {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}
```

Ersetzen durch:

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

  return new Response('OK', {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}
```

- [ ] **Step 2: Routing in `export default { fetch }` erweitern**

Aktueller Code:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ping') {
      return new Response('Not found', { status: 404 });
    }
    return handlePing(request, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailyReport(env));
  },
};
```

Ändern zu:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ping') {
      return handleCounterEvent(request, env, 'count');
    }
    if (url.pathname === '/click') {
      return handleCounterEvent(request, env, 'clicks');
    }
    if (url.pathname === '/cart') {
      return handleCounterEvent(request, env, 'cart');
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailyReport(env));
  },
};
```

(Bewusst eine `if`-Kette statt eines `{'/ping': 'count', ...}`-Lookup-Objekts — vermeidet
jede Ähnlichkeit zur bereits einmal gefundenen Prototype-Property-Falle bei
Objekt-Lookups, siehe `resolveShopFromOrigin`-Historie, auch wenn ein
`/`-präfigierter Pfad wie `/constructor` damit gar nicht kollidieren könnte.)

- [ ] **Step 3: Lokal starten und alle drei Routen prüfen**

Run: `cd usage-tracking-worker && npx wrangler dev`
Expected: `Ready on http://localhost:8787`.

In einem zweiten Terminal:

```bash
# Regression: /ping funktioniert weiterhin
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" -H "Content-Type: application/json" -d '{}'
```
Expected: `HTTP/1.1 200 OK`.

```bash
# Neuer Endpoint: /click
curl -i -X POST http://localhost:8787/click \
  -H "Origin: https://www.biohairbeauty.shop" -H "Content-Type: application/json" -d '{}'
```
Expected: `HTTP/1.1 200 OK`.

```bash
# Neuer Endpoint: /cart, anderer Shop
curl -i -X POST http://localhost:8787/cart \
  -H "Origin: https://member.biohairbeauty.shop" -H "Content-Type: application/json" -d '{}'
```
Expected: `HTTP/1.1 200 OK`.

```bash
# Preflight fuer /click
curl -i -X OPTIONS http://localhost:8787/click \
  -H "Origin: https://www.biohairbeauty.shop" -H "Access-Control-Request-Method: POST"
```
Expected: `HTTP/1.1 204 No Content` mit `access-control-allow-origin: https://www.biohairbeauty.shop`.

```bash
# Nicht erlaubter Origin fuer /cart
curl -i -X POST http://localhost:8787/cart \
  -H "Origin: https://evil.example.com" -H "Content-Type: application/json" -d '{}'
```
Expected: `HTTP/1.1 403 Forbidden`.

```bash
# Prototype-Property-Origin fuer /click (dieselbe Lücke wie einst bei /ping,
# muss auch hier weiterhin blockiert sein, da alle Endpunkte denselben
# resolveShopFromOrigin nutzen)
curl -i -X POST http://localhost:8787/click \
  -H "Origin: constructor" -H "Content-Type: application/json" -d '{}'
```
Expected: `HTTP/1.1 403 Forbidden`.

```bash
# Unbekannter Pfad weiterhin 404
curl -i http://localhost:8787/other
```
Expected: `HTTP/1.1 404 Not Found`.

- [ ] **Step 4: KV-Zähler prüfen**

Run: `npx wrangler kv key list --binding=USAGE_KV --local`
Expected: Einträge `count:hauptshop:<heutiges-Datum>`, `clicks:hauptshop:<heutiges-Datum>`,
`cart:member:<heutiges-Datum>` (aus den drei erfolgreichen POSTs oben). `wrangler dev`-Terminal
mit Strg+C beenden.

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/worker.js
git commit -m "feat: Worker-Routing fuer /click und /cart (generischer Counter-Handler)"
```

---

### Task 3: `buildReportEmail` — verschachtelte Drei-Metriken-Struktur

**Files:**
- Modify: `usage-tracking-worker/src/logic.js`
- Modify: `usage-tracking-worker/test/logic.test.js`

**Interfaces:**
- Consumes: `SHOP_IDS`, `SHOP_LABELS` (intern), `formatGermanDate` (intern) — unverändert.
- Produces: `buildReportEmail({ dateStr, counts }): { subject, text }`, wobei
  `counts` jetzt die Form `{ hauptshop: {opens?, clicks?, cart?}, member: {opens?, clicks?, cart?} }`
  hat (jeder Einzelwert optional, fehlt → 0) — von Task 4 (Cron-Report) genutzt.

- [ ] **Step 1: Bestehende Tests durch die neue Struktur ersetzen (RED)**

In `usage-tracking-worker/test/logic.test.js`, aktuelle Tests:

```js
test('buildReportEmail formatiert Betreff und Text mit beiden Shops', () => {
  const { subject, text } = buildReportEmail({
    dateStr: '2026-07-27',
    counts: { hauptshop: 42, member: 7 },
  });
  assert.equal(subject, 'Wizard-Nutzung 27.07.2026');
  assert.equal(text, 'Hauptshop: 42 Öffnungen\nMember-Shop: 7 Öffnungen');
});

test('buildReportEmail behandelt fehlende Zaehler als 0', () => {
  const { text } = buildReportEmail({ dateStr: '2026-07-27', counts: {} });
  assert.equal(text, 'Hauptshop: 0 Öffnungen\nMember-Shop: 0 Öffnungen');
});
```

Ersetzen durch:

```js
test('buildReportEmail formatiert Betreff und Text mit beiden Shops und allen Metriken', () => {
  const { subject, text } = buildReportEmail({
    dateStr: '2026-07-27',
    counts: {
      hauptshop: { opens: 42, clicks: 15, cart: 6 },
      member: { opens: 7, clicks: 3, cart: 1 },
    },
  });
  assert.equal(subject, 'Wizard-Nutzung 27.07.2026');
  assert.equal(
    text,
    'Hauptshop: 42 Öffnungen, 15 Klicks, 6 Warenkorb-Ereignisse\n' +
      'Member-Shop: 7 Öffnungen, 3 Klicks, 1 Warenkorb-Ereignisse'
  );
});

test('buildReportEmail behandelt komplett leeres counts-Objekt als 0', () => {
  const { text } = buildReportEmail({ dateStr: '2026-07-27', counts: {} });
  assert.equal(
    text,
    'Hauptshop: 0 Öffnungen, 0 Klicks, 0 Warenkorb-Ereignisse\n' +
      'Member-Shop: 0 Öffnungen, 0 Klicks, 0 Warenkorb-Ereignisse'
  );
});

test('buildReportEmail behandelt fehlende Einzelmetrik als 0', () => {
  const { text } = buildReportEmail({
    dateStr: '2026-07-27',
    counts: {
      hauptshop: { opens: 10, cart: 2 },
      member: { opens: 1 },
    },
  });
  assert.equal(
    text,
    'Hauptshop: 10 Öffnungen, 0 Klicks, 2 Warenkorb-Ereignisse\n' +
      'Member-Shop: 1 Öffnungen, 0 Klicks, 0 Warenkorb-Ereignisse'
  );
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — die alte Implementierung liest `counts[shop] || 0` (erwartet eine
Zahl), bekommt aber jetzt ein Objekt `{opens, clicks, cart}`, das Objekt ist truthy und
wird direkt in den String eingefügt (`"Hauptshop: [object Object] Öffnungen"` o. ä.),
nicht das erwartete Format.

- [ ] **Step 3: `buildReportEmail` in `usage-tracking-worker/src/logic.js` anpassen**

Aktueller Code:

```js
export function buildReportEmail(input) {
  const dateStr = input.dateStr;
  const counts = input.counts;
  const germanDate = formatGermanDate(dateStr);
  const lines = SHOP_IDS.map(function (shop) {
    const count = counts[shop] || 0;
    return SHOP_LABELS[shop] + ': ' + count + ' Öffnungen';
  });
  return {
    subject: 'Wizard-Nutzung ' + germanDate,
    text: lines.join('\n'),
  };
}
```

Ersetzen durch:

```js
const METRIC_ORDER = ['opens', 'clicks', 'cart'];

const METRIC_LABELS = {
  opens: 'Öffnungen',
  clicks: 'Klicks',
  cart: 'Warenkorb-Ereignisse',
};

export function buildReportEmail(input) {
  const dateStr = input.dateStr;
  const counts = input.counts;
  const germanDate = formatGermanDate(dateStr);
  const lines = SHOP_IDS.map(function (shop) {
    const shopCounts = counts[shop] || {};
    const parts = METRIC_ORDER.map(function (metric) {
      const value = shopCounts[metric] || 0;
      return value + ' ' + METRIC_LABELS[metric];
    });
    return SHOP_LABELS[shop] + ': ' + parts.join(', ');
  });
  return {
    subject: 'Wizard-Nutzung ' + germanDate,
    text: lines.join('\n'),
  };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — 18 von 18 Tests grün (17 aus Task 1 minus 2 ersetzte plus 3 neue).

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/logic.js usage-tracking-worker/test/logic.test.js
git commit -m "feat: buildReportEmail um Klicks und Warenkorb-Ereignisse erweitert"
```

---

### Task 4: `sendDailyReport` liest alle drei Metriken

**Files:**
- Modify: `usage-tracking-worker/src/worker.js`

**Interfaces:**
- Consumes: `kvKeyForShopDate(prefix, shop, dateStr)` aus Task 1,
  `buildReportEmail({dateStr, counts})` aus Task 3 (neue verschachtelte Struktur).
- Produces: `sendDailyReport(env)` — unverändertes äußeres Verhalten (E-Mail-Versand),
  jetzt mit drei statt einer Metrik pro Shop.

Kein automatisierter Test (Cloudflare-Binding-Code, gleiche Begründung wie bisher) —
manuelle Verifikation via `wrangler dev` + vorab per curl gesetzte KV-Werte +
`/__scheduled`-Trigger.

- [ ] **Step 1: `sendDailyReport` anpassen**

Aktueller Code in `usage-tracking-worker/src/worker.js`:

```js
async function sendDailyReport(env) {
  const dateStr = yesterdayBerlin();
  const counts = {};
  for (const shop of SHOP_IDS) {
    const value = await env.USAGE_KV.get(kvKeyForShopDate('count', shop, dateStr));
    counts[shop] = parseInt(value || '0', 10);
  }

  const { subject, text } = buildReportEmail({ dateStr, counts });
```

Ersetzen durch:

```js
async function sendDailyReport(env) {
  const dateStr = yesterdayBerlin();
  const counts = {};
  for (const shop of SHOP_IDS) {
    const opens = await env.USAGE_KV.get(kvKeyForShopDate('count', shop, dateStr));
    const clicks = await env.USAGE_KV.get(kvKeyForShopDate('clicks', shop, dateStr));
    const cart = await env.USAGE_KV.get(kvKeyForShopDate('cart', shop, dateStr));
    counts[shop] = {
      opens: parseInt(opens || '0', 10),
      clicks: parseInt(clicks || '0', 10),
      cart: parseInt(cart || '0', 10),
    };
  }

  const { subject, text } = buildReportEmail({ dateStr, counts });
```

(Rest der Funktion — Resend-Aufruf, try/catch, Logging — bleibt unverändert.)

- [ ] **Step 2: Lokale Test-Umgebungsvariable sicherstellen**

Prüfen, ob `usage-tracking-worker/.dev.vars` existiert (durch `.gitignore` aus Schritt 6
bereits ausgeschlossen). Falls nicht vorhanden, erstellen:

```
RESEND_API_KEY=test_dummy_key_fuer_lokale_verifikation
```

- [ ] **Step 3: KV-Werte für "gestern" vorbereiten und Cron simulieren**

Run: `cd usage-tracking-worker && npx wrangler dev`
Expected: `Ready on http://localhost:8787`.

In einem zweiten Terminal — Werte für **gestern** direkt in KV schreiben (der
Ping-Endpoint schreibt nur für "heute", für den Test brauchen wir aber einen Wert für
"gestern", den `sendDailyReport` liest):

```bash
GESTERN=$(TZ=Europe/Berlin date -v-1d +%Y-%m-%d 2>/dev/null || TZ=Europe/Berlin date -d yesterday +%Y-%m-%d)
npx wrangler kv key put "count:hauptshop:$GESTERN" "42" --binding=USAGE_KV --local
npx wrangler kv key put "clicks:hauptshop:$GESTERN" "15" --binding=USAGE_KV --local
npx wrangler kv key put "cart:hauptshop:$GESTERN" "6" --binding=USAGE_KV --local
```

Cron-Trigger simulieren:

```bash
curl "http://localhost:8787/__scheduled?cron=0+5+*+*+*"
```

Expected: Im `wrangler dev`-Terminal erscheint eine Logzeile
`[usage-tracking] Resend-Fehler: 401 ...` (401 wegen des Dummy-Keys — das bestätigt,
dass `yesterdayBerlin`, alle drei KV-Reads und der zusammengesetzte Report-Text korrekt
aufgebaut wurden). Zusätzlich vor der Log-Zeile in der Konsolen-Ausgabe (falls
`console.log`/`console.error` das Argument mit ausgibt) oder durch kurzes Hinzufügen
eines temporären `console.log(text)` vor dem Resend-Aufruf (danach wieder entfernen)
verifizieren, dass der Text `"Hauptshop: 42 Öffnungen, 15 Klicks, 6 Warenkorb-Ereignisse"`
enthält.

`wrangler dev`-Terminal mit Strg+C beenden.

- [ ] **Step 4: Commit**

```bash
git add usage-tracking-worker/src/worker.js
git commit -m "feat: sendDailyReport liest Klicks und Warenkorb-Ereignisse zusaetzlich zu Oeffnungen"
```

---

### Task 5: `wizard.js` — Klick- und Warenkorb-Beacons

**Files:**
- Modify: `wizard.js`

**Interfaces:**
- Consumes: `config.key` (unverändert).
- Produces: `pingProductClick()`, `pingCartEvent()` — neue Fire-and-forget-Funktionen,
  analog zu `pingUsage()`.

Kein automatisierter Test (`wizard.js` hat projektweit keine automatisierte Testsuite) —
Verifikation über `node --check` + manuelle Codedurchsicht, analog zum bestehenden
Vorgehen beim ursprünglichen Öffnungs-Ping.

- [ ] **Step 1: Gemeinsame Beacon-Hilfsfunktion + neue Konstanten + Wrapper einfügen**

Aktueller Code in `wizard.js` (der komplette `usageTracking`-Abschnitt):

```js
  // ---------------------------------------------------------------------
  // usageTracking — meldet jede Wizard-Oeffnung an den Cloudflare Worker aus
  // Schritt 6 (getrennte Zaehlung pro Shop, taeglicher E-Mail-Bericht). Fire-
  // and-forget: darf den Wizard nie blockieren oder einen Fehler werfen.
  // ---------------------------------------------------------------------

  // TODO: nach dem Deployment des Cloudflare Workers (siehe README, Abschnitt
  // "Manuelle Schritte: Nutzungs-Tracking einrichten") die echte Worker-URL
  // eintragen. Leerer String = Tracking ist deaktiviert, kein Fehler fuer den Kunden.
  const USAGE_PING_URL = 'https://biohairbeauty-usage-tracking.fuerihrehaare.workers.dev/ping';

  function pingUsage() {
    if (!USAGE_PING_URL) {
      return;
    }
    const payload = JSON.stringify({ shop: config.key });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(USAGE_PING_URL, payload)) {
        return;
      }
      fetch(USAGE_PING_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      // Tracking darf den Wizard nie beeintraechtigen.
    }
  }
```

Ersetzen durch:

```js
  // ---------------------------------------------------------------------
  // usageTracking — meldet Wizard-Oeffnungen, Produktlink-Klicks und
  // Warenkorb-Ereignisse an den Cloudflare Worker aus Schritt 6 (getrennte
  // Zaehlung pro Shop, taeglicher E-Mail-Bericht). Fire-and-forget: darf den
  // Wizard nie blockieren oder einen Fehler werfen.
  // ---------------------------------------------------------------------

  // TODO: nach dem Deployment des Cloudflare Workers (siehe README, Abschnitt
  // "Manuelle Schritte: Nutzungs-Tracking einrichten") die echte Worker-URL
  // eintragen. Leerer String = Tracking ist deaktiviert, kein Fehler fuer den Kunden.
  const USAGE_PING_URL = 'https://biohairbeauty-usage-tracking.fuerihrehaare.workers.dev/ping';
  // TODO: analog zu USAGE_PING_URL — nach Deployment die echte Worker-URL fuer
  // Produktlink-Klicks eintragen.
  const USAGE_CLICK_URL = '';
  // TODO: analog zu USAGE_PING_URL — nach Deployment die echte Worker-URL fuer
  // Warenkorb-Ereignisse eintragen.
  const USAGE_CART_URL = '';

  // Wichtig: Payload wird als Plain-String an sendBeacon uebergeben (kein Blob,
  // kein 'application/json'-Content-Type) — das hatte beim urspruenglichen
  // Oeffnungs-Ping einen CORS-Preflight-Bug verursacht (Browser hat den
  // Preflight geschickt, aber nie den eigentlichen POST — siehe Commit 1535557).
  function sendUsageBeacon(url) {
    if (!url) {
      return;
    }
    const payload = JSON.stringify({ shop: config.key });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, payload)) {
        return;
      }
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      // Tracking darf den Wizard nie beeintraechtigen.
    }
  }

  function pingUsage() {
    sendUsageBeacon(USAGE_PING_URL);
  }

  function pingProductClick() {
    sendUsageBeacon(USAGE_CLICK_URL);
  }

  function pingCartEvent() {
    sendUsageBeacon(USAGE_CART_URL);
  }
```

- [ ] **Step 2: Beacon beim Produktlink-Klick auslösen**

Aktueller Code (Kontext: Bild/Name verlinken auf die Produktseite):

```js
      if (angezeigtesProdukt.url) {
        card.appendChild(
          el(
            'a',
            {
              className: 'wizard-produkt-link',
              attrs: { href: angezeigtesProdukt.url, target: '_blank', rel: 'noopener noreferrer' },
            },
            [bildElement, nameElement]
          )
        );
      } else {
```

Ändern zu:

```js
      if (angezeigtesProdukt.url) {
        card.appendChild(
          el(
            'a',
            {
              className: 'wizard-produkt-link',
              attrs: { href: angezeigtesProdukt.url, target: '_blank', rel: 'noopener noreferrer' },
              onClick: pingProductClick,
            },
            [bildElement, nameElement]
          )
        );
      } else {
```

- [ ] **Step 3: Beacon bei erfolgreichem Warenkorb-Hinzufügen auslösen**

Aktueller Code (im `onClick`-Handler des "In den Warenkorb"-Buttons):

```js
          onClick: () => {
            addToCart(ecwidId, (success, error) => {
              if (success) {
                const nextCartAdded = Object.assign({}, state.cartAdded);
                nextCartAdded[sku] = true;
                const nextCartErrors = Object.assign({}, state.cartErrors);
                delete nextCartErrors[sku];
                update({ cartAdded: nextCartAdded, cartErrors: nextCartErrors });
              } else {
```

Ändern zu:

```js
          onClick: () => {
            addToCart(ecwidId, (success, error) => {
              if (success) {
                pingCartEvent();
                const nextCartAdded = Object.assign({}, state.cartAdded);
                nextCartAdded[sku] = true;
                const nextCartErrors = Object.assign({}, state.cartErrors);
                delete nextCartErrors[sku];
                update({ cartAdded: nextCartAdded, cartErrors: nextCartErrors });
              } else {
```

- [ ] **Step 4: Syntax-Check**

Run: `node --check wizard.js`
Expected: kein Output (Exit-Code 0).

- [ ] **Step 5: Manuelle Codedurchsicht (Checkliste)**

- `pingProductClick` wird durch `onClick` am `<a class="wizard-produkt-link">`
  ausgelöst — `grep -n "pingProductClick" wizard.js` muss genau 2 Treffer zeigen
  (Definition + ein Aufrufort als `onClick`-Referenz, nicht als Funktionsaufruf mit
  Klammern, da `el()` die Funktion selbst als Callback erwartet).
- `pingCartEvent()` wird als Funktionsaufruf (mit Klammern) genau einmal im
  `if (success)`-Zweig aufgerufen — `grep -n "pingCartEvent" wizard.js` muss genau 2
  Treffer zeigen (Definition + dieser eine Aufruf).
- `USAGE_CLICK_URL` und `USAGE_CART_URL` sind beide `''` im committeten Stand.
- Kein Aufruf von `pingProductClick`/`pingCartEvent` in `render()`,
  `renderWizardInto()` oder anderswo außerhalb der zwei genannten Stellen.

- [ ] **Step 6: Commit**

```bash
git add wizard.js
git commit -m "feat: Produktlink-Klicks und Warenkorb-Ereignisse an Nutzungs-Tracking melden"
```

---

### Task 6: README aktualisieren

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Beschreibung in "Manuelle Schritte: Nutzungs-Tracking einrichten" ergänzen**

Innerhalb des bestehenden Abschnitts "## Manuelle Schritte: Nutzungs-Tracking
einrichten (Schritt 6)", direkt nach dem einleitenden Absatz (der mit "Der Code für das
tägliche Nutzungs-Tracking ist fertig ..." beginnt und mit "... das kannst nur du selbst
einrichten:" endet), folgenden Satz ergänzen, bevor die nummerierte Liste beginnt:

Aktueller Text (Ausschnitt, der Absatz vor der nummerierten Liste):

```
Der Code für das tägliche Nutzungs-Tracking ist fertig (`usage-tracking-worker/`), das
Deployment erfordert aber echte Cloudflare- und Resend-Accounts — das kannst nur du
selbst einrichten:
```

Ändern zu:

```
Der Code für das tägliche Nutzungs-Tracking ist fertig (`usage-tracking-worker/`), das
Deployment erfordert aber echte Cloudflare- und Resend-Accounts — das kannst nur du
selbst einrichten. Neben Wizard-Öffnungen (`/ping`) zählt der Worker inzwischen auch
Produktlink-Klicks (`/click`) und erfolgreiche Warenkorb-Ereignisse (`/cart`), jeweils
getrennt pro Shop — alle drei erscheinen in derselben täglichen Bericht-E-Mail.
```

- [ ] **Step 2: Beispiel-E-Mail-Text im gleichen Abschnitt aktualisieren, falls vorhanden**

Prüfen, ob im Abschnitt "Manuelle Schritte: Nutzungs-Tracking einrichten" oder in der
README sonst irgendwo ein Beispiel-E-Mail-Text im alten Format
(`"Hauptshop: 42 Öffnungen"` ohne Klicks/Warenkorb) vorkommt. Falls ja, auf das neue
Format aktualisieren: `"Hauptshop: 42 Öffnungen, 15 Klicks, 6 Warenkorb-Ereignisse"`.

- [ ] **Step 3: "Noch zu tun" — Live-Test-Hinweis erweitern**

Aktueller Text:

```
- **Nutzungs-Tracking Live-Test**: Nach dem Deployment (siehe "Manuelle Schritte:
  Nutzungs-Tracking einrichten") einmal auf beiden echten Shop-Domains den Wizard öffnen
  und in Cloudflare (`npx wrangler kv key get ... --binding=USAGE_KV`) prüfen, ob der
  Zähler hochgezählt wird. Am Folgetag prüfen, ob die tägliche Bericht-E-Mail bei
  ag@biohairspa.de ankommt (mit den tatsächlichen Zahlen des Vortages).
```

Ändern zu:

```
- **Nutzungs-Tracking Live-Test**: Nach dem Deployment (siehe "Manuelle Schritte:
  Nutzungs-Tracking einrichten") einmal auf beiden echten Shop-Domains den Wizard öffnen,
  einen Produktlink anklicken und ein Produkt in den Warenkorb legen — danach in
  Cloudflare (`npx wrangler kv key get ... --binding=USAGE_KV --remote`) prüfen, ob alle
  drei Zähler (`count:`, `clicks:`, `cart:`) hochgezählt werden. Am Folgetag prüfen, ob
  die tägliche Bericht-E-Mail bei ag@biohairspa.de ankommt und alle drei Metriken pro
  Shop enthält.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: Klick- und Warenkorb-Tracking in README dokumentieren"
```

---

## Nach Abschluss aller Tasks

Deployment (`wrangler deploy` im `usage-tracking-worker`-Ordner) und das Eintragen der
echten Worker-URL in `USAGE_CLICK_URL`/`USAGE_CART_URL` in `wizard.js` sind — wie beim
ursprünglichen Öffnungs-Ping — manuelle, vom Auftraggeber freizugebende Schritte nach
Abschluss der Implementierung, kein separater Plan-Task.
