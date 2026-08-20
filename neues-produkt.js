#!/usr/bin/env node
/*
  neues-produkt.js
  Eigenstaendiges Wartungsskript: fuegt ein neues Produkt per SKU zu
  produktzuordnung.json und/oder produktzuordnung_member.json hinzu.

  Verwendung:
    node neues-produkt.js --sku 5900 --bereich gesicht --typ trockene_haut --schritt 3

  Benoetigt eine lokale .env-Datei (siehe .env.example) mit den GEHEIMEN
  Ecwid-Tokens. Diese Datei ist git-ignored und wird nie committet -- der
  geheime Token wird ausschliesslich hier lokal verwendet, niemals im
  ausgelieferten wizard.js.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');

const PROJECT_DIR = __dirname;

const STORES = {
  hauptshop: {
    label: 'Hauptshop',
    storeId: 13985153,
    dataFile: path.join(PROJECT_DIR, 'produktzuordnung.json'),
    tokenEnvKey: 'ECWID_HAUPTSHOP_SECRET_TOKEN',
  },
  member: {
    label: 'Member-Shop',
    storeId: 120918775,
    dataFile: path.join(PROJECT_DIR, 'produktzuordnung_member.json'),
    tokenEnvKey: 'ECWID_MEMBER_SECRET_TOKEN',
  },
};

const BEREICH_TYPEN_KEY = {
  gesicht: 'hauttypen',
  haare: 'haartypen',
};

// Ecwids seoDescription ist normalerweise die kurze, kuratierte Beschreibung
// (< 160 Zeichen laut Ecwid-Doku) -- bei manchen Produkten (v. a. im
// Member-Shop, empirisch bestaetigt an SKU 3700) ist das Feld aber gar nicht
// gepflegt und liefert stattdessen die volle Rohbeschreibung mit
// Formatierungsartefakten. Ab dieser Laenge bzw. bei Zeilenumbruechen gilt
// der Wert als verdaechtig und wird nicht blind uebernommen.
const MAX_BESCHREIBUNG_LAENGE = 300;

function wirktAlsRohbeschreibung(text) {
  return !text || text.length > MAX_BESCHREIBUNG_LAENGE || /\n/.test(text);
}

// ---------------------------------------------------------------------
// .env laden (minimaler Parser, keine externe Abhaengigkeit)
// ---------------------------------------------------------------------

function ladeEnv() {
  const envPath = path.join(PROJECT_DIR, '.env');
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  const inhalt = fs.readFileSync(envPath, 'utf8');
  inhalt.split('\n').forEach((zeile) => {
    const getrimmt = zeile.trim();
    if (!getrimmt || getrimmt.startsWith('#')) return;
    const gleichheitsIndex = getrimmt.indexOf('=');
    if (gleichheitsIndex === -1) return;
    const key = getrimmt.slice(0, gleichheitsIndex).trim();
    let value = getrimmt.slice(gleichheitsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

// ---------------------------------------------------------------------
// CLI-Argumente parsen
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function fehlerUndBeenden(nachricht) {
  console.error('\n❌ ' + nachricht + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Ecwid REST API: Produkt per SKU suchen (geheimes Token -- sieht auch
// deaktivierte Produkte, im Gegensatz zum oeffentlichen Token im Wizard).
// ---------------------------------------------------------------------

async function sucheProduktPerSku(storeId, secretToken, sku) {
  const url =
    'https://app.ecwid.com/api/v3/' + storeId + '/products?' + new URLSearchParams({ sku: sku }).toString();
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + secretToken } });
  if (!response.ok) {
    throw new Error('Ecwid-API-Fehler (HTTP ' + response.status + ') fuer Store ' + storeId);
  }
  const daten = await response.json();
  return (daten.items && daten.items[0]) || null;
}

// ---------------------------------------------------------------------
// Tabellenname-Vorschlag ableiten: Teil vor "/" bzw. vor " - "/" - ",
// sonst kompletter Produktname (gleiches Muster wie bei den bestehenden
// Eintraegen, z. B. "Gel Detergente / Gesichtsreinigung 200ml" -> "Gel Detergente").
// ---------------------------------------------------------------------

function schlageTabellennameVor(name) {
  const slashTeile = name.split('/');
  if (slashTeile.length > 1) return slashTeile[0].trim();
  const gedankenstrichTeile = name.split(/\s[–-]\s/);
  if (gedankenstrichTeile.length > 1) return gedankenstrichTeile[0].trim();
  return name.trim();
}

function formatierterPreis(zahl) {
  return Number(zahl).toFixed(2);
}

// ---------------------------------------------------------------------
// Hauptablauf
// ---------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { sku, bereich, typ, schritt } = args;

  if (!sku || !bereich || !typ || !schritt) {
    fehlerUndBeenden(
      'Bitte alle Parameter angeben:\n' +
        '  node neues-produkt.js --sku <SKU> --bereich gesicht|haare --typ <typ-schluessel> --schritt <nummer>'
    );
  }

  if (bereich !== 'gesicht' && bereich !== 'haare') {
    fehlerUndBeenden('Ungueltiger --bereich "' + bereich + '". Gueltige Werte: gesicht, haare');
  }

  const env = ladeEnv();

  const storeDaten = {};
  for (const [key, store] of Object.entries(STORES)) {
    if (!fs.existsSync(store.dataFile)) {
      fehlerUndBeenden('Datei nicht gefunden: ' + store.dataFile);
    }
    storeDaten[key] = JSON.parse(fs.readFileSync(store.dataFile, 'utf8'));
  }

  const typenKey = BEREICH_TYPEN_KEY[bereich];
  const referenzDaten = storeDaten.hauptshop;
  const gueltigeTypen = referenzDaten[bereich][typenKey];
  const gueltigeSchritte = referenzDaten[bereich].schritte.slice().sort((a, b) => a.nummer - b.nummer);

  if (!gueltigeTypen[typ]) {
    const liste = Object.keys(gueltigeTypen)
      .map((k) => '  - ' + k + ' ("' + gueltigeTypen[k].label + '")')
      .join('\n');
    fehlerUndBeenden(
      'Ungueltiger --typ "' + typ + '" fuer Bereich "' + bereich + '".\nGueltige Werte:\n' + liste
    );
  }

  const schrittNummer = parseInt(schritt, 10);
  const schrittEintrag = gueltigeSchritte.find((s) => s.nummer === schrittNummer);
  if (!schrittEintrag) {
    const liste = gueltigeSchritte.map((s) => '  - ' + s.nummer + ' ("' + s.titel + '")').join('\n');
    fehlerUndBeenden(
      'Ungueltiger --schritt "' + schritt + '" fuer Bereich "' + bereich + '".\nGueltige Werte:\n' + liste
    );
  }

  console.log('\nSuche SKU "' + sku + '" in beiden Shops ueber die Ecwid REST API...');

  const treffer = {};
  for (const [key, store] of Object.entries(STORES)) {
    const secretToken = env[store.tokenEnvKey];
    if (!secretToken) {
      console.warn(
        '⚠️  Kein Token fuer ' + store.label + ' (' + store.tokenEnvKey + ') in .env gefunden -- ueberspringe diesen Store.'
      );
      continue;
    }
    try {
      const produkt = await sucheProduktPerSku(store.storeId, secretToken, sku);
      if (produkt) {
        treffer[key] = produkt;
        console.log('  ✓ Gefunden in ' + store.label + ': "' + produkt.name + '"');
      } else {
        console.log('  – Nicht gefunden in ' + store.label);
      }
    } catch (error) {
      console.warn('  ⚠️  Fehler beim Abfragen von ' + store.label + ': ' + error.message);
    }
  }

  if (Object.keys(treffer).length === 0) {
    fehlerUndBeenden('SKU "' + sku + '" wurde in keinem der beiden Shops gefunden. Kein Eintrag angelegt.');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const zumSchreiben = [];

  for (const [key, produkt] of Object.entries(treffer)) {
    const store = STORES[key];
    const data = storeDaten[key];
    const typEintrag = data[bereich][typenKey][typ];
    const schrittKey = String(schrittNummer);
    if (!typEintrag.produkte[schrittKey]) {
      typEintrag.produkte[schrittKey] = [];
    }
    const vorhandenerEintrag = typEintrag.produkte[schrittKey].find((p) => p.sku === String(sku));

    console.log('\n=== ' + store.label + ' ===');
    console.log('Produktname:   ' + produkt.name);
    console.log('Preis:         ' + formatierterPreis(produkt.price) + ' EUR');
    console.log(
      'Verfuegbar:    ' + (produkt.enabled && (produkt.unlimited || produkt.inStock) ? 'ja' : 'nein')
    );
    console.log(
      'Wird eingefuegt in: ' +
        bereich +
        ' -> ' +
        typ +
        ' (' +
        gueltigeTypen[typ].label +
        ') -> Schritt ' +
        schrittNummer +
        ' (' +
        schrittEintrag.titel +
        ')'
    );

    if (vorhandenerEintrag) {
      console.log(
        '\n⚠️  SKU "' +
          sku +
          '" ist an dieser Stelle in ' +
          store.label +
          ' bereits vorhanden ("' +
          vorhandenerEintrag.shop_name +
          '").'
      );
      const antwort = await rl.question('Trotzdem als weiteren Eintrag hinzufuegen? (y/n): ');
      if (antwort.trim().toLowerCase() !== 'y') {
        console.log('Uebersprungen fuer ' + store.label + '.');
        continue;
      }
    }

    const vorschlag = schlageTabellennameVor(produkt.name);
    const tabellennameEingabe = await rl.question('Tabellenname [' + vorschlag + ']: ');
    const tabellenname = tabellennameEingabe.trim() || vorschlag;

    let beschreibung = produkt.seoDescription || '';
    if (wirktAlsRohbeschreibung(beschreibung)) {
      console.log(
        '\n⚠️  Die seoDescription aus Ecwid wirkt nicht wie eine kurze, kuratierte Beschreibung ' +
          '(' + beschreibung.length + ' Zeichen' + (/\n/.test(beschreibung) ? ', mit Zeilenumbruechen' : '') + ').'
      );
      if (beschreibung) {
        console.log('Rohtext zur Orientierung:\n' + beschreibung);
      } else {
        console.log('(Feld ist leer -- in Ecwid unter "SEO" vermutlich nicht gepflegt.)');
      }
      const manuelleBeschreibung = await rl.question(
        '\nBitte kurze Beschreibung manuell eingeben (max. ca. 250 Zeichen, gleicher Stil wie bestehende Eintraege): '
      );
      beschreibung = manuelleBeschreibung.trim();
    }

    const neuerEintrag = {
      gefunden: true,
      sku: String(sku),
      shop_name: produkt.name,
      beschreibung: beschreibung,
      preis_eur: formatierterPreis(produkt.price),
      verfuegbar: !!produkt.enabled && (!!produkt.unlimited || !!produkt.inStock),
      url: produkt.url,
      tabellenname: tabellenname,
      bild_url: produkt.imageUrl || '',
    };

    console.log('\n--- Vorschau des neuen Eintrags (' + store.label + ') ---');
    console.log(JSON.stringify(neuerEintrag, null, 2));

    if (!beschreibung) {
      console.warn(
        '⚠️  Achtung: beschreibung ist leer. Bitte die JSON-Datei danach manuell nachbessern.'
      );
    }
    if (!produkt.imageUrl) {
      console.warn('⚠️  Achtung: kein Bild in Ecwid hinterlegt -- bild_url ist leer.');
    }

    const bestaetigung = await rl.question('\nEintragen? (y/n): ');
    if (bestaetigung.trim().toLowerCase() === 'y') {
      typEintrag.produkte[schrittKey].push(neuerEintrag);
      zumSchreiben.push(key);
      console.log('✓ Uebernommen fuer ' + store.label + ' (noch nicht gespeichert).');
    } else {
      console.log('Abgebrochen fuer ' + store.label + ' -- keine Aenderung.');
    }
  }

  rl.close();

  if (zumSchreiben.length === 0) {
    console.log('\nKeine Aenderungen zu speichern.');
    return;
  }

  for (const key of zumSchreiben) {
    const store = STORES[key];
    fs.writeFileSync(store.dataFile, JSON.stringify(storeDaten[key], null, 2), 'utf8');
    console.log('✓ Gespeichert: ' + store.dataFile);
  }
}

main().catch((error) => {
  console.error('\n❌ Unerwarteter Fehler: ' + error.message);
  process.exit(1);
});
