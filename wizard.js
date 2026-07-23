/*
  Produkt-Finder-Wizard — biohairbeauty.shop
  Eine Codebasis für Hauptshop (www.biohairbeauty.shop) und Member-Shop
  (member.biohairbeauty.shop). Store-Erkennung über window.location.hostname.
  Kein Framework, kein Build-Schritt — läuft als einzelnes <script>, wie es
  Ecwids Feld "Benutzerdefinierte JS-URL" erwartet.
*/

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Skript-Basis-URL ermitteln: relative fetch()-Pfade lösen sonst gegen die
  // Shop-Seite auf (www.biohairbeauty.shop), nicht gegen die GitHub-Pages-
  // Herkunft von wizard.js — daher müssen dataFile-Pfade absolut zur eigenen
  // Skript-URL aufgelöst werden. document.currentScript ist nur während der
  // synchronen Erstausführung dieses Scripts verfügbar, deshalb hier ganz am
  // Anfang und in eine Variable sichern (nicht erst später beim fetch()-Aufruf
  // lesen, da document.currentScript zu dem Zeitpunkt bereits null wäre).
  // ---------------------------------------------------------------------

  const SCRIPT_BASE_URL = (function () {
    const currentScript = document.currentScript;
    if (currentScript && currentScript.src) {
      return currentScript.src.replace(/[^/]*$/, '');
    }
    // Fallback, falls document.currentScript nicht verfügbar ist (z. B.
    // ungewöhnliche Einbindung durch Ecwid): letztes passende <script src>
    // im DOM suchen.
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (/wizard\.js(\?.*)?$/.test(scripts[i].src)) {
        return scripts[i].src.replace(/[^/]*$/, '');
      }
    }
    console.warn(
      '[Produkt-Finder-Wizard] Konnte die eigene Skript-URL nicht ermitteln — ' +
      'lade Produktdaten notfalls relativ zur aktuellen Seite (kann fehlschlagen).'
    );
    return './';
  })();

  // ---------------------------------------------------------------------
  // config — Hostname-Erkennung, liefert {storeId, dataFile, publicToken}
  // ---------------------------------------------------------------------

  const STORE_CONFIG = {
    'www.biohairbeauty.shop': {
      key: 'hauptshop',
      storeId: 13985153,
      dataFile: 'produktzuordnung.json',
      // TODO: öffentliches Ecwid-Token eintragen (siehe README, Abschnitt
      // "API-Zugänge"). Ohne Token läuft der Wizard weiter, nutzt für die
      // Verfügbarkeit aber nur den JSON-Snapshot statt der Live-Prüfung, und
      // der Warenkorb-Button bleibt deaktiviert.
      publicToken: '',
    },
    'member.biohairbeauty.shop': {
      key: 'member',
      storeId: 120918775,
      dataFile: 'produktzuordnung_member.json',
      publicToken: '',
    },
  };

  function resolveConfig() {
    const hostname = window.location.hostname;
    if (STORE_CONFIG[hostname]) {
      return STORE_CONFIG[hostname];
    }

    // Lokales Testen: file:// bzw. localhost entsprechen keinem der beiden
    // echten Hostnamen. Override per Query-Parameter, z. B.
    // index.html?wizardStore=member
    const params = new URLSearchParams(window.location.search);
    const override = params.get('wizardStore');
    if (override === 'hauptshop' || override === 'member') {
      return Object.values(STORE_CONFIG).find((c) => c.key === override);
    }

    // Default für lokales Testen ohne Query-Param: Hauptshop-Config
    console.warn(
      '[Produkt-Finder-Wizard] Hostname "' + hostname + '" ist keiner der beiden ' +
      'bekannten Shop-Domains zugeordnet. Nutze Hauptshop-Konfiguration als Fallback ' +
      '(zum gezielten Testen: ?wizardStore=hauptshop oder ?wizardStore=member anhängen).'
    );
    return STORE_CONFIG['www.biohairbeauty.shop'];
  }

  const config = resolveConfig();

  // ---------------------------------------------------------------------
  // dataLoader — lädt & cached die passende JSON-Datei per fetch()
  // ---------------------------------------------------------------------

  let dataPromise = null;

  function loadData() {
    if (!dataPromise) {
      const url = SCRIPT_BASE_URL + config.dataFile;
      dataPromise = fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              'Produktzuordnungs-Datei "' + url + '" konnte nicht geladen ' +
              'werden (HTTP ' + response.status + ').'
            );
          }
          return response.json();
        })
        .catch((error) => {
          console.error('[Produkt-Finder-Wizard] Fehler beim Laden der Produktdaten:', error);
          throw error;
        });
    }
    return dataPromise;
  }

  // ---------------------------------------------------------------------
  // Bereichs-Metadaten (gemeinsam für Gesicht & Haare, generischer Renderer)
  // ---------------------------------------------------------------------

  const BEREICH_META = {
    gesicht: {
      label: 'Gesicht & Körper',
      typenKey: 'hauttypen',
      accentClass: 'wizard-bereich-gesicht',
    },
    haare: {
      label: 'Haare & Kopfhaut',
      typenKey: 'haartypen',
      accentClass: 'wizard-bereich-haare',
    },
  };

  const preisFormatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  });

  function formatPreis(preisEur) {
    const value = parseFloat(preisEur);
    return isNaN(value) ? preisEur : preisFormatter.format(value);
  }

  function getSchritte(data, bereich) {
    return (data[bereich].schritte || []).slice().sort((a, b) => a.nummer - b.nummer);
  }

  function getTypen(data, bereich) {
    const typenKey = BEREICH_META[bereich].typenKey;
    const typen = data[bereich][typenKey] || {};
    return Object.keys(typen).map((key) => ({ key, label: typen[key].label }));
  }

  function getProdukte(data, bereich, typKey, nummer) {
    const typenKey = BEREICH_META[bereich].typenKey;
    const typ = data[bereich][typenKey][typKey];
    return (typ && typ.produkte && typ.produkte[String(nummer)]) || [];
  }

  // ---------------------------------------------------------------------
  // availability — Live-Verfügbarkeitsprüfung gegen die Ecwid REST API
  // (öffentliches Token, Produktsuche nach SKU). Größenvarianten sind in
  // Ecwid eigenständige Produkte mit eigener SKU (keine "combinations"),
  // daher genügt pro Kandidat ein einfacher SKU-Suchaufruf.
  //
  // Die Produktsuche akzeptiert nur eine exakte SKU pro Request (kein
  // Komma-Batching) — deshalb wird pro Schritt lazy geprüft (nur die dort
  // sichtbaren Produkte), nicht der komplette Hauttyp/Haartyp-Zweig auf
  // einmal, um unnötig viele Requests zu vermeiden.
  // ---------------------------------------------------------------------

  const LIVE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 Minuten
  const liveInfoCache = {}; // In-Memory-Cache pro Seitenaufruf, keyed nach SKU

  function sessionCacheKey(sku) {
    return 'wizardLive:' + config.storeId + ':' + sku;
  }

  function readSessionCache(sku) {
    try {
      const raw = sessionStorage.getItem(sessionCacheKey(sku));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > LIVE_CACHE_TTL_MS) return null;
      return parsed.value;
    } catch (error) {
      return null;
    }
  }

  function writeSessionCache(sku, value) {
    try {
      sessionStorage.setItem(sessionCacheKey(sku), JSON.stringify({ ts: Date.now(), value }));
    } catch (error) {
      // sessionStorage evtl. nicht verfügbar (z. B. Safari privat) — dann eben ohne Cache.
    }
  }

  // Liefert { verfuegbar, ecwidId, imageUrl } oder null (kein Token hinterlegt /
  // Live-Check fehlgeschlagen -> Aufrufer soll dann auf den JSON-Snapshot
  // zurückfallen). imageUrl kommt aus demselben Suchaufruf wie die
  // Verfügbarkeit — kein zusätzlicher Request nötig.
  function fetchLiveInfo(sku) {
    if (!config.publicToken) return Promise.resolve(null);
    if (liveInfoCache[sku]) return liveInfoCache[sku];

    const cached = readSessionCache(sku);
    if (cached) {
      liveInfoCache[sku] = Promise.resolve(cached);
      return liveInfoCache[sku];
    }

    const url =
      'https://app.ecwid.com/api/v3/' +
      config.storeId +
      '/products?' +
      new URLSearchParams({ token: config.publicToken, sku: sku }).toString();

    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
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
      .catch((error) => {
        console.warn(
          '[Produkt-Finder-Wizard] Live-Verfügbarkeitsprüfung fehlgeschlagen für SKU',
          sku,
          error
        );
        return null;
      });

    liveInfoCache[sku] = promise;
    return promise;
  }

  // Prüft ein Produkt inkl. aller Größenvarianten und wählt die erste live
  // verfügbare Variante aus. Ergebnis: { produkt, ecwidId, istVerfuegbar, liveGeprueft, bildUrl }
  // bildUrl kommt bevorzugt aus der Live-Antwort (die JSON-Datei kann veraltete
  // Bild-URLs enthalten, z. B. nach einem Bildaustausch im Ecwid-Adminbereich);
  // der JSON-Snapshot dient nur als Fallback, falls der Live-Check fehlschlägt.
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

  // ---------------------------------------------------------------------
  // cart — Ecwid.Cart.addProduct benötigt die numerische Ecwid-Produkt-ID,
  // die erst der Live-Lookup oben liefert (nicht in den JSON-Dateien enthalten).
  // ---------------------------------------------------------------------

  function addToCart(ecwidId, onDone) {
    if (typeof window.Ecwid === 'undefined' || !window.Ecwid.Cart || !window.Ecwid.Cart.addProduct) {
      console.warn(
        '[Produkt-Finder-Wizard] Ecwid Storefront-JS-API nicht gefunden (z. B. beim lokalen ' +
        'Testen außerhalb des Shops). Warenkorb-Aktion wird übersprungen.'
      );
      onDone(false);
      return;
    }
    window.Ecwid.Cart.addProduct({ id: ecwidId, quantity: 1 }, function (success) {
      onDone(!!success);
    });
  }

  // ---------------------------------------------------------------------
  // DOM-Hilfsfunktionen (bewusst ohne innerHTML für dynamische Textinhalte
  // aus den JSON-Dateien, um HTML-Injection aus den Produktdaten zu vermeiden)
  // ---------------------------------------------------------------------

  function el(tag, opts, children) {
    const node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach((k) => {
        if (opts.attrs[k] != null) node.setAttribute(k, opts.attrs[k]);
      });
    }
    if (opts.onClick) node.addEventListener('click', opts.onClick);
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  function clear(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  // ---------------------------------------------------------------------
  // Wizard-Instanz: eigener Zustand + Renderer pro Mount-Aufruf
  // (Overlay- und Inline-Mount laufen unabhängig voneinander)
  // ---------------------------------------------------------------------

  function createWizard(container, data, mountOptions) {
    let state = {
      screen: 'bereich', // bereich | typ | schritt | zusammenfassung
      bereich: null,
      typKey: null,
      currentStepIndex: 0,
      stepDirection: 'forward', // 'forward' | 'backward' — steuert die Richtung, in der
      // automatisch komplett nicht verfügbare Schritte übersprungen werden
      selections: {}, // { [schrittNummer]: { sku, produkt, ecwidId } }
      cartAdded: {}, // { [sku]: true }
      liveByStep: {}, // { [schrittNummer]: { status: 'loading' | 'ready', results } }
    };

    function update(patch) {
      state = Object.assign({}, state, patch);
      render();
    }

    // Setzt nur die Bereichs-Akzentklasse, ohne bestehende Klassen des
    // Containers zu überschreiben (z. B. "wizard-overlay-content", die die
    // Overlay-Breite/-Innenabstand liefert — ein direktes className-Reset
    // hätte diese sonst bei jedem Re-Render gelöscht).
    function applyAccentClass(accentClass) {
      container.classList.remove(
        BEREICH_META.gesicht.accentClass,
        BEREICH_META.haare.accentClass
      );
      if (accentClass) container.classList.add(accentClass);
    }

    function resetToStart() {
      update({
        screen: 'bereich',
        bereich: null,
        typKey: null,
        currentStepIndex: 0,
        stepDirection: 'forward',
        selections: {},
        cartAdded: {},
        liveByStep: {},
      });
    }

    function handleCancel() {
      if (mountOptions.overlay && mountOptions.onClose) {
        mountOptions.onClose();
      }
      resetToStart();
    }

    function renderTopBar(showBack, onBack) {
      const bar = el('div', { className: 'wizard-top-bar' });
      if (showBack) {
        bar.appendChild(
          el('button', {
            className: 'wizard-button-secondary',
            text: '← Zurück',
            attrs: { type: 'button' },
            onClick: onBack,
          })
        );
      } else {
        bar.appendChild(el('span'));
      }
      bar.appendChild(
        el('button', {
          className: 'wizard-button-secondary',
          text: 'Abbrechen',
          attrs: { type: 'button' },
          onClick: handleCancel,
        })
      );
      return bar;
    }

    function renderProgress(schritte, currentIndex) {
      const wrap = el('div', { className: 'wizard-progress' });
      schritte.forEach((schritt, idx) => {
        const stepClass =
          'wizard-progress-step' +
          (idx === currentIndex ? ' wizard-progress-step--current' : '') +
          (idx < currentIndex ? ' wizard-progress-step--done' : '');
        wrap.appendChild(el('div', { className: stepClass }));
      });
      return wrap;
    }

    function renderBereichScreen() {
      clear(container);
      applyAccentClass(null);
      container.appendChild(el('h2', { text: 'Wofür suchst du eine Empfehlung?' }));

      const grid = el('div', { className: 'wizard-bereich-grid' });

      Object.keys(BEREICH_META).forEach((bereichKey) => {
        const meta = BEREICH_META[bereichKey];
        const card = el(
          'button',
          {
            className: 'wizard-bereich-card ' + meta.accentClass,
            attrs: { type: 'button' },
            onClick: () => update({ screen: 'typ', bereich: bereichKey }),
          },
          [el('span', { className: 'wizard-bereich-card-label', text: meta.label })]
        );
        grid.appendChild(card);
      });

      container.appendChild(grid);
    }

    function renderTypScreen() {
      clear(container);
      const meta = BEREICH_META[state.bereich];
      applyAccentClass(meta.accentClass);
      container.appendChild(renderTopBar(true, () => update({ screen: 'bereich', bereich: null })));
      container.appendChild(el('h2', { text: meta.label + ' — wähle deinen Typ' }));

      const grid = el('div', { className: 'wizard-typ-grid' });
      getTypen(data, state.bereich).forEach((typ) => {
        grid.appendChild(
          el(
            'button',
            {
              className: 'wizard-typ-card',
              attrs: { type: 'button' },
              onClick: () =>
                update({
                  screen: 'schritt',
                  typKey: typ.key,
                  currentStepIndex: 0,
                  stepDirection: 'forward',
                  selections: {},
                  cartAdded: {},
                  liveByStep: {},
                }),
            },
            [el('span', { text: typ.label })]
          )
        );
      });
      container.appendChild(grid);
    }

    // Solange die Live-Prüfung für einen Schritt noch nicht abgeschlossen ist,
    // wird der JSON-Snapshot als vorläufige Anzeige verwendet (nicht blockierend).
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

    function ensureLiveInfoForStep(schrittNummer, produkte) {
      if (state.liveByStep[schrittNummer]) return;

      state.liveByStep = Object.assign({}, state.liveByStep, {
        [schrittNummer]: { status: 'loading', results: null },
      });

      Promise.all(produkte.map(resolveProdukt)).then((results) => {
        const nextSelections = Object.assign({}, state.selections);
        const currentSelection = nextSelections[schrittNummer];
        if (currentSelection) {
          const nochGueltig = results.some(
            (r) => r.istVerfuegbar && r.produkt.sku === currentSelection.sku
          );
          if (!nochGueltig) delete nextSelections[schrittNummer];
        }

        update({
          liveByStep: Object.assign({}, state.liveByStep, {
            [schrittNummer]: { status: 'ready', results: results },
          }),
          selections: nextSelections,
        });
      });
    }

    function renderCartButton(sku, ecwidId) {
      if (state.cartAdded[sku]) {
        return el('div', { className: 'wizard-cart-status', text: '✓ Im Warenkorb' });
      }
      if (!ecwidId) {
        return el('div', {
          className: 'wizard-cart-status wizard-cart-status--pending',
          text: 'Warenkorb wird vorbereitet …',
        });
      }
      return el('button', {
        className: 'wizard-button-primary wizard-cart-placeholder-button',
        attrs: { type: 'button' },
        text: 'In den Warenkorb',
        onClick: () => {
          addToCart(ecwidId, (success) => {
            if (success) {
              const nextCartAdded = Object.assign({}, state.cartAdded);
              nextCartAdded[sku] = true;
              update({ cartAdded: nextCartAdded });
            } else {
              console.warn(
                '[Produkt-Finder-Wizard] Produkt konnte nicht in den Warenkorb gelegt werden (SKU ' + sku + ').'
              );
            }
          });
        },
      });
    }

    // Wird nur mit bereits gefilterten (verfügbaren) Produkten aufgerufen —
    // siehe renderSchrittScreen, das nicht verfügbare Produkte vorher entfernt.
    function renderProduktCard(schrittNummer, originalProdukt, resolvedInfo) {
      const angezeigtesProdukt = resolvedInfo.produkt;
      const selection = state.selections[schrittNummer];
      const isSelected = !!selection && selection.sku === angezeigtesProdukt.sku;

      const card = el('div', {
        className: 'wizard-produkt-card' + (isSelected ? ' wizard-produkt-card--selected' : ''),
      });

      // Bild bevorzugt live von Ecwid (resolvedInfo.bildUrl), JSON-Snapshot
      // (angezeigtesProdukt.bild_url) nur als Fallback — siehe fetchLiveInfo.
      const bildUrl = resolvedInfo.bildUrl || angezeigtesProdukt.bild_url;
      let bildElement;
      if (bildUrl) {
        const img = el('img', {
          className: 'wizard-produkt-image',
          attrs: { src: bildUrl, alt: angezeigtesProdukt.shop_name || '' },
        });
        let hatSnapshotFallbackVersucht = bildUrl === angezeigtesProdukt.bild_url;
        img.addEventListener('error', () => {
          if (!hatSnapshotFallbackVersucht && angezeigtesProdukt.bild_url) {
            hatSnapshotFallbackVersucht = true;
            img.src = angezeigtesProdukt.bild_url;
            return;
          }
          const placeholder = el('div', { className: 'wizard-produkt-image-placeholder' });
          img.replaceWith(placeholder);
        });
        bildElement = img;
      } else {
        bildElement = el('div', { className: 'wizard-produkt-image-placeholder' });
      }

      const nameElement = el('div', {
        className: 'wizard-produkt-name',
        text: angezeigtesProdukt.shop_name,
      });

      // Bild und Name verlinken auf die Produktseite (neuer Tab), damit der
      // Kunde den Wizard-Fortschritt beim Stöbern nicht verliert.
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
        card.appendChild(bildElement);
        card.appendChild(nameElement);
      }
      card.appendChild(
        el('div', { className: 'wizard-produkt-beschreibung', text: angezeigtesProdukt.beschreibung })
      );
      card.appendChild(
        el('div', { className: 'wizard-produkt-preis', text: formatPreis(angezeigtesProdukt.preis_eur) })
      );

      card.appendChild(
        el('button', {
          className: 'wizard-button-primary wizard-produkt-select-button',
          attrs: { type: 'button' },
          text: isSelected ? 'Ausgewählt ✓' : 'Auswählen',
          onClick: () => {
            const nextSelections = Object.assign({}, state.selections);
            if (isSelected) {
              delete nextSelections[schrittNummer];
            } else {
              nextSelections[schrittNummer] = {
                sku: angezeigtesProdukt.sku,
                produkt: angezeigtesProdukt,
                ecwidId: resolvedInfo.ecwidId,
              };
            }
            update({ selections: nextSelections });
          },
        })
      );

      if (isSelected) {
        card.appendChild(renderCartButton(angezeigtesProdukt.sku, resolvedInfo.ecwidId));
      }

      return card;
    }

    function renderSchrittScreen() {
      const schritte = getSchritte(data, state.bereich);
      const idx = state.currentStepIndex;
      const schritt = schritte[idx];
      const isLastStep = idx === schritte.length - 1;
      const produkte = getProdukte(data, state.bereich, state.typKey, schritt.nummer);

      ensureLiveInfoForStep(schritt.nummer, produkte);
      const liveEntry = state.liveByStep[schritt.nummer];

      // Nicht verfügbare Produkte werden komplett herausgefiltert (nicht nur
      // ausgegraut) — der Kunde soll nur sehen, was er tatsächlich kaufen kann.
      const verfuegbareResolved = produkte
        .map((produkt, i) => getResolvedForProdukt(liveEntry, produkt, i))
        .filter((resolved) => resolved.istVerfuegbar !== false);

      if (verfuegbareResolved.length === 0) {
        // Kein einziges Produkt in diesem Schritt verfügbar (oder der Schritt
        // hatte ohnehin keine Empfehlung hinterlegt) — Schritt automatisch
        // überspringen statt eine leere Ansicht zu zeigen. Richtung (vor/
        // zurück) wird beibehalten, damit "Zurück" nicht ins Bouncen gerät.
        if (state.stepDirection === 'backward') {
          if (idx === 0) {
            update({ screen: 'typ', typKey: null });
          } else {
            update({ currentStepIndex: idx - 1 });
          }
        } else if (isLastStep) {
          update({ screen: 'zusammenfassung' });
        } else {
          update({ currentStepIndex: idx + 1 });
        }
        return;
      }

      clear(container);
      const meta = BEREICH_META[state.bereich];
      applyAccentClass(meta.accentClass);

      container.appendChild(
        renderTopBar(true, () => {
          if (idx === 0) {
            update({ screen: 'typ', typKey: null });
          } else {
            update({ currentStepIndex: idx - 1, stepDirection: 'backward' });
          }
        })
      );
      container.appendChild(renderProgress(schritte, idx));
      container.appendChild(
        el('h2', { text: 'Schritt ' + (idx + 1) + ' von ' + schritte.length + ': ' + schritt.titel })
      );

      const grid = el('div', { className: 'wizard-produkt-grid' });
      verfuegbareResolved.forEach((resolved) => {
        grid.appendChild(renderProduktCard(schritt.nummer, resolved.produkt, resolved));
      });
      container.appendChild(grid);

      const hasSelection = !!state.selections[schritt.nummer];

      const nav = el('div', { className: 'wizard-nav-row' });
      nav.appendChild(
        el('button', {
          className: 'wizard-button-primary',
          attrs: { type: 'button' },
          text: isLastStep ? 'Zur Zusammenfassung' : hasSelection ? 'Weiter' : 'Überspringen',
          onClick: () => {
            if (isLastStep) {
              update({ screen: 'zusammenfassung', stepDirection: 'forward' });
            } else {
              update({ currentStepIndex: idx + 1, stepDirection: 'forward' });
            }
          },
        })
      );
      container.appendChild(nav);
    }

    function renderZusammenfassung() {
      clear(container);
      const meta = BEREICH_META[state.bereich];
      applyAccentClass(meta.accentClass);

      container.appendChild(
        renderTopBar(true, () =>
          update({
            screen: 'schritt',
            currentStepIndex: getSchritte(data, state.bereich).length - 1,
            stepDirection: 'backward',
          })
        )
      );
      container.appendChild(el('h2', { text: 'Deine Auswahl' }));

      const schritte = getSchritte(data, state.bereich);
      const list = el('div', { className: 'wizard-summary-list' });
      let total = 0;

      schritte.forEach((schritt) => {
        const selection = state.selections[schritt.nummer];
        const item = el('div', { className: 'wizard-summary-item' });
        item.appendChild(el('div', { className: 'wizard-summary-item-titel', text: schritt.titel }));
        if (selection) {
          const produkt = selection.produkt;
          total += parseFloat(produkt.preis_eur) || 0;
          item.appendChild(el('div', { text: produkt.shop_name + ' — ' + formatPreis(produkt.preis_eur) }));
          item.appendChild(renderCartButton(selection.sku, selection.ecwidId));
        } else {
          item.appendChild(el('div', { className: 'wizard-summary-item-skipped', text: 'Übersprungen' }));
        }
        list.appendChild(item);
      });

      container.appendChild(list);
      container.appendChild(
        el('div', { className: 'wizard-summary-total', text: 'Gesamt: ' + preisFormatter.format(total) })
      );

      const nav = el('div', { className: 'wizard-nav-row' });
      nav.appendChild(
        el('button', {
          className: 'wizard-button-secondary',
          attrs: { type: 'button' },
          text: 'Neu starten',
          onClick: resetToStart,
        })
      );
      if (mountOptions.overlay && mountOptions.onClose) {
        nav.appendChild(
          el('button', {
            className: 'wizard-button-primary',
            attrs: { type: 'button' },
            text: 'Fertig',
            onClick: mountOptions.onClose,
          })
        );
      }
      container.appendChild(nav);
    }

    function render() {
      switch (state.screen) {
        case 'bereich':
          renderBereichScreen();
          break;
        case 'typ':
          renderTypScreen();
          break;
        case 'schritt':
          renderSchrittScreen();
          break;
        case 'zusammenfassung':
          renderZusammenfassung();
          break;
        default:
          renderBereichScreen();
      }
    }

    render();
  }

  // ---------------------------------------------------------------------
  // mount — erkennt Einstiegspunkt: Inline-Container (Beautyfinder-Seite)
  // oder schwebender Auslöser-Button + Overlay (Standardfall, jede Seite)
  // ---------------------------------------------------------------------

  const INLINE_CONTAINER_ID = 'produkt-finder-wizard-inline';

  function mount() {
    const inlineContainer = document.getElementById(INLINE_CONTAINER_ID);

    if (inlineContainer) {
      renderWizardInto(inlineContainer, { overlay: false });
      return;
    }

    injectFloatingTrigger();
  }

  function injectFloatingTrigger() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'produkt-finder-wizard-trigger';
    button.className = 'wizard-floating-trigger';
    button.textContent = 'Beautyfinder';

    button.addEventListener('click', openOverlay);

    document.body.appendChild(button);
  }

  let overlayEl = null;

  function openOverlay() {
    if (overlayEl) {
      overlayEl.classList.add('wizard-overlay--open');
      return;
    }

    overlayEl = document.createElement('div');
    overlayEl.id = 'produkt-finder-wizard-overlay';
    overlayEl.className = 'wizard-overlay wizard-overlay--open';
    document.body.appendChild(overlayEl);

    const mountPoint = document.createElement('div');
    mountPoint.className = 'wizard-overlay-content';
    overlayEl.appendChild(mountPoint);

    renderWizardInto(mountPoint, { overlay: true, onClose: closeOverlay });
  }

  function closeOverlay() {
    if (overlayEl) {
      overlayEl.classList.remove('wizard-overlay--open');
    }
  }

  function renderWizardInto(container, options) {
    container.classList.add('wizard-container');
    container.textContent = 'Produkt-Finder-Wizard lädt …';

    loadData()
      .then((data) => {
        createWizard(container, data, options);
      })
      .catch(() => {
        container.textContent =
          'Der Produkt-Finder ist gerade nicht verfügbar. Bitte später erneut versuchen.';
      });
  }

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // Für lokales Testen über index.html zugänglich machen.
  window.__produktFinderWizard = { config, loadData };
})();
