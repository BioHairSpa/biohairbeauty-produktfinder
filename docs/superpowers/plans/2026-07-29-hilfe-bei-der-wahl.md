# "Hilfe bei der Wahl" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pro Wizard-Schritt einen "Hilfe bei der Wahl"-Button mit 3-4 Chips anbieten,
die bei Klick die live von Ecwid abgerufene Produktbeschreibung jedes sichtbaren
Produkts gegen eine Synonym-Liste prüfen und bei genau einem eindeutigen Treffer die
passende Karte hervorheben.

**Architecture:** `fetchLiveInfo`/`resolveProdukt` (bestehender Live-Verfügbarkeits-
Mechanismus) werden um das Feld `beschreibung`/`beschreibungLive` erweitert — bestätigt
per direktem API-Test, dass Ecwids Produktsuche `description` (volles HTML) bereits
liefert, kein zusätzlicher Request nötig. Eine neue zentrale `HILFE_CHIPS`-Konfiguration
(Bereich → Schritt → Chip-Liste) plus reine Text-Matching-Hilfsfunktionen leben auf
Top-Level neben `BEREICH_META`. Die UI (Button, Chip-Reihe, Hinweistext,
Karten-Hervorhebung) wird in `renderSchrittScreen`/`renderProduktCard` innerhalb von
`createWizard` ergänzt, mit Reset der Hilfe-Zustände bei jedem Schrittwechsel.

**Tech Stack:** Unverändert — vollständig client-seitig in `wizard.js`/`wizard.css`,
kein Framework, kein Build-Schritt, keine neuen Abhängigkeiten.

## Global Constraints

- Kein Sprachmodell, keine Fuzzy-Suche — reiner Teilstring-Vergleich nach
  Kleinschreibung und HTML-Tag-Entfernung (Regex, kein `innerHTML`).
- Karten-Hervorhebung ausschließlich auf Basis von **Live**-Beschreibungen — niemals
  Fallback auf die JSON-Snapshot-Beschreibung (`produkt.beschreibung`).
- Genau 1 Treffer → Karte hervorheben (neue Klasse `wizard-produkt-card--empfohlen`,
  optisch unterscheidbar von `wizard-produkt-card--selected`). 0 oder ≥2 Treffer →
  Hinweistext "Keine eindeutige Empfehlung – wähl gern selbst aus", keine Karte
  hervorgehoben. Nicht-empfohlene Karten werden nicht ausgegraut.
- "Hilfe bei der Wahl"-Button deaktiviert, solange der Live-Check für den Schritt nicht
  `status: 'ready'` ist.
- Chip-zu-Synonym-Zuordnung zentral in `HILFE_CHIPS` (wizard.js), pro Bereich mit
  optionalem Schritt-Override — keine separate JSON-Datei.
- Hilfe-Zustand (offener Chip, Ergebnis) wird bei jedem Schrittwechsel zurückgesetzt.

Spec: `docs/superpowers/specs/2026-07-29-hilfe-bei-der-wahl-design.md`

---

### Task 1: Live-Beschreibung mitladen

**Files:**
- Modify: `wizard.js` (`fetchLiveInfo`, `resolveProdukt`, `getResolvedForProdukt`)

**Interfaces:**
- Produces: `fetchLiveInfo(sku)` liefert zusätzlich `beschreibung` im Ergebnisobjekt.
  `resolveProdukt(produkt)` liefert zusätzlich `beschreibungLive` im aufgelösten Objekt.
  `getResolvedForProdukt(...)`'s Fallback-Zweig liefert `beschreibungLive: null`. Ab
  hier von Task 4 (Chip-Matching) genutzt.

Kein automatisierter Test (`wizard.js` hat projektweit keine Testsuite) — Verifikation
über `node --check` + eine direkte API-Prüfung (bereits vorab bestätigt: Ecwids
Produktsuche liefert `description` standardmäßig mit) + einen temporären
Konsolen-Log-Check im Browser.

- [ ] **Step 1: `fetchLiveInfo` um `beschreibung` erweitern**

Aktueller Code (Kommentar direkt vor der Funktion, Zeile ~201-204):

```js
  // Liefert { verfuegbar, ecwidId, imageUrl } oder null (kein Token hinterlegt /
  // Live-Check fehlgeschlagen -> Aufrufer soll dann auf den JSON-Snapshot
  // zurückfallen). imageUrl kommt aus demselben Suchaufruf wie die
  // Verfügbarkeit — kein zusätzlicher Request nötig.
  function fetchLiveInfo(sku) {
```

Ändern zu:

```js
  // Liefert { verfuegbar, ecwidId, imageUrl, beschreibung } oder null (kein Token
  // hinterlegt / Live-Check fehlgeschlagen -> Aufrufer soll dann auf den
  // JSON-Snapshot zurückfallen). imageUrl/beschreibung kommen aus demselben
  // Suchaufruf wie die Verfügbarkeit — kein zusätzlicher Request nötig.
  function fetchLiveInfo(sku) {
```

Aktueller Code (innerhalb `fetchLiveInfo`):

```js
      .then((data) => {
        const item = data.items && data.items[0];
        // Über das öffentliche Token sind nur aktive/sichtbare Produkte
        // erreichbar — eine leere Trefferliste wird daher als "nicht
        // verfügbar" gewertet (deaktivierte oder gelöschte SKU).
        const result = item
          ? {
              verfuegbar: !!item.enabled && (item.unlimited || item.inStock),
              ecwidId: item.id,
              imageUrl: item.imageUrl || null,
            }
          : { verfuegbar: false, ecwidId: null, imageUrl: null };
        writeSessionCache(sku, result);
        return result;
      })
```

Ändern zu:

```js
      .then((data) => {
        const item = data.items && data.items[0];
        // Über das öffentliche Token sind nur aktive/sichtbare Produkte
        // erreichbar — eine leere Trefferliste wird daher als "nicht
        // verfügbar" gewertet (deaktivierte oder gelöschte SKU).
        const result = item
          ? {
              verfuegbar: !!item.enabled && (item.unlimited || item.inStock),
              ecwidId: item.id,
              imageUrl: item.imageUrl || null,
              beschreibung: item.description || null,
            }
          : { verfuegbar: false, ecwidId: null, imageUrl: null, beschreibung: null };
        writeSessionCache(sku, result);
        return result;
      })
```

- [ ] **Step 2: `resolveProdukt` um `beschreibungLive` erweitern**

Aktueller Code:

```js
  function resolveProdukt(produkt) {
    const kandidaten =
      produkt.groessenvarianten && produkt.groessenvarianten.length
        ? produkt.groessenvarianten
        : [produkt];

    return Promise.all(
      kandidaten.map((kandidat) => fetchLiveInfo(kandidat.sku).then((liveInfo) => ({ kandidat, liveInfo })))
    ).then((ergebnisse) => {
      const konnteLiveGeprueftWerden = ergebnisse.some((e) => e.liveInfo !== null);

      if (!konnteLiveGeprueftWerden) {
        // Kein Token hinterlegt oder alle Anfragen fehlgeschlagen -> stiller
        // Fallback auf den JSON-Snapshot, keine blockierende Fehlermeldung.
        return {
          produkt: produkt,
          ecwidId: null,
          istVerfuegbar: produkt.verfuegbar,
          liveGeprueft: false,
          bildUrl: produkt.bild_url,
        };
      }

      const verfuegbarerKandidat = ergebnisse.find((e) => e.liveInfo && e.liveInfo.verfuegbar);
      if (verfuegbarerKandidat) {
        return {
          produkt: verfuegbarerKandidat.kandidat,
          ecwidId: verfuegbarerKandidat.liveInfo.ecwidId,
          istVerfuegbar: true,
          liveGeprueft: true,
          bildUrl: verfuegbarerKandidat.liveInfo.imageUrl || verfuegbarerKandidat.kandidat.bild_url,
        };
      }

      return {
        produkt: produkt,
        ecwidId: null,
        istVerfuegbar: false,
        liveGeprueft: true,
        bildUrl: produkt.bild_url,
      };
    });
  }
```

Ändern zu (drei Return-Stellen jeweils um `beschreibungLive` ergänzt):

```js
  function resolveProdukt(produkt) {
    const kandidaten =
      produkt.groessenvarianten && produkt.groessenvarianten.length
        ? produkt.groessenvarianten
        : [produkt];

    return Promise.all(
      kandidaten.map((kandidat) => fetchLiveInfo(kandidat.sku).then((liveInfo) => ({ kandidat, liveInfo })))
    ).then((ergebnisse) => {
      const konnteLiveGeprueftWerden = ergebnisse.some((e) => e.liveInfo !== null);

      if (!konnteLiveGeprueftWerden) {
        // Kein Token hinterlegt oder alle Anfragen fehlgeschlagen -> stiller
        // Fallback auf den JSON-Snapshot, keine blockierende Fehlermeldung.
        // beschreibungLive bleibt null - "Hilfe bei der Wahl" nutzt niemals den
        // JSON-Snapshot als Ersatz fuer die Live-Beschreibung.
        return {
          produkt: produkt,
          ecwidId: null,
          istVerfuegbar: produkt.verfuegbar,
          liveGeprueft: false,
          bildUrl: produkt.bild_url,
          beschreibungLive: null,
        };
      }

      const verfuegbarerKandidat = ergebnisse.find((e) => e.liveInfo && e.liveInfo.verfuegbar);
      if (verfuegbarerKandidat) {
        return {
          produkt: verfuegbarerKandidat.kandidat,
          ecwidId: verfuegbarerKandidat.liveInfo.ecwidId,
          istVerfuegbar: true,
          liveGeprueft: true,
          bildUrl: verfuegbarerKandidat.liveInfo.imageUrl || verfuegbarerKandidat.kandidat.bild_url,
          beschreibungLive: verfuegbarerKandidat.liveInfo.beschreibung,
        };
      }

      return {
        produkt: produkt,
        ecwidId: null,
        istVerfuegbar: false,
        liveGeprueft: true,
        bildUrl: produkt.bild_url,
        beschreibungLive: null,
      };
    });
  }
```

- [ ] **Step 3: `getResolvedForProdukt`-Fallback um `beschreibungLive: null` erweitern**

Aktueller Code:

```js
    function getResolvedForProdukt(liveEntry, produkt, index) {
      if (liveEntry && liveEntry.status === 'ready' && liveEntry.results[index]) {
        return liveEntry.results[index];
      }
      return {
        produkt: produkt,
        ecwidId: null,
        istVerfuegbar: produkt.verfuegbar,
        liveGeprueft: false,
        bildUrl: produkt.bild_url,
      };
    }
```

Ändern zu:

```js
    function getResolvedForProdukt(liveEntry, produkt, index) {
      if (liveEntry && liveEntry.status === 'ready' && liveEntry.results[index]) {
        return liveEntry.results[index];
      }
      return {
        produkt: produkt,
        ecwidId: null,
        istVerfuegbar: produkt.verfuegbar,
        liveGeprueft: false,
        bildUrl: produkt.bild_url,
        beschreibungLive: null,
      };
    }
```

- [ ] **Step 4: Syntax-Check**

Run: `node --check wizard.js`
Expected: kein Output (Exit-Code 0).

- [ ] **Step 5: Manuelle Verifikation der Live-Beschreibung**

`index.html?wizardStore=hauptshop` lokal im Browser öffnen, zu einem beliebigen Schritt
navigieren. Temporär in `renderSchrittScreen` (nach der `ensureLiveInfoForStep`-Zeile,
innerhalb des `if (liveEntry && liveEntry.status === 'ready')`-Codepfads — z. B. direkt
nach der Berechnung von `verfuegbareResolved`) folgende Zeile einfügen:

```js
console.log('[TEMP-VERIFY] beschreibungLive:', verfuegbareResolved[0] && verfuegbareResolved[0].beschreibungLive);
```

Browser-Konsole öffnen, Schritt neu laden, prüfen, dass eine echte HTML-Beschreibung
(nicht `null`, nicht `undefined`) ausgegeben wird. Danach die temporäre Zeile wieder
entfernen — sie darf nicht Teil des Commits sein.

- [ ] **Step 6: Commit**

```bash
git add wizard.js
git commit -m "feat: Live-Produktbeschreibung fuer Hilfe-bei-der-Wahl mitladen"
```

---

### Task 2: `HILFE_CHIPS`-Konfiguration + Text-Matching-Hilfsfunktionen

**Files:**
- Modify: `wizard.js` (neuer Abschnitt auf Top-Level, neben `BEREICH_META`)

**Interfaces:**
- Produces: `getHilfeChips(bereich, schrittNummer): Array<{label, synonyme}>`,
  `chipHatTreffer(chip, beschreibungLive): boolean` — ab hier von Task 4 (UI/Klick-Handler)
  genutzt.

Kein automatisierter Test — Verifikation über `node --check` + einen isolierten
Kurz-Check der Matching-Logik via `node -e` (siehe Step 3) vor der Integration in die UI.

- [ ] **Step 1: `HILFE_CHIPS` und `getHilfeChips` einfügen**

Direkt nach dem bestehenden `BEREICH_META`-Block (vor der Zeile
`const preisFormatter = new Intl.NumberFormat(...)`) folgenden Block einfügen:

```js
  // ---------------------------------------------------------------------
  // "Hilfe bei der Wahl" — Chip-zu-Synonym-Zuordnung pro Bereich/Schritt.
  // Synonyme bereits kleingeschrieben hinterlegt (nur der zu pruefende
  // Beschreibungstext wird zur Laufzeit normalisiert). Trefferqualitaet
  // haengt von den echten Live-Beschreibungstexten in Ecwid ab - diese
  // Konfiguration ist bewusst zentral und leicht nachjustierbar.
  // ---------------------------------------------------------------------

  const HILFE_CHIPS = {
    gesicht: {
      steps: {
        1: [
          { label: 'Unreine Haut/Akne', synonyme: ['akne', 'unrein', 'mitesser', 'pore'] },
          { label: 'Fettige Haut', synonyme: ['fettig', 'öl'] },
          { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
          { label: 'Empfindliche Haut', synonyme: ['empfindlich', 'sensib', 'entzünd', 'ekzem', 'psoriasis', 'irritiert'] },
        ],
        2: [
          { label: 'Unreine Haut/Akne', synonyme: ['akne', 'unrein', 'mitesser', 'pore'] },
          { label: 'Falten/reife Haut', synonyme: ['falten', 'straff', 'elastizität', 'kollagen', 'reif', 'anti-aging'] },
          { label: 'Pigmentflecken', synonyme: ['pigment', 'fleck'] },
          { label: 'Narbenpflege', synonyme: ['narbe'] },
        ],
        3: [
          { label: 'Mischhaut', synonyme: ['mischhaut'] },
          { label: 'Rötungen/Couperose', synonyme: ['rötung', 'couperose', 'rosacea'] },
          { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
          { label: 'Empfindliche Haut', synonyme: ['empfindlich', 'sensib', 'entzünd', 'ekzem', 'psoriasis', 'irritiert'] },
        ],
        4: [
          { label: 'Falten/reife Haut', synonyme: ['falten', 'straff', 'elastizität', 'kollagen', 'reif', 'anti-aging'] },
          { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
          { label: 'Pigmentflecken', synonyme: ['pigment', 'fleck'] },
          { label: 'Rötungen/Couperose', synonyme: ['rötung', 'couperose', 'rosacea'] },
        ],
        5: [
          { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
          { label: 'Falten/reife Haut', synonyme: ['falten', 'straff', 'elastizität', 'kollagen', 'reif', 'anti-aging'] },
          { label: 'Empfindliche Haut', synonyme: ['empfindlich', 'sensib', 'entzünd', 'ekzem', 'psoriasis', 'irritiert'] },
          { label: 'Fettige Haut', synonyme: ['fettig', 'öl'] },
        ],
      },
    },
    haare: {
      steps: {
        1: [
          { label: 'Schuppen & Kopfhautpeeling', synonyme: ['schuppen', 'psoriasis', 'seborrh', 'peeling'] },
          { label: 'Fettige Kopfhaut/Haare', synonyme: ['fettig', 'öl', 'talg'] },
          { label: 'Trockene Kopfhaut', synonyme: ['trocken', 'dehydriert'] },
          { label: 'Empfindliche Kopfhaut', synonyme: ['empfindlich', 'sensibel', 'entzünd', 'ekzem', 'reizung', 'juckreiz', 'rötung', 'gerötet'] },
        ],
        2: [
          { label: 'Schuppen', synonyme: ['schuppen', 'psoriasis', 'seborrh'] },
          { label: 'Fettige Kopfhaut/Haare', synonyme: ['fettig', 'öl', 'talg'] },
          { label: 'Empfindliche Kopfhaut & häufiges Waschen', synonyme: ['trocken', 'empfindlich', 'sensibel', 'entzünd', 'ekzem', 'reizung', 'häufig', 'täglich'] },
          { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
        ],
        3: [
          { label: 'Juckreiz & Schuppen', synonyme: ['juckreiz', 'schuppen', 'psoriasis', 'seborrh'] },
          { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
          { label: 'Trockenes Haar & Spliss', synonyme: ['trocken', 'strapaziert', 'brüchig', 'spliss'] },
          { label: 'Glanz & Kräftigung', synonyme: ['glanz', 'geschmeidig', 'entwirr', 'stärk', 'kräftig'] },
        ],
        4: [
          { label: 'Beruhigung Kopfhaut', synonyme: ['beruhig', 'juckreiz', 'lindert', 'entzünd', 'reizung'] },
          { label: 'Schutz vor Umwelteinflüssen', synonyme: ['schutz', 'umwelt', 'uv'] },
          { label: 'Kräftigung & Glanz', synonyme: ['kräftig', 'stärk', 'glanz'] },
          { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
        ],
        5: [
          { label: 'Lockiges Haar & Frizz', synonyme: ['lockig', 'kraus', 'wellig', 'frizz', 'anti-frizz'] },
          { label: 'Glanz & Geschmeidigkeit', synonyme: ['glanz', 'geschmeidig'] },
          { label: 'Reparatur & Spliss', synonyme: ['reparatur', 'brüchig', 'entwirr', 'spliss'] },
          { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
        ],
        6: [
          { label: 'Haarausfall', synonyme: ['ausfall', 'ausfallphase'] },
          { label: 'Haarwachstum', synonyme: ['wachstum', 'wachstumsphase'] },
          { label: 'Dünner werdendes Haar', synonyme: ['dünn', 'volumen'] },
          { label: 'Haarzwiebeln stärken', synonyme: ['haarzwiebel', 'follikel'] },
        ],
      },
    },
  };

  function getHilfeChips(bereich, schrittNummer) {
    const eintrag = HILFE_CHIPS[bereich];
    if (!eintrag) return [];
    return (eintrag.steps && eintrag.steps[schrittNummer]) || eintrag.default || [];
  }
```

- [ ] **Step 2: Text-Matching-Hilfsfunktionen einfügen**

Direkt nach dem `getHilfeChips`-Block einfügen:

```js
  function stripHtml(html) {
    return (html || '').replace(/<[^>]*>/g, ' ');
  }

  function normalisiereBeschreibung(html) {
    return stripHtml(html).toLowerCase();
  }

  function chipHatTreffer(chip, beschreibungLive) {
    const normalisiert = normalisiereBeschreibung(beschreibungLive);
    return chip.synonyme.some((synonym) => normalisiert.indexOf(synonym) !== -1);
  }
```

- [ ] **Step 3: Syntax-Check + isolierter Matching-Test**

Run: `node --check wizard.js`
Expected: kein Output (Exit-Code 0).

Run (isolierter Kurz-Check der Matching-Logik, ohne Browser — bewusst ein Wegwerf-Skript,
keine dauerhafte Testdatei):

```bash
node -e "
function stripHtml(html) { return (html || '').replace(/<[^>]*>/g, ' '); }
function normalisiereBeschreibung(html) { return stripHtml(html).toLowerCase(); }
function chipHatTreffer(chip, beschreibungLive) {
  const normalisiert = normalisiereBeschreibung(beschreibungLive);
  return chip.synonyme.some((s) => normalisiert.indexOf(s) !== -1);
}
const chip = { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] };
console.log('erwartet true:', chipHatTreffer(chip, '<p>Spendet <b>Feuchtigkeit</b></p>'));
console.log('erwartet false:', chipHatTreffer(chip, '<p>Für fettige Haut</p>'));
console.log('erwartet true (Tabellen-HTML):', chipHatTreffer(chip, '<table><tr><td>trocken</td></tr></table>'));
"
```
Expected: `erwartet true: true`, `erwartet false: false`, `erwartet true (Tabellen-HTML): true`.

- [ ] **Step 4: Commit**

```bash
git add wizard.js
git commit -m "feat: HILFE_CHIPS-Konfiguration und Text-Matching-Hilfsfunktionen"
```

---

### Task 3: Wizard-State erweitern + Reset-Logik

**Files:**
- Modify: `wizard.js` (State-Objekt in `createWizard`, Anfang von `renderSchrittScreen`)

**Interfaces:**
- Produces: `state.hilfeOffen`, `state.hilfeAktiverChip`, `state.hilfeErgebnisSku`,
  `state.hilfeKeineEindeutigeEmpfehlung`, `state.hilfeSchrittNummer` — ab hier von Task 4
  gelesen/geschrieben.

- [ ] **Step 1: Neue State-Felder ergänzen**

Aktueller Code:

```js
    let state = {
      screen: 'bereich', // bereich | typ | schritt | zusammenfassung
      bereich: null,
      typKey: null,
      currentStepIndex: 0,
      stepDirection: 'forward', // 'forward' | 'backward' — steuert die Richtung, in der
      // automatisch komplett nicht verfügbare Schritte übersprungen werden
      selections: {}, // { [schrittNummer]: { sku, produkt, ecwidId } }
      cartAdded: {}, // { [sku]: true }
      cartErrors: {}, // { [sku]: Fehlermeldung }
      liveByStep: {}, // { [schrittNummer]: { status: 'loading' | 'ready', results } }
    };
```

Ändern zu:

```js
    let state = {
      screen: 'bereich', // bereich | typ | schritt | zusammenfassung
      bereich: null,
      typKey: null,
      currentStepIndex: 0,
      stepDirection: 'forward', // 'forward' | 'backward' — steuert die Richtung, in der
      // automatisch komplett nicht verfügbare Schritte übersprungen werden
      selections: {}, // { [schrittNummer]: { sku, produkt, ecwidId } }
      cartAdded: {}, // { [sku]: true }
      cartErrors: {}, // { [sku]: Fehlermeldung }
      liveByStep: {}, // { [schrittNummer]: { status: 'loading' | 'ready', results } }
      hilfeOffen: false, // Chip-Reihe für "Hilfe bei der Wahl" sichtbar?
      hilfeAktiverChip: null, // Label des aktuell aktiven Chips oder null
      hilfeErgebnisSku: null, // SKU der hervorgehobenen Karte (nur bei eindeutigem Treffer)
      hilfeKeineEindeutigeEmpfehlung: false,
      hilfeSchrittNummer: null, // zuletzt gerenderte Schritt-Nummer, fuer Reset-Erkennung
    };
```

- [ ] **Step 2: Reset-Logik am Anfang von `renderSchrittScreen` einfügen**

Aktueller Code (Anfang der Funktion):

```js
    function renderSchrittScreen() {
      const schritte = getSchritte(data, state.bereich);
      const idx = state.currentStepIndex;
      const schritt = schritte[idx];
      const isLastStep = idx === schritte.length - 1;
      const produkte = getProdukte(data, state.bereich, state.typKey, schritt.nummer);
```

Ändern zu:

```js
    function renderSchrittScreen() {
      const schritte = getSchritte(data, state.bereich);
      const idx = state.currentStepIndex;
      const schritt = schritte[idx];

      // Schrittwechsel erkannt (Navigation vor/zurück, Bereichswechsel) -> Hilfe-
      // Zustand zurücksetzen. Gleiches Idiom wie der bestehende Auto-Skip leerer
      // Schritte weiter unten: State ändern + return, kein Render in diesem Aufruf.
      if (state.hilfeSchrittNummer !== schritt.nummer) {
        update({ hilfeSchrittNummer: schritt.nummer, hilfeOffen: false, hilfeAktiverChip: null });
        return;
      }

      const isLastStep = idx === schritte.length - 1;
      const produkte = getProdukte(data, state.bereich, state.typKey, schritt.nummer);
```

- [ ] **Step 3: Syntax-Check**

Run: `node --check wizard.js`
Expected: kein Output (Exit-Code 0).

- [ ] **Step 4: Manuelle Regressionsprüfung**

`index.html?wizardStore=hauptshop` lokal öffnen, einmal komplett durch einen
Gesichts-Durchlauf klicken (Bereich → Hauttyp → alle 5 Schritte → Zusammenfassung) und
zurücknavigieren. Erwartet: Verhalten unverändert zu vorher (Fortschritt, Auswahl,
Zurück-Navigation funktionieren wie bisher) — die neue Reset-Logik darf keine
Endlosschleife oder ein Hängenbleiben verursachen (da `update()` bei jedem
Schrittwechsel einmal zusätzlich aufgerufen wird, aber `hilfeSchrittNummer` danach mit
`schritt.nummer` übereinstimmt und der zweite Render-Durchlauf normal weiterläuft).

- [ ] **Step 5: Commit**

```bash
git add wizard.js
git commit -m "feat: Wizard-State fuer Hilfe-bei-der-Wahl ergaenzen (Reset bei Schrittwechsel)"
```

---

### Task 4: UI — Button, Chip-Reihe, Klick-Handler, Hinweistext

**Files:**
- Modify: `wizard.js` (neue Funktionen innerhalb `createWizard`, Einbindung in
  `renderSchrittScreen`)

**Interfaces:**
- Consumes: `getHilfeChips`, `chipHatTreffer` (Task 2), `state.hilfe*`-Felder (Task 3).
- Produces: `renderHilfeBereich(schritt, verfuegbareResolved, liveEntry)`,
  `handleHilfeChipClick(chip, verfuegbareResolved)` — von Task 5 (Karten-Hervorhebung)
  gelesen (`state.hilfeAktiverChip`, `state.hilfeErgebnisSku`).

- [ ] **Step 1: `handleHilfeChipClick` und `renderHilfeBereich` einfügen**

Direkt vor `function renderSchrittScreen() {` folgenden Block einfügen:

```js
    function handleHilfeChipClick(chip, verfuegbareResolved) {
      if (state.hilfeAktiverChip === chip.label) {
        update({ hilfeAktiverChip: null });
        return;
      }
      const treffer = verfuegbareResolved.filter((resolved) =>
        chipHatTreffer(chip, resolved.beschreibungLive)
      );
      update({
        hilfeAktiverChip: chip.label,
        hilfeErgebnisSku: treffer.length === 1 ? treffer[0].produkt.sku : null,
        hilfeKeineEindeutigeEmpfehlung: treffer.length !== 1,
      });
    }

    function renderHilfeBereich(schritt, verfuegbareResolved, liveEntry) {
      const wrapper = el('div', { className: 'wizard-hilfe-bereich' });
      const liveBereit = !!liveEntry && liveEntry.status === 'ready';

      wrapper.appendChild(
        el('button', {
          className: 'wizard-button-secondary wizard-hilfe-button',
          attrs: { type: 'button', disabled: liveBereit ? null : 'disabled' },
          text: 'Hilfe bei der Wahl',
          onClick: () => update({ hilfeOffen: !state.hilfeOffen }),
        })
      );

      if (state.hilfeOffen) {
        const chips = getHilfeChips(state.bereich, schritt.nummer);
        const chipRow = el('div', { className: 'wizard-hilfe-chips' });
        chips.forEach((chip) => {
          const istAktiv = state.hilfeAktiverChip === chip.label;
          chipRow.appendChild(
            el('button', {
              className: 'wizard-hilfe-chip' + (istAktiv ? ' wizard-hilfe-chip--aktiv' : ''),
              attrs: { type: 'button' },
              text: chip.label,
              onClick: () => handleHilfeChipClick(chip, verfuegbareResolved),
            })
          );
        });
        wrapper.appendChild(chipRow);

        if (state.hilfeAktiverChip && state.hilfeKeineEindeutigeEmpfehlung) {
          wrapper.appendChild(
            el('div', {
              className: 'wizard-hilfe-hinweis',
              text: 'Keine eindeutige Empfehlung – wähl gern selbst aus',
            })
          );
        }
      }

      return wrapper;
    }

```

- [ ] **Step 2: `renderHilfeBereich` zwischen Überschrift und Produkt-Grid einbinden**

Aktueller Code (in `renderSchrittScreen`, nach der Überschrift):

```js
      container.appendChild(renderProgress(schritte, idx));
      container.appendChild(
        el('h2', { text: 'Schritt ' + (idx + 1) + ' von ' + schritte.length + ': ' + schritt.titel })
      );

      const grid = el('div', { className: 'wizard-produkt-grid' });
```

Ändern zu:

```js
      container.appendChild(renderProgress(schritte, idx));
      container.appendChild(
        el('h2', { text: 'Schritt ' + (idx + 1) + ' von ' + schritte.length + ': ' + schritt.titel })
      );
      container.appendChild(renderHilfeBereich(schritt, verfuegbareResolved, liveEntry));

      const grid = el('div', { className: 'wizard-produkt-grid' });
```

- [ ] **Step 3: Syntax-Check**

Run: `node --check wizard.js`
Expected: kein Output (Exit-Code 0).

- [ ] **Step 4: Manuelle Verifikation (ohne Hervorhebung — die kommt in Task 5)**

`index.html?wizardStore=hauptshop` lokal öffnen, zu Schritt 1 (Gesicht, Reinigen)
navigieren, warten bis Live-Check fertig ist (Button wird klickbar), auf "Hilfe bei der
Wahl" klicken → 4 Chips erscheinen. Auf einen Chip klicken → kein Fehler in der
Konsole (Hervorhebung fehlt noch, das ist erwartet). Erneuter Klick auf denselben Chip
→ Chip-Reihe/Zustand wird zurückgesetzt (kein sichtbarer Unterschied vor Task 5, aber
`state.hilfeAktiverChip` sollte laut kurzem temporären `console.log` wieder `null`
sein — danach entfernen).

- [ ] **Step 5: Commit**

```bash
git add wizard.js
git commit -m "feat: Hilfe-bei-der-Wahl UI (Button, Chips, Klick-Handler, Hinweistext)"
```

---

### Task 5: Karten-Hervorhebung + CSS + vollständige lokale Verifikation

**Files:**
- Modify: `wizard.js` (`renderProduktCard`)
- Modify: `wizard.css` (neue Klassen)

**Interfaces:**
- Consumes: `state.hilfeAktiverChip`, `state.hilfeErgebnisSku` (Task 3/4).

- [ ] **Step 1: Hervorhebungs-Klasse in `renderProduktCard` einfügen**

Aktueller Code:

```js
      const card = el('div', {
        className: 'wizard-produkt-card' + (isSelected ? ' wizard-produkt-card--selected' : ''),
      });
```

Ändern zu:

```js
      const istEmpfohlen =
        !!state.hilfeAktiverChip && state.hilfeErgebnisSku === angezeigtesProdukt.sku;

      const card = el('div', {
        className:
          'wizard-produkt-card' +
          (isSelected ? ' wizard-produkt-card--selected' : '') +
          (istEmpfohlen ? ' wizard-produkt-card--empfohlen' : ''),
      });
```

- [ ] **Step 2: CSS-Klassen ergänzen**

In `wizard.css`, nach dem bestehenden Block `.wizard-cart-error { ... }` (vor dem
Kommentar `/* --------------------------------------------------------------------- \n
   Navigation / Zusammenfassung \n--------------------------------------------------------------------- */`)
folgenden Block einfügen:

```css
/* ---------------------------------------------------------------------
   Hilfe bei der Wahl (Chip-basierte Produktempfehlung pro Schritt)
--------------------------------------------------------------------- */

.wizard-hilfe-bereich {
  margin-bottom: var(--wizard-spacing-sm);
}

.wizard-hilfe-button {
  margin-bottom: var(--wizard-spacing-sm);
}

.wizard-hilfe-button:disabled {
  opacity: 0.5;
  cursor: default;
  text-decoration: none;
}

.wizard-hilfe-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: var(--wizard-spacing-sm);
}

.wizard-hilfe-chip {
  background: var(--wizard-color-weiss);
  color: var(--wizard-color-fast-schwarz);
  font-family: var(--wizard-font-body);
  border: 1px solid var(--wizard-color-grau);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.wizard-hilfe-chip--aktiv {
  border-color: var(--wizard-akzent, var(--wizard-color-fast-schwarz));
  font-weight: 600;
}

.wizard-hilfe-hinweis {
  font-size: 13px;
  color: var(--wizard-color-grau);
  margin-bottom: var(--wizard-spacing-sm);
}

.wizard-produkt-card--empfohlen {
  border: 2px dashed var(--wizard-color-gold-akzent);
  box-shadow: 0 0 0 1px var(--wizard-color-gold-akzent);
}
```

- [ ] **Step 3: Syntax-Check**

Run: `node --check wizard.js`
Expected: kein Output (Exit-Code 0).

- [ ] **Step 4: Vollständige lokale End-to-End-Verifikation**

`index.html?wizardStore=hauptshop` lokal öffnen (kein Cloudflare-Worker, kein
Deployment nötig — die Ecwid-Live-API akzeptiert Anfragen unabhängig vom aufrufenden
Origin, wie beim bestehenden Live-Verfügbarkeitscheck bereits genutzt):

1. Gesicht → Trockene Haut (oder beliebiger Hauttyp mit mehreren Produkten pro
   Schritt, z. B. laut Datenlage "Trockene Haut" bei Schritt 2 mit 5 Produkten) →
   Schritt 2 (Behandeln). Warten bis Button aktiv wird. Klick auf "Hilfe bei der Wahl"
   → 4 Chips sichtbar. Auf einen Chip klicken, dessen Synonyme plausibel zu einem der
   sichtbaren Produkte passen (per Live-Beschreibung, ggf. mehrere Chips ausprobieren):
   Erwartet entweder eine hervorgehobene Karte (gestrichelter goldener Rahmen,
   deutlich von einer ausgewählten Karte unterscheidbar) oder den Hinweistext.
2. Denselben Chip erneut klicken → Hervorhebung/Hinweis verschwindet.
3. Zu einem anderen Schritt navigieren und zurück → Chip-Reihe ist geschlossen,
   keine Hervorhebung mehr aktiv (Reset bestätigt).
4. Bereich wechseln zu Haare → Schritt 3 (Masken/Conditioner, hat "Coloriertes Haar"
   als einen von 4 Chips) → Klickdurchlauf wiederholen.
5. Browser-Konsole während des gesamten Durchlaufs im Blick behalten — keine Fehler.

Falls die Trefferquote in der Praxis sehr niedrig ausfällt (häufig "keine eindeutige
Empfehlung"): das ist kein Implementierungsfehler, sondern ein Hinweis, dass die
Synonym-Listen in `HILFE_CHIPS` nach diesem Test nachjustiert werden sollten (siehe
Spec, Abschnitt "Nicht Teil dieser Erweiterung") — in diesem Fall dem Nutzer melden,
nicht eigenmächtig die Konfiguration verändern.

- [ ] **Step 5: Commit**

```bash
git add wizard.js wizard.css
git commit -m "feat: Karten-Hervorhebung fuer Hilfe-bei-der-Wahl (CSS + Verdrahtung)"
```

---

## Nach Abschluss aller Tasks

Kein Deployment nötig — die Funktion ist rein client-seitig und wird automatisch über
GitHub Pages ausgeliefert, sobald `wizard.js`/`wizard.css` gepusht sind (siehe README,
Abschnitt "Deployment"). Ein Live-Test auf einer echten Shop-Seite (nicht nur lokal via
`index.html`) ist trotzdem sinnvoll, um reale Ecwid-Beschreibungstexte über den
tatsächlichen Produktkatalog hinweg zu prüfen — das kann nach dem Merge gemeinsam mit
dem Nutzer erfolgen.
