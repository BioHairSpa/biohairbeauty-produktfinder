# Produkt-Finder-Wizard — biohairbeauty.shop

Auswahlhilfe (Wizard), die Kunden Schritt für Schritt zu passenden Pflegeprodukten
für Haare/Kopfhaut oder Gesicht/Körper führt und die Auswahl direkt in den Ecwid-Warenkorb
legt. Eine Codebasis für zwei getrennte Ecwid-Stores:

| | Hauptshop | Member-Shop |
|---|---|---|
| Domain | www.biohairbeauty.shop | member.biohairbeauty.shop |
| Store-ID | 13985153 | 120918775 |
| Zugang | öffentlich | nur für freigegebene Kunden |

Store-Erkennung erfolgt zur Laufzeit über `window.location.hostname` (`wizard.js`).

## Projektstruktur

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

## Status

- [x] **Schritt 1** — Grundgerüst, Konfiguration (Hostname-Erkennung), Datenladen,
      zwei Einstiegspunkte (schwebender Button + Inline-Mount)
- [x] **Schritt 2** — Gesichts-Zweig, vollständiger Durchlauf (Bereichswahl → Hauttyp →
      5 Schritte mit Produktkarten → Zusammenfassung)
- [x] **Schritt 3** — Haar-Zweig (6 Schritte, 7 Haartypen, Gold-/Beige-Akzent) — nutzt
      denselben generischen Renderer wie Gesicht, keine Code-Duplizierung
- [x] **Schritt 4** — Live-Verfügbarkeitsprüfung & Warenkorb-Integration (Code fertig,
      siehe "Noch zu tun" unten für den ausstehenden Live-Test mit echtem Token)

## Lokal testen

`index.html` im Browser öffnen (direkt als Datei oder über einen lokalen Server).
Da `file://`/`localhost` keinem der beiden echten Shop-Hostnamen entspricht, wird der
Store über einen Query-Parameter erzwungen:

- `index.html` — ohne Parameter: Fallback-Warnung in der Konsole, Hauptshop-Konfiguration
- `index.html?wizardStore=hauptshop` — simuliert www.biohairbeauty.shop
- `index.html?wizardStore=member` — simuliert member.biohairbeauty.shop
- `index.html?wizardStore=hauptshop&mode=inline` — simuliert die dedizierte
  "Beautyfinder"-Seite (Inline-Mount statt Overlay)

## Zwei Einstiegspunkte, eine Wizard-Logik

- **Schwebender Auslöser-Button**: `wizard.js` fügt ihn automatisch auf jeder Seite ein
  (Ecwid Custom JS lädt site-weit) und öffnet den Wizard als Vollbild-Overlay.
- **Dedizierte Seite "Beautyfinder"**: Auf dieser Ecwid-Seite wird ein leerer Container
  eingebettet (siehe Abschnitt "Manuelle Schritte in Ecwid" unten). `wizard.js` erkennt
  ihn per ID `produkt-finder-wizard-inline` und rendert den Wizard dort inline, ohne
  Overlay-Rahmen. Auf dieser Seite erscheint der schwebende Button nicht zusätzlich.

Beide Einstiegspunkte nutzen exakt dieselbe Render-/Zustandslogik in `wizard.js`.

---

## Manuelle Schritte in Ecwid

Dieser Abschnitt beschreibt ausschließlich, was **du selbst** im Ecwid Site-Builder /
Control Panel tun musst — kein Code, keine Deployment-Schritte.

### 1. JS/CSS-URLs eintragen (pro Store einmal)
1. Ecwid Control Panel öffnen → Store wählen (Hauptshop oder Member-Shop)
2. Apps → Meine Apps → "Produkt Finder Wizard" öffnen
3. Feld "Benutzerdefinierte JS-URL" → GitHub-Pages-URL zu `wizard.js` eintragen
4. Feld "Benutzerdefinierte CSS-URL" → GitHub-Pages-URL zu `wizard.css` eintragen
5. Speichern
6. Schritt 1–5 für den jeweils anderen Store wiederholen (zwei getrennte Custom-App-Instanzen)

### 2. "Beautyfinder"-Seite anlegen (pro Store einmal)
1. Ecwid Control Panel → Website / Site-Designer (Bezeichnung je nach Ecwid-Plan: "Meine
   Website" oder "Site-Builder")
2. Neue Seite hinzufügen → Seitentyp mit freiem HTML-/Embed-Inhalt wählen (z. B. "Leere Seite"
   bzw. "Custom HTML", je nach aktueller Ecwid-Oberfläche)
3. Seitentitel "Beautyfinder" vergeben — dieser Titel erscheint später als Menüpunkt-Label
4. Im HTML-/Embed-Content-Block der Seite genau diesen Code einfügen:
   ```html
   <div id="produkt-finder-wizard-inline"></div>
   ```
5. Seite veröffentlichen/speichern
6. Seite im Hauptmenü sichtbar schalten (Navigationseinstellungen → Menüpunkt aktivieren,
   Reihenfolge nach Wunsch anpassen)
7. Schritt 1–6 für den jeweils anderen Store wiederholen (getrennte Seiten, getrennte Menüs,
   da zwei unabhängige Stores)

### 3. Vor dem Livegang zusätzlich klären
Laut `ecwid-doku-referenz.md` kann für ein selbst gehostetes Custom-JS-Skript (GitHub Pages)
unter Umständen ein zusätzlicher "App-Update"-Freischaltschritt beim Ecwid-API-Support nötig
sein, damit es zuverlässig auf jeder Seite geladen wird — nicht nur das Eintragen der URL unter
Punkt 1. Bitte vor dem produktiven Einsatz einmal kurz beim Ecwid-Support nachfragen bzw.
gemeinsam gegenchecken, ob für die beiden Custom Apps "Produkt Finder Wizard" ein solcher
Schritt erforderlich ist.

> Hinweis: Menübezeichnungen/Klickpfade im Ecwid Control Panel können sich je nach
> Tarif/Version leicht unterscheiden — die obigen Schritte sind der aktuell gängige Ablauf,
> bei Bedarf schauen wir gemeinsam auf den tatsächlichen Admin-Bereich.

---

## API-Zugänge

Für beide Shops existiert eine eigene Custom App mit Scope `read_catalog`. Secret-Tokens
werden **nie** im Code oder in Commits hinterlegt, sondern nur lokal in einer nicht
versionierten `.env` (siehe `.env.example`) — ausschließlich für künftige, separate
Build-/Update-Skripte, die `produktzuordnung*.json` automatisiert aktualisieren.

Für die clientseitige Live-Verfügbarkeitsprüfung in `wizard.js` wird ausschließlich das
**öffentliche** Ecwid-Token verwendet (bewusst im Code sichtbar, da es laut Ecwid-Doku
explizit "safe to use in public code" ist). Eintragen in `wizard.js`, `STORE_CONFIG`:

```js
'www.biohairbeauty.shop': { ..., publicToken: 'HIER_EINTRAGEN' },
'member.biohairbeauty.shop': { ..., publicToken: 'HIER_EINTRAGEN' },
```

Ohne eingetragenes Token läuft der Wizard weiter (kein Fehler), verwendet für die
Verfügbarkeit aber nur den JSON-Snapshot, und der Warenkorb-Button bleibt dauerhaft im
Zustand "Warenkorb wird vorbereitet …", da `Ecwid.Cart.addProduct` zwingend die
numerische Produkt-ID braucht, die nur der Live-Lookup liefert.

## Wie die Live-Prüfung funktioniert

- Beim Anzeigen eines Schritts werden die dort sichtbaren Produkte (inkl. aller
  Größenvarianten) per Ecwid-Produktsuche nach SKU geprüft (`enabled`, `inStock`,
  `unlimited`, numerische `id`).
- Größenvarianten sind in Ecwid **eigenständige Produkte** mit eigener SKU, keine
  "Optionen/Varianten" eines Hauptprodukts — deshalb genügt ein einfacher SKU-Suchaufruf
  pro Kandidat, keine komplexere Kombinationslogik.
- Die Produktsuche akzeptiert nur **eine SKU pro Request** (kein Komma-Batching) — daher
  wird lazy pro Schritt geprüft (nur die dort sichtbaren Produkte), nicht der komplette
  Hauttyp-/Haartyp-Zweig auf einmal.
- Ist ein Produkt nicht (mehr) verfügbar, aber eine andere Größe schon, wird automatisch
  die verfügbare Größe angezeigt. Sind alle Größen inaktiv (Testfall "Olio Ylang-Ylang"),
  zeigt die Karte "Derzeit nicht verfügbar" und lässt sich nicht auswählen.
- Schlägt die Live-Prüfung fehl (kein Token, Netzwerkfehler, Rate-Limit) fällt der Wizard
  still auf den JSON-Snapshot zurück — keine Fehlermeldung für den Kunden.
- Ergebnisse werden 10 Minuten in `sessionStorage` gecacht, um wiederholte Anfragen beim
  Hin-/Zurücknavigieren zu vermeiden.

## Offene Punkte

- **Gold-/Beige-Akzent Haar-Bereich**: `--wizard-color-gold-akzent` in `design-tokens.css`
  ist nur grob angenähert (aus einer Tabellenkopfzeile abgeleitet, nicht als echte
  Shop-Variable hinterlegt). Wird vorläufig übernommen, ist aber als einzelne CSS-Variable
  isoliert und vor dem finalen Einsatz mit dem Auftraggeber abzustimmen.

## Noch zu tun

- **Öffentliche Tokens eintragen** (siehe "API-Zugänge" oben) und Live-Prüfung gegen den
  echten Store testen — lokal bisher nur der Fallback-Pfad ohne Token getestet
  (Snapshot-Verfügbarkeit, Warenkorb-Button bleibt im "wird vorbereitet"-Zustand).
- **Echter Warenkorb-Test**: `Ecwid.Cart.addProduct` ist nur auf einer tatsächlichen
  Ecwid-Storefront-Seite verfügbar (`window.Ecwid`-Objekt existiert nicht in `index.html`),
  daher muss der komplette Fluss "Auswahl → In den Warenkorb → Warenkorb prüfen" einmal
  auf einer echten Store-Seite (z. B. über die vorläufig eingetragene JS-/CSS-URL auf
  einer Testseite) durchgeklickt werden.
