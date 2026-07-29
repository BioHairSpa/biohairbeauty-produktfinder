# "Hilfe bei der Wahl" — Chip-basierte Produktempfehlung pro Schritt

## Ziel

Auf jedem Wizard-Schritt (Gesicht: 5 Schritte, Haare: 6 Schritte) einen Button "Hilfe
bei der Wahl" anbieten, der 3-4 vordefinierte Chips zu typischen Haut-/Haaranliegen
einblendet. Klick auf einen Chip prüft die **aktuelle, live von Ecwid abgerufene**
Produktbeschreibung jedes im Schritt sichtbaren Produkts gegen eine Synonym-Liste und
hebt bei genau einem eindeutigen Treffer die passende Produktkarte hervor. Kein
Sprachmodell, kein Cloudflare-Worker, keine neuen Secrets — rein client-seitig in
`wizard.js`, ergänzt um ein zusätzliches Feld im bereits bestehenden Live-API-Aufruf.

## Architektur

```
Button "Hilfe bei der Wahl" (pro Schritt, deaktiviert bis Live-Check fertig)
        │
Chip-Reihe einblenden (aus zentraler HILFE_CHIPS-Konfiguration,
Bereichs-Fallback → Schritt-Override)
        │
Klick auf Chip
        │
Bereits laufender/gecachter Live-Abruf pro Produkt (fetchLiveInfo/resolveProdukt,
derselbe Mechanismus wie für Bild/Verfügbarkeit) — jetzt zusätzlich mit Beschreibung
        │
Text normalisieren (HTML-Tags per Regex entfernen, Kleinschreibung) und gegen
Synonym-Liste des Chips prüfen (einfache Teilstring-Suche)
        │
genau 1 Treffer → Karte hervorheben  |  0 oder mehrere Treffer → Hinweistext
```

**Kein zusätzlicher Live-Request nötig:** `fetchLiveInfo()` (bestehend, 10-Minuten-Cache
in `sessionStorage` + In-Memory) wird um das Feld `beschreibung` aus der
Ecwid-Antwort (`item.description`) erweitert. Da `ensureLiveInfoForStep()` diese Daten
bereits beim Anzeigen des Schritts lädt, liest ein Chip-Klick nur bereits vorhandene
(oder noch ladende) Daten — kein zweiter Request. Solange der Live-Check für den
Schritt nicht `status: 'ready'` ist, bleibt der Button deaktiviert; es gibt **keinen
Fallback auf die JSON-Snapshot-Beschreibung** (wie gefordert — die Karten-Hervorhebung
basiert ausschließlich auf Live-Daten).

## 1. Datenfluss: Live-Beschreibung mitladen

- `fetchLiveInfo(sku)` (`wizard.js`, aktuell liefert `{verfuegbar, ecwidId, imageUrl}`):
  Rückgabe um `beschreibung: item.description || null` erweitern. Kein neuer Request,
  keine neue Query-Parameter — das Feld ist Teil der ohnehin abgerufenen Ecwid-Antwort.
- `resolveProdukt(produkt)`: das für die gewählte Variante zurückgegebene Objekt
  (aktuell `{produkt, ecwidId, istVerfuegbar, liveGeprueft, bildUrl}`) bekommt zusätzlich
  `beschreibungLive`. Fällt der Live-Check komplett aus (kein Token, Netzwerkfehler),
  bleibt `beschreibungLive: null` — die Chips sind dann deaktiviert (siehe oben), nicht
  fehlerhaft aktiv mit leerem Text.
- `getResolvedForProdukt()` (Fallback-Zweig vor Live-Ready): `beschreibungLive: null`
  explizit setzen — niemals `produkt.beschreibung` (JSON-Snapshot) als Ersatz nutzen.

## 2. Zentrale Chip-Konfiguration

Neue Konstante `HILFE_CHIPS`, platziert bei `BEREICH_META` (gleicher Abschnitt,
gleiche Bereichs-Struktur):

```js
const HILFE_CHIPS = {
  gesicht: {
    steps: {
      1: [ /* Reinigen */
        { label: 'Unreine Haut/Akne', synonyme: ['akne', 'unrein', 'mitesser', 'pore'] },
        { label: 'Fettige Haut', synonyme: ['fettig', 'öl'] },
        { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
        { label: 'Empfindliche Haut', synonyme: ['empfindlich', 'sensib', 'entzünd', 'ekzem', 'psoriasis', 'irritiert'] },
      ],
      2: [ /* Behandeln */
        { label: 'Unreine Haut/Akne', synonyme: ['akne', 'unrein', 'mitesser', 'pore'] },
        { label: 'Falten/reife Haut', synonyme: ['falten', 'straff', 'elastizität', 'kollagen', 'reif', 'anti-aging'] },
        { label: 'Pigmentflecken', synonyme: ['pigment', 'fleck'] },
        { label: 'Narbenpflege', synonyme: ['narbe'] },
      ],
      3: [ /* Tonern und Mineralisieren */
        { label: 'Mischhaut', synonyme: ['mischhaut'] },
        { label: 'Rötungen/Couperose', synonyme: ['rötung', 'couperose', 'rosacea'] },
        { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
        { label: 'Empfindliche Haut', synonyme: ['empfindlich', 'sensib', 'entzünd', 'ekzem', 'psoriasis', 'irritiert'] },
      ],
      4: [ /* Serie e Booster */
        { label: 'Falten/reife Haut', synonyme: ['falten', 'straff', 'elastizität', 'kollagen', 'reif', 'anti-aging'] },
        { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
        { label: 'Pigmentflecken', synonyme: ['pigment', 'fleck'] },
        { label: 'Rötungen/Couperose', synonyme: ['rötung', 'couperose', 'rosacea'] },
      ],
      5: [ /* Creme */
        { label: 'Trockene Haut', synonyme: ['trocken', 'dehydriert', 'feuchtigkeit'] },
        { label: 'Falten/reife Haut', synonyme: ['falten', 'straff', 'elastizität', 'kollagen', 'reif', 'anti-aging'] },
        { label: 'Empfindliche Haut', synonyme: ['empfindlich', 'sensib', 'entzünd', 'ekzem', 'psoriasis', 'irritiert'] },
        { label: 'Fettige Haut', synonyme: ['fettig', 'öl'] },
      ],
    },
  },
  haare: {
    steps: {
      1: [ /* Pre-Shampoo restrukturierend/aufbauend */
        { label: 'Schuppen & Kopfhautpeeling', synonyme: ['schuppen', 'psoriasis', 'seborrh', 'peeling'] },
        { label: 'Fettige Kopfhaut/Haare', synonyme: ['fettig', 'öl', 'talg'] },
        { label: 'Trockene Kopfhaut', synonyme: ['trocken', 'dehydriert'] },
        { label: 'Empfindliche Kopfhaut', synonyme: ['empfindlich', 'sensibel', 'entzünd', 'ekzem', 'reizung', 'juckreiz', 'rötung', 'gerötet'] },
      ],
      2: [ /* Shampoo */
        { label: 'Schuppen', synonyme: ['schuppen', 'psoriasis', 'seborrh'] },
        { label: 'Fettige Kopfhaut/Haare', synonyme: ['fettig', 'öl', 'talg'] },
        { label: 'Empfindliche Kopfhaut & häufiges Waschen', synonyme: ['trocken', 'empfindlich', 'sensibel', 'entzünd', 'ekzem', 'reizung', 'häufig', 'täglich'] },
        { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
      ],
      3: [ /* Masken und Conditioner */
        { label: 'Juckreiz & Schuppen', synonyme: ['juckreiz', 'schuppen', 'psoriasis', 'seborrh'] },
        { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
        { label: 'Trockenes Haar & Spliss', synonyme: ['trocken', 'strapaziert', 'brüchig', 'spliss'] },
        { label: 'Glanz & Kräftigung', synonyme: ['glanz', 'geschmeidig', 'entwirr', 'stärk', 'kräftig'] },
      ],
      4: [ /* Leave-in Produkte */
        { label: 'Beruhigung Kopfhaut', synonyme: ['beruhig', 'juckreiz', 'lindert', 'entzünd', 'reizung'] },
        { label: 'Schutz vor Umwelteinflüssen', synonyme: ['schutz', 'umwelt', 'uv'] },
        { label: 'Kräftigung & Glanz', synonyme: ['kräftig', 'stärk', 'glanz'] },
        { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
      ],
      5: [ /* Definition und Reparatur */
        { label: 'Lockiges Haar & Frizz', synonyme: ['lockig', 'kraus', 'wellig', 'frizz', 'anti-frizz'] },
        { label: 'Glanz & Geschmeidigkeit', synonyme: ['glanz', 'geschmeidig'] },
        { label: 'Reparatur & Spliss', synonyme: ['reparatur', 'brüchig', 'entwirr', 'spliss'] },
        { label: 'Coloriertes Haar', synonyme: ['farbe', 'gefärbt', 'farbschutz', 'colorschutz'] },
      ],
      6: [ /* Integrierend */
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

Alle Synonyme sind bereits kleingeschrieben hinterlegt (kein Laufzeit-Lowercasing der
Konfiguration nötig, nur der zu prüfende Beschreibungstext wird normalisiert). Struktur
unterstützt sowohl `default` (bereichsweit) als auch `steps[nummer]` (Override) — aktuell
nutzen beide Bereiche ausschließlich `steps`, `default` bleibt als Erweiterungspunkt
für künftige Schritte ohne eigene Zuordnung nutzbar, ohne bestehenden Code zu ändern.

## 3. Text-Matching

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

Bewusst **kein** `innerHTML`-basiertes Parsen (Regex-Tag-Strip statt `div.innerHTML = ...;
div.textContent`) — konsistent mit der bestehenden Projekt-Konvention, dynamische
Textinhalte ohne `innerHTML` zu verarbeiten (siehe Kommentar bei den bestehenden
DOM-Hilfsfunktionen), und ohne die Nebenwirkungen eines detached-DOM-Parse-Tricks
(z. B. auslösende Bild-Requests bei `<img>`-Tags in der Beschreibung).

## 4. Zustand & Reset

Zwei neue Felder im Wizard-State: `hilfeOffen` (bool), `hilfeAktiverChip` (Chip-Label
oder `null`), `hilfeSchrittNummer` (zuletzt gerenderte Schritt-Nummer, zur
Reset-Erkennung). Statt an jeder der mehreren Stellen, die `currentStepIndex`/`screen`
ändern, einzeln zurückzusetzen, erfolgt der Reset zentral am Anfang von
`renderSchrittScreen()` — exakt das bereits bestehende Idiom für den Auto-Skip leerer
Schritte (State ändern + `return`, kein Render in diesem Aufruf):

```js
if (state.hilfeSchrittNummer !== schritt.nummer) {
  update({ hilfeSchrittNummer: schritt.nummer, hilfeOffen: false, hilfeAktiverChip: null });
  return;
}
```

## 5. UI & Interaktion

- Sekundärer Button "Hilfe bei der Wahl" (Klasse `wizard-button-secondary`, wie an
  anderer Stelle bereits verwendet) direkt unter der Schritt-Überschrift, oberhalb des
  Produkt-Grids. Deaktiviert (`disabled`-Attribut), solange
  `state.liveByStep[schritt.nummer].status !== 'ready'`.
- Klick togglet `hilfeOffen`. Wenn offen: Chip-Reihe (neue Klasse
  `wizard-hilfe-chips`) mit den Chips aus `getHilfeChips(state.bereich, schritt.nummer)`,
  jeder Chip ein `<button class="wizard-hilfe-chip">` (aktiver Chip zusätzlich
  `wizard-hilfe-chip--aktiv`).
- Klick auf einen Chip: ist er bereits aktiv → deaktivieren (Highlight/Hinweis
  verschwindet). Sonst: über alle `verfuegbareResolved` dieses Schritts prüfen, wie
  viele `chipHatTreffer(chip, resolved.beschreibungLive)` erfüllen.
  - Genau 1 Treffer: dessen `produkt.sku` in `state.hilfeErgebnisSku` speichern.
  - 0 oder ≥2 Treffer: `state.hilfeErgebnisSku = null`,
    `state.hilfeKeineEindeutigeEmpfehlung = true`.
- `renderProduktCard()`: zusätzliche Klasse `wizard-produkt-card--empfohlen`, wenn
  `state.hilfeAktiverChip && state.hilfeErgebnisSku === angezeigtesProdukt.sku` — eine
  **neue, von `--selected` optisch unterscheidbare** Klasse (z. B. Akzent-Rahmen statt
  gefüllter Hintergrund), damit eine Empfehlung nicht mit einer bereits getroffenen
  Auswahl verwechselt wird. Nicht-empfohlene Karten werden nicht ausgegraut (wie
  gefordert).
- Unterhalb der Chip-Reihe, wenn `hilfeKeineEindeutigeEmpfehlung`: Hinweistext "Keine
  eindeutige Empfehlung – wähl gern selbst aus" (neue Klasse `wizard-hilfe-hinweis`).

## 6. Testing

`wizard.js` hat projektweit keine automatisierte Testsuite (kein Build-Schritt, siehe
README). Verifikation wie bei den bisherigen `wizard.js`-Änderungen: `node --check` +
manuelle Codedurchsicht. Zusätzlich — anders als beim Cloudflare-Worker-Beacon, der eine
echte Shop-Domain für den Origin-Check brauchte — ist diese Funktion vollständig lokal
über `index.html` testbar (Ecwid-Live-API akzeptiert Anfragen unabhängig vom
aufrufenden Origin, das nutzt der bestehende Live-Verfügbarkeitscheck bereits genauso
beim lokalen Testen). Empfehlung: pro Bereich mindestens einen Schritt lokal
durchklicken (Button → Chip → Karte hervorgehoben bzw. Hinweistext), inklusive eines
Schritts mit mehreren sichtbaren Produkten.

## Nicht Teil dieser Erweiterung

- Kein Sprachmodell, keine Fuzzy-/Levenshtein-Suche — reiner Teilstring-Vergleich.
- Keine Persistenz der Chip-Auswahl über Navigation hinweg (Reset bei Schrittwechsel,
  siehe Abschnitt 4).
- Keine Änderung an `produktzuordnung.json`/`produktzuordnung_member.json` — die
  Chip-Konfiguration lebt ausschließlich in `wizard.js`.
- Kein Ausgrauen nicht-empfohlener Karten.
- Trefferqualität hängt von den tatsächlichen Live-Beschreibungstexten in Ecwid ab;
  Nachjustierung der zentralen `HILFE_CHIPS`-Synonyme nach dem ersten Live-Test ist
  erwartet und durch die zentrale Konfiguration ohne Codeänderung an anderer Stelle
  möglich.
