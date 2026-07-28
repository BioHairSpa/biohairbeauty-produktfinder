# Schritt 6 — Tägliches Nutzungs-Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zähle Wizard-Öffnungen pro Tag getrennt nach Shop (Hauptshop/Member-Shop) über
einen Cloudflare Worker mit KV-Speicher und verschicke täglich einen kurzen
Text-E-Mail-Bericht des Vortages über Resend an ag@biohairspa.de.

**Architecture:** Neuer, unabhängiger Ordner `usage-tracking-worker/` mit einem
Cloudflare Worker. `wizard.js` schickt beim Öffnen (Overlay-Button-Klick oder
Inline-Mount) einen Fire-and-forget-Beacon an `POST /ping`. Der Worker prüft den
`Origin`-Header gegen eine Allowlist, leitet daraus den Shop ab und erhöht einen
Tages-Zähler in KV (Schlüssel `count:<shop>:<YYYY-MM-DD>` in Europe/Berlin-Zeit,
30 Tage TTL). Ein täglicher Cron Trigger (5:00 UTC) liest die Zähler des Vortages
und verschickt eine Text-E-Mail über die Resend-API.

**Tech Stack:** Cloudflare Workers, Cloudflare KV, Cloudflare Cron Triggers, Resend
HTTP-API, Node.js (nur lokal für Tests und `wrangler`), Node.js eingebauter Test-Runner
(`node:test`) — keine zusätzlichen Test-Frameworks, passend zur bestehenden
Build-Schritt-freien Philosophie des Projekts (siehe README, `wizard.js`-Kommentarkopf).

## Global Constraints

- Keine Secrets im Code oder in Commits (siehe README, Abschnitt "API-Zugänge") — der
  Resend-API-Key wird ausschließlich als Worker-Secret via `wrangler secret put`
  hinterlegt, niemals in `wrangler.toml` oder im Repo.
- Der Wizard-Client (`wizard.js`) darf durch das Tracking niemals blockiert werden oder
  einen sichtbaren Fehler werfen — Tracking ist strikt Fire-and-forget (bestehende
  Projekt-Philosophie: "still zurückfallen" statt Fehlermeldung, siehe README Abschnitt
  "Wie die Live-Prüfung funktioniert").
- Gezählt wird die rohe Anzahl aller Wizard-Öffnungen pro Tag/Shop — kein
  Unique-Visitor-Tracking, keine Cookies/IDs im Client.
- Tageszähler laufen nach 30 Tagen automatisch ab (KV `expirationTtl`).
- Die E-Mail geht ausschließlich an `ag@biohairspa.de`, enthält nur die
  Vortages-Zahlen pro Shop, keinen Trend/Vergleich.

Spec: `docs/superpowers/specs/2026-07-28-usage-tracking-design.md`

---

### Task 1: Worker-Projekt scaffolden + Origin-Erkennung

**Files:**
- Create: `usage-tracking-worker/package.json`
- Create: `usage-tracking-worker/wrangler.toml`
- Create: `usage-tracking-worker/src/logic.js`
- Create: `usage-tracking-worker/test/logic.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `resolveShopFromOrigin(origin: string|null): 'hauptshop'|'member'|null` — ab
  hier von allen späteren Worker-Tasks genutzt, um aus dem `Origin`-Header den Shop
  abzuleiten.

- [ ] **Step 1: Verzeichnisse und Projekt-Dateien anlegen**

Erstelle `usage-tracking-worker/package.json`:

```json
{
  "name": "biohairbeauty-usage-tracking-worker",
  "private": true,
  "type": "module",
  "version": "1.0.0",
  "scripts": {
    "test": "node --test test/",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^4.114.0"
  }
}
```

Erstelle `usage-tracking-worker/wrangler.toml`:

```toml
name = "biohairbeauty-usage-tracking"
main = "src/worker.js"
compatibility_date = "2026-07-28"

[[kv_namespaces]]
binding = "USAGE_KV"
id = "REPLACE_WITH_KV_NAMESPACE_ID"

[triggers]
crons = ["0 5 * * *"]

[vars]
REPORT_TO_EMAIL = "ag@biohairspa.de"
REPORT_FROM_EMAIL = "Produkt-Finder-Wizard <report@REPLACE_WITH_VERIFIED_SENDER_DOMAIN>"
```

**Files:**
- Modify: `.gitignore`

Aktueller Inhalt ist genau:
```
.env
```

Ersetze durch:
```
.env
usage-tracking-worker/node_modules
usage-tracking-worker/.wrangler
usage-tracking-worker/.dev.vars
```

- [ ] **Step 2: Dependencies installieren**

Run: `cd usage-tracking-worker && npm install`
Expected: `added <N> packages` (wrangler + Transitiv-Abhängigkeiten), kein Fehler.

- [ ] **Step 3: Fehlschlagenden Test für `resolveShopFromOrigin` schreiben**

Erstelle `usage-tracking-worker/test/logic.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShopFromOrigin } from '../src/logic.js';

test('resolveShopFromOrigin erkennt Hauptshop', () => {
  assert.equal(resolveShopFromOrigin('https://www.biohairbeauty.shop'), 'hauptshop');
});

test('resolveShopFromOrigin erkennt Member-Shop', () => {
  assert.equal(resolveShopFromOrigin('https://member.biohairbeauty.shop'), 'member');
});

test('resolveShopFromOrigin lehnt unbekannten Origin ab', () => {
  assert.equal(resolveShopFromOrigin('https://evil.example.com'), null);
});

test('resolveShopFromOrigin lehnt fehlenden Origin ab', () => {
  assert.equal(resolveShopFromOrigin(null), null);
  assert.equal(resolveShopFromOrigin(undefined), null);
});
```

- [ ] **Step 4: Test ausführen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — `Cannot find module '../src/logic.js'` (Datei existiert noch nicht).

- [ ] **Step 5: `src/logic.js` mit `resolveShopFromOrigin` implementieren**

Erstelle `usage-tracking-worker/src/logic.js`:

```js
const SHOP_ORIGINS = {
  'https://www.biohairbeauty.shop': 'hauptshop',
  'https://member.biohairbeauty.shop': 'member',
};

export const SHOP_IDS = ['hauptshop', 'member'];

export function resolveShopFromOrigin(origin) {
  if (!origin) {
    return null;
  }
  return SHOP_ORIGINS[origin] || null;
}
```

- [ ] **Step 6: Test ausführen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — 4 von 4 Tests grün.

- [ ] **Step 7: Commit**

```bash
git add usage-tracking-worker/package.json usage-tracking-worker/package-lock.json \
  usage-tracking-worker/wrangler.toml usage-tracking-worker/src/logic.js \
  usage-tracking-worker/test/logic.test.js .gitignore
git commit -m "feat: Worker-Projekt scaffolden, Origin-zu-Shop-Erkennung"
```

---

### Task 2: Berlin-Datumshilfen (`todayBerlin`, `yesterdayBerlin`)

**Files:**
- Modify: `usage-tracking-worker/src/logic.js`
- Modify: `usage-tracking-worker/test/logic.test.js`

**Interfaces:**
- Consumes: nichts aus Task 1 direkt (unabhängige Funktionen im selben Modul).
- Produces: `todayBerlin(date?: Date): string` (Format `YYYY-MM-DD` in Europe/Berlin-Zeit),
  `yesterdayBerlin(date?: Date): string` — von Task 3 (Ping-Handler, heutiger Zähler) und
  Task 6 (Cron-Report, gestriger Zähler) genutzt.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

Füge in `usage-tracking-worker/test/logic.test.js` hinzu (Import-Zeile erweitern und
neue Tests ans Ende anfügen):

```js
import { resolveShopFromOrigin, todayBerlin, yesterdayBerlin } from '../src/logic.js';
```

(ersetzt die bisherige Import-Zeile)

```js
test('todayBerlin formatiert als YYYY-MM-DD', () => {
  const date = new Date('2026-07-28T10:00:00Z'); // 12:00 Berlin (CEST, UTC+2)
  assert.equal(todayBerlin(date), '2026-07-28');
});

test('todayBerlin rechnet UTC-Zeit kurz vor Mitternacht korrekt in Berlin-Folgetag um', () => {
  // 23:00 UTC an einem Sommertag = 01:00 Berlin am naechsten Tag (CEST, UTC+2)
  const date = new Date('2026-07-28T23:00:00Z');
  assert.equal(todayBerlin(date), '2026-07-29');
});

test('yesterdayBerlin liefert den Kalendertag davor', () => {
  const date = new Date('2026-07-28T10:00:00Z');
  assert.equal(yesterdayBerlin(date), '2026-07-27');
});

test('yesterdayBerlin funktioniert ueber einen Monatswechsel hinweg', () => {
  const date = new Date('2026-08-01T10:00:00Z');
  assert.equal(yesterdayBerlin(date), '2026-07-31');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — `todayBerlin is not a function` (bzw. `undefined is not a function`).

- [ ] **Step 3: Implementieren**

Füge in `usage-tracking-worker/src/logic.js` hinzu (nach `resolveShopFromOrigin`):

```js
const berlinDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayBerlin(date) {
  return berlinDateFormatter.format(date || new Date());
}

export function yesterdayBerlin(date) {
  const todayStr = todayBerlin(date);
  const [year, month, day] = todayStr.split('-').map(Number);
  const noonUtc = Date.UTC(year, month - 1, day, 12);
  const previousDay = new Date(noonUtc - 24 * 60 * 60 * 1000);
  return todayBerlin(previousDay);
}
```

(`en-CA`-Locale liefert von Haus aus das Format `YYYY-MM-DD`. Die Subtraktion erfolgt
über UTC-Mittag des aktuellen Berlin-Kalendertags, damit die Zeitzonenumrechnung nie in
der Nähe einer Berlin-Mitternachtsgrenze liegt und DST-Umstellungen keinen
Kalendertag-Sprung verursachen können.)

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — 8 von 8 Tests grün.

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/logic.js usage-tracking-worker/test/logic.test.js
git commit -m "feat: Berlin-Zeitzonen-Datumshilfen fuer Tageszaehler"
```

---

### Task 3: KV-Schlüssel-Aufbau + TTL-Konstante

**Files:**
- Modify: `usage-tracking-worker/src/logic.js`
- Modify: `usage-tracking-worker/test/logic.test.js`

**Interfaces:**
- Consumes: nichts direkt.
- Produces: `kvKeyForShopDate(shop: string, dateStr: string): string`,
  `KV_TTL_SECONDS: number` — von Task 5 (Ping-Handler) und Task 6 (Cron-Report) genutzt.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

Import-Zeile in `usage-tracking-worker/test/logic.test.js` erweitern:

```js
import {
  resolveShopFromOrigin,
  todayBerlin,
  yesterdayBerlin,
  kvKeyForShopDate,
  KV_TTL_SECONDS,
} from '../src/logic.js';
```

Tests ans Ende anfügen:

```js
test('kvKeyForShopDate baut den erwarteten Schluessel', () => {
  assert.equal(kvKeyForShopDate('hauptshop', '2026-07-27'), 'count:hauptshop:2026-07-27');
});

test('KV_TTL_SECONDS entspricht 30 Tagen', () => {
  assert.equal(KV_TTL_SECONDS, 30 * 24 * 60 * 60);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — `kvKeyForShopDate is not a function`.

- [ ] **Step 3: Implementieren**

Füge in `usage-tracking-worker/src/logic.js` hinzu:

```js
export const KV_TTL_SECONDS = 30 * 24 * 60 * 60;

export function kvKeyForShopDate(shop, dateStr) {
  return 'count:' + shop + ':' + dateStr;
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — 10 von 10 Tests grün.

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/logic.js usage-tracking-worker/test/logic.test.js
git commit -m "feat: KV-Schluesselaufbau und TTL-Konstante fuer Tageszaehler"
```

---

### Task 4: Report-E-Mail-Formatierung

**Files:**
- Modify: `usage-tracking-worker/src/logic.js`
- Modify: `usage-tracking-worker/test/logic.test.js`

**Interfaces:**
- Consumes: `SHOP_IDS` aus Task 1.
- Produces: `buildReportEmail({ dateStr: string, counts: {hauptshop?: number, member?: number} }): { subject: string, text: string }` —
  von Task 6 (Cron-Report) genutzt, um den Resend-API-Aufruf zu befüllen.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

Import-Zeile in `usage-tracking-worker/test/logic.test.js` erweitern:

```js
import {
  resolveShopFromOrigin,
  todayBerlin,
  yesterdayBerlin,
  kvKeyForShopDate,
  KV_TTL_SECONDS,
  buildReportEmail,
} from '../src/logic.js';
```

Tests ans Ende anfügen:

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

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: FAIL — `buildReportEmail is not a function`.

- [ ] **Step 3: Implementieren**

Füge in `usage-tracking-worker/src/logic.js` hinzu:

```js
const SHOP_LABELS = {
  hauptshop: 'Hauptshop',
  member: 'Member-Shop',
};

function formatGermanDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return day + '.' + month + '.' + year;
}

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

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `cd usage-tracking-worker && npm test`
Expected: PASS — 12 von 12 Tests grün.

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/logic.js usage-tracking-worker/test/logic.test.js
git commit -m "feat: Report-E-Mail-Formatierung (Betreff/Text pro Shop)"
```

---

### Task 5: Worker Ping-Endpoint (`POST /ping`)

**Files:**
- Create: `usage-tracking-worker/src/worker.js`

**Interfaces:**
- Consumes: `resolveShopFromOrigin`, `todayBerlin`, `kvKeyForShopDate`, `KV_TTL_SECONDS`
  aus `./logic.js` (Tasks 1–3). `env.USAGE_KV` (KV-Binding aus `wrangler.toml`).
- Produces: `export default { fetch }` — Task 6 erweitert dieselbe Datei um `scheduled`.

Kein automatisierter Unit-Test möglich, ohne zusätzliche Test-Infrastruktur
(`@cloudflare/vitest-pool-workers`) einzuführen — das würde der bestehenden
Build-Schritt-freien Philosophie des Projekts widersprechen (siehe README,
`wizard.js`-Kopfkommentar: "Kein Framework, kein Build-Schritt"). Stattdessen wird hier
manuell mit `wrangler dev` verifiziert, analog zum bestehenden Vorgehen für die
Ecwid-Warenkorb-Integration (siehe README, Abschnitt "Noch zu tun": *"muss der komplette
Fluss ... einmal auf einer echten Store-Seite durchgeklickt werden"*).

- [ ] **Step 1: `src/worker.js` mit `fetch`-Handler implementieren**

Erstelle `usage-tracking-worker/src/worker.js`:

```js
import { resolveShopFromOrigin, todayBerlin, kvKeyForShopDate, KV_TTL_SECONDS } from './logic.js';

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

  const key = kvKeyForShopDate(shop, todayBerlin());
  const current = parseInt((await env.USAGE_KV.get(key)) || '0', 10);
  await env.USAGE_KV.put(key, String(current + 1), { expirationTtl: KV_TTL_SECONDS });

  return new Response('OK', {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ping') {
      return new Response('Not found', { status: 404 });
    }
    return handlePing(request, env);
  },
};
```

- [ ] **Step 2: Lokal starten**

Run: `cd usage-tracking-worker && npx wrangler dev`
Expected: Ausgabe zeigt `Ready on http://localhost:8787` (Port kann abweichen — aus der
Ausgabe übernehmen). Terminal offen lassen, Schritte 3–5 in einem zweiten Terminal
ausführen.

- [ ] **Step 3: Preflight (OPTIONS) von erlaubtem Origin prüfen**

Run:
```bash
curl -i -X OPTIONS http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" \
  -H "Access-Control-Request-Method: POST"
```
Expected: `HTTP/1.1 204 No Content` mit Header
`access-control-allow-origin: https://www.biohairbeauty.shop`.

- [ ] **Step 4: POST von erlaubtem Origin prüfen und KV-Zähler kontrollieren**

Run:
```bash
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://www.biohairbeauty.shop" \
  -H "Content-Type: application/json" \
  -d '{"shop":"hauptshop"}'
```
Expected: `HTTP/1.1 200 OK`, Body `OK`.

Run (im `usage-tracking-worker`-Ordner, zeigt den erhöhten Zähler):
```bash
npx wrangler kv key list --binding=USAGE_KV --local
```
Expected: Ein Eintrag `count:hauptshop:<heutiges-Berlin-Datum>`. Wert prüfen mit
`npx wrangler kv key get "count:hauptshop:<heutiges-Berlin-Datum>" --binding=USAGE_KV --local`
Expected: `1` (bei erstem Aufruf) bzw. `2` nach einem zweiten `curl`-Aufruf.

- [ ] **Step 5: POST von nicht erlaubtem Origin prüfen**

Run:
```bash
curl -i -X POST http://localhost:8787/ping \
  -H "Origin: https://evil.example.com" \
  -H "Content-Type: application/json" \
  -d '{"shop":"hauptshop"}'
```
Expected: `HTTP/1.1 403 Forbidden`. `wrangler dev`-Terminal mit Strg+C beenden.

- [ ] **Step 6: Commit**

```bash
git add usage-tracking-worker/src/worker.js
git commit -m "feat: Worker Ping-Endpoint (POST /ping) mit Origin-Check und KV-Zaehler"
```

---

### Task 6: Worker Cron-Report (`scheduled`)

**Files:**
- Modify: `usage-tracking-worker/src/worker.js`

**Interfaces:**
- Consumes: `yesterdayBerlin`, `kvKeyForShopDate`, `buildReportEmail`, `SHOP_IDS` aus
  `./logic.js` (Tasks 1, 2, 4). `env.USAGE_KV`, `env.RESEND_API_KEY` (Secret),
  `env.REPORT_TO_EMAIL`, `env.REPORT_FROM_EMAIL` (aus `wrangler.toml`).
- Produces: `export default { fetch, scheduled }`.

Wie in Task 5: kein automatisierter Test, manuelle Verifikation über `wrangler dev` mit
dem dokumentierten `/__scheduled`-Trigger-Mechanismus.

- [ ] **Step 1: `scheduled`-Handler implementieren**

Ersetze in `usage-tracking-worker/src/worker.js` die Import-Zeile:

```js
import {
  resolveShopFromOrigin,
  todayBerlin,
  yesterdayBerlin,
  kvKeyForShopDate,
  KV_TTL_SECONDS,
  buildReportEmail,
  SHOP_IDS,
} from './logic.js';
```

Füge nach der bestehenden `handlePing`-Funktion hinzu:

```js
async function sendDailyReport(env) {
  const dateStr = yesterdayBerlin();
  const counts = {};
  for (const shop of SHOP_IDS) {
    const value = await env.USAGE_KV.get(kvKeyForShopDate(shop, dateStr));
    counts[shop] = parseInt(value || '0', 10);
  }

  const { subject, text } = buildReportEmail({ dateStr, counts });

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

  console.log('[usage-tracking] Resend-Antwort:', response.status, await response.text());
}
```

Und ergänze im `export default`-Objekt den `scheduled`-Handler:

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

- [ ] **Step 2: Lokale Test-Umgebungsvariable für den Resend-Key setzen**

Erstelle `usage-tracking-worker/.dev.vars` (durch `.gitignore` aus Task 1 bereits
ausgeschlossen, wird nicht committet):

```
RESEND_API_KEY=test_dummy_key_fuer_lokale_verifikation
```

- [ ] **Step 3: Lokal starten und Cron-Trigger simulieren**

Run: `cd usage-tracking-worker && npx wrangler dev`
Expected: `Ready on http://localhost:8787`.

In einem zweiten Terminal:
```bash
curl "http://localhost:8787/__scheduled?cron=0+5+*+*+*"
```
Expected: `curl` bekommt eine leere `200`-Antwort. Im `wrangler dev`-Terminal erscheint
die Logzeile `[usage-tracking] Resend-Antwort: 401 ...` (401, weil `test_dummy_key...`
kein echter Resend-Key ist — das bestätigt, dass `yesterdayBerlin`, die KV-Lese-Logik und
der Resend-Request korrekt aufgebaut und ausgeführt werden; der eigentliche E-Mail-Versand
mit echtem Key wird erst in Task 8/den manuellen Deployment-Schritten mit echtem
Resend-Account verifiziert).

- [ ] **Step 4: `wrangler dev` beenden**

Strg+C im `wrangler dev`-Terminal.

- [ ] **Step 5: Commit**

```bash
git add usage-tracking-worker/src/worker.js
git commit -m "feat: Worker Cron-Report (taeglicher Resend-Versand der Vortageszahlen)"
```

---

### Task 7: `wizard.js` — Ping bei Wizard-Öffnung

**Files:**
- Modify: `wizard.js:964` (vor `const INLINE_CONTAINER_ID = ...`)
- Modify: `wizard.js` (in `mount()` und `openOverlay()`)

**Interfaces:**
- Consumes: `config.key` (bereits vorhanden, liefert `'hauptshop'` oder `'member'`,
  siehe `wizard.js:47-64`).
- Produces: `pingUsage()` — feuert einen Fire-and-forget-Request an `USAGE_PING_URL`.

Kein automatisierter Test — `wizard.js` hat im gesamten Projekt keine automatisierte
Testsuite (siehe README, Abschnitt "Lokal testen": manuelles Testen über `index.html`).
Verifikation erfolgt hier ebenso manuell, konsistent mit dem bestehenden Vorgehen.

- [ ] **Step 1: `pingUsage()` und `USAGE_PING_URL` einfügen**

In `wizard.js`, direkt vor der Zeile
`const INLINE_CONTAINER_ID = 'produkt-finder-wizard-inline';` (aktueller Kontext:
Abschnittskommentar `// mount — erkennt Einstiegspunkt: ...` gefolgt von dieser Zeile),
folgenden Block einfügen:

```js
  // ---------------------------------------------------------------------
  // usageTracking — meldet jede Wizard-Oeffnung an den Cloudflare Worker aus
  // Schritt 6 (getrennte Zaehlung pro Shop, taeglicher E-Mail-Bericht). Fire-
  // and-forget: darf den Wizard nie blockieren oder einen Fehler werfen.
  // ---------------------------------------------------------------------

  // TODO: nach dem Deployment des Cloudflare Workers (siehe README, Abschnitt
  // "Manuelle Schritte: Nutzungs-Tracking einrichten") die echte Worker-URL
  // eintragen. Leerer String = Tracking ist deaktiviert, kein Fehler fuer den Kunden.
  const USAGE_PING_URL = '';

  function pingUsage() {
    if (!USAGE_PING_URL) {
      return;
    }
    const payload = JSON.stringify({ shop: config.key });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(USAGE_PING_URL, blob)) {
          return;
        }
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

- [ ] **Step 2: Ping beim Inline-Mount auslösen**

In `mount()`, aktueller Code:

```js
    if (inlineContainer) {
      // Der von der Nutzerin in Ecwid eingebettete Container (mit der ID)
```

Ändern zu:

```js
    if (inlineContainer) {
      pingUsage();

      // Der von der Nutzerin in Ecwid eingebettete Container (mit der ID)
```

- [ ] **Step 3: Ping beim Overlay-Öffnen auslösen**

Aktueller Code:

```js
  function openOverlay() {
    if (overlayEl) {
```

Ändern zu:

```js
  function openOverlay() {
    pingUsage();

    if (overlayEl) {
```

- [ ] **Step 4: Manuell verifizieren (Overlay-Modus)**

Terminal 1: `cd usage-tracking-worker && npx wrangler dev` (Worker läuft lokal).

In `wizard.js` `USAGE_PING_URL` temporär auf `'http://localhost:8787/ping'` setzen
(nur lokal, nicht committen).

`index.html?wizardStore=hauptshop` im Browser öffnen, DevTools → Network-Tab öffnen.
Auf den schwebenden "Beautyfinder"-Button klicken.
Expected: genau ein `POST`-Request an `/ping` mit Status 200 im Network-Tab. Innerhalb
des Wizards durch die Schritte navigieren.
Expected: keine weiteren `/ping`-Requests. Overlay schließen und erneut öffnen.
Expected: ein weiterer `/ping`-Request (jede Öffnung zählt, siehe Spec).

- [ ] **Step 5: Manuell verifizieren (Inline-Modus)**

`index.html?wizardStore=hauptshop&mode=inline` im Browser öffnen, DevTools →
Network-Tab öffnen (Seite frisch laden, nicht nur Tab wechseln).
Expected: genau ein `POST`-Request an `/ping` beim Laden der Seite, keine weiteren beim
Navigieren durch die Wizard-Schritte.

- [ ] **Step 6: `USAGE_PING_URL` zurücksetzen**

`USAGE_PING_URL` in `wizard.js` zurück auf `''` setzen (echte Worker-URL wird erst beim
tatsächlichen Deployment eingetragen, siehe README).

`wrangler dev`-Terminal mit Strg+C beenden.

- [ ] **Step 7: Commit**

```bash
git add wizard.js
git commit -m "feat: Wizard-Oeffnungen an Nutzungs-Tracking-Worker melden"
```

---

### Task 8: README aktualisieren

**Files:**
- Modify: `README.md`

**Interfaces:**
- Keine Code-Schnittstellen — reine Dokumentation.

- [ ] **Step 1: Projektstruktur-Baum erweitern**

Aktueller Text (README.md, Abschnitt "Projektstruktur"):

```
biohairbeauty-produktfinder/
├── produktzuordnung.json          Produktdaten Hauptshop
├── produktzuordnung_member.json   Produktdaten Member-Shop
├── design-tokens.css              Design-Variablen, live aus dem Shop-CSS ausgelesen
├── wizard.js                      gesamte Wizard-Logik (kein Framework, kein Build-Schritt)
├── wizard.css                     Wizard-Styling, importiert design-tokens.css
├── index.html                     lokaler Test-Harness (nicht Teil des Deployments)
├── .env.example                   Vorlage für lokale Build-/Update-Skripte
└── .gitignore                     schließt .env aus
```

Ändern zu:

```
biohairbeauty-produktfinder/
├── produktzuordnung.json          Produktdaten Hauptshop
├── produktzuordnung_member.json   Produktdaten Member-Shop
├── design-tokens.css              Design-Variablen, live aus dem Shop-CSS ausgelesen
├── wizard.js                      gesamte Wizard-Logik (kein Framework, kein Build-Schritt)
├── wizard.css                     Wizard-Styling, importiert design-tokens.css
├── index.html                     lokaler Test-Harness (nicht Teil des Deployments)
├── usage-tracking-worker/         Cloudflare Worker: Nutzungs-Tracking (Schritt 6)
├── .env.example                   Vorlage für lokale Build-/Update-Skripte
└── .gitignore                     schließt .env aus
```

- [ ] **Step 2: Status-Liste ergänzen**

Aktueller Text:

```
- [x] **Schritt 4** — Live-Verfügbarkeitsprüfung & Warenkorb-Integration (Code fertig,
      siehe "Noch zu tun" unten für den ausstehenden Live-Test mit echtem Token)
```

Ändern zu:

```
- [x] **Schritt 4** — Live-Verfügbarkeitsprüfung & Warenkorb-Integration (Code fertig,
      siehe "Noch zu tun" unten für den ausstehenden Live-Test mit echtem Token)
- [x] **Schritt 6** — Tägliches Nutzungs-Tracking pro Shop (Cloudflare Worker + KV +
      Resend, Code fertig, siehe "Manuelle Schritte: Nutzungs-Tracking einrichten" für
      das ausstehende Deployment und "Noch zu tun" für den ausstehenden Live-Test)
```

- [ ] **Step 3: Neuen Abschnitt "Manuelle Schritte: Nutzungs-Tracking einrichten" einfügen**

Direkt nach dem bestehenden Abschnitt "## Manuelle Schritte in Ecwid" (nach dessen Punkt
3 "Vor dem Livegang zusätzlich klären" und dem darauffolgenden Hinweis-Blockquote, vor
"## API-Zugänge") folgenden neuen Abschnitt einfügen:

```markdown
---

## Manuelle Schritte: Nutzungs-Tracking einrichten (Schritt 6)

Der Code für das tägliche Nutzungs-Tracking ist fertig (`usage-tracking-worker/`), das
Deployment erfordert aber echte Cloudflare- und Resend-Accounts — das kannst nur du
selbst einrichten:

1. Cloudflare-Account prüfen/anlegen, Zugriff auf Workers + KV sicherstellen.
2. `wrangler` lokal einrichten: `cd usage-tracking-worker && npm install`, dann
   `npx wrangler login`.
3. KV-Namespace erstellen: `npx wrangler kv namespace create USAGE_KV` — die
   ausgegebene `id` in `usage-tracking-worker/wrangler.toml` anstelle von
   `REPLACE_WITH_KV_NAMESPACE_ID` eintragen.
4. Resend-Account prüfen/anlegen, Absender-Domain verifizieren (SPF/DKIM-Einträge beim
   DNS-Provider der Domain setzen, z. B. für `biohairbeauty.shop`).
5. `REPORT_FROM_EMAIL` in `usage-tracking-worker/wrangler.toml` auf eine Adresse der
   verifizierten Domain setzen (anstelle von `REPLACE_WITH_VERIFIED_SENDER_DOMAIN`).
6. Resend-API-Key erzeugen, als Worker-Secret hinterlegen (nie im Code):
   `cd usage-tracking-worker && npx wrangler secret put RESEND_API_KEY`.
7. Worker deployen: `cd usage-tracking-worker && npx wrangler deploy`. Der Cron
   Trigger (täglich 5:00 UTC) wird dabei automatisch aus `wrangler.toml` aktiviert.
8. Die vom Deployment ausgegebene Worker-URL (z. B.
   `https://biohairbeauty-usage-tracking.<dein-account>.workers.dev`) plus `/ping` in
   `wizard.js` als `USAGE_PING_URL` eintragen und committen.
9. `wizard.js`/`wizard.css` sind bereits über GitHub Pages eingebunden (siehe oben) —
   nach dem Push ist der Ping automatisch live auf beiden Shops.
```

- [ ] **Step 4: "Noch zu tun" ergänzen**

Aktueller Text (letzter Absatz der Datei):

```
- **Echter Warenkorb-Test**: `Ecwid.Cart.addProduct` ist nur auf einer tatsächlichen
  Ecwid-Storefront-Seite verfügbar (`window.Ecwid`-Objekt existiert nicht in `index.html`),
  daher muss der komplette Fluss "Auswahl → In den Warenkorb → Warenkorb prüfen" einmal
  auf einer echten Store-Seite (z. B. über die vorläufig eingetragene JS-/CSS-URL auf
  einer Testseite) durchgeklickt werden.
```

Ändern zu (ergänzt einen neuen Punkt danach):

```
- **Echter Warenkorb-Test**: `Ecwid.Cart.addProduct` ist nur auf einer tatsächlichen
  Ecwid-Storefront-Seite verfügbar (`window.Ecwid`-Objekt existiert nicht in `index.html`),
  daher muss der komplette Fluss "Auswahl → In den Warenkorb → Warenkorb prüfen" einmal
  auf einer echten Store-Seite (z. B. über die vorläufig eingetragene JS-/CSS-URL auf
  einer Testseite) durchgeklickt werden.
- **Nutzungs-Tracking Live-Test**: Nach dem Deployment (siehe "Manuelle Schritte:
  Nutzungs-Tracking einrichten") einmal auf beiden echten Shop-Domains den Wizard öffnen
  und in Cloudflare (`npx wrangler kv key get ... --binding=USAGE_KV`) prüfen, ob der
  Zähler hochgezählt wird. Am Folgetag prüfen, ob die tägliche Bericht-E-Mail bei
  ag@biohairspa.de ankommt (mit den tatsächlichen Zahlen des Vortages).
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: Schritt 6 (Nutzungs-Tracking) in README dokumentieren"
```

---

## Nach Abschluss aller Tasks

Das eigentliche **Deployment** (echter Cloudflare-Account, echter Resend-Account,
Domain-Verifizierung) ist ein manueller Schritt durch den Auftraggeber selbst — siehe
README, Abschnitt "Manuelle Schritte: Nutzungs-Tracking einrichten" (aus Task 8). Das ist
bewusst kein weiterer Code-Task in diesem Plan, da dafür reale externe Accounts benötigt
werden, die kein Subagent anlegen kann (analog zu den bereits bestehenden "Manuellen
Schritten in Ecwid").
