# Ecwid-Dokumentation — Referenz für Claude Code

Diese Links bitte Claude Code als Kontext mitgeben, damit es gegen die tatsächliche,
aktuelle Ecwid-API arbeitet statt gegen mögliche veraltete Trainingsannahmen.

## REST API — Produktkatalog auslesen

- Einstieg/Authentifizierung: https://docs.ecwid.com/get-started/make-your-first-api-request
- REST API Übersicht (Rate Limits etc.): https://docs.ecwid.com/api-reference
- Produkte suchen: https://docs.ecwid.com/api-reference/rest-api/products/search-products
- Einzelnes Produkt abrufen: https://docs.ecwid.com/api-reference/rest-api/products/get-product
- Produktvarianten (Größen etc.): https://docs.ecwid.com/api-reference/rest-api/products/product-variations/get-product-variation

## Storefront JS API — Warenkorb-Button

- Übersicht aller JS-API-Aufrufe: https://docs.ecwid.com/api-reference/advanced/js-api-calls
- Produkt in den Warenkorb legen (Ecwid.Cart.addProduct): https://docs.ecwid.com/storefronts/manage-cart-and-checkout/add-product-to-the-cart
- Warenkorb-Details auslesen: https://docs.ecwid.com/storefronts/manage-cart-and-checkout/get-cart-details
- Storefronts allgemein/Einstieg: https://docs.ecwid.com/storefronts
- Quickstart: Storefront mit JS API anpassen: https://docs.ecwid.com/storefronts/get-started/quickstart-customize-storefront-with-ecwid-js-api

## Wichtiger Hinweis aus der Quickstart-Doku

Die Quickstart-Anleitung erwähnt, dass für ein selbst gehostetes JS-Skript (also unseren
Fall mit GitHub Pages) unter Umständen ein "App-Update" beim Ecwid-API-Support angefragt
werden muss, damit das Skript zuverlässig auf jeder Seite geladen wird — nicht nur das
Eintragen der URL im Feld "Benutzerdefinierte JS-URL" selbst. Das sollten wir vor dem
produktiven Einsatz gegenchecken, notfalls direkt beim Ecwid-Support nachfragen, ob für
die Custom Apps "Produkt Finder Wizard" (Hauptshop und Member-Shop) noch ein zusätzlicher
Freischaltschritt nötig ist.

## Für den geplanten Live-Verfügbarkeits-Check

- Produktsuche nach SKU (für den Abgleich mit unserer produktzuordnung.json):
  selber Endpunkt wie oben ("Produkte suchen"), Parameter `sku`
- Für den Live-Check im Browser: unbedingt das **öffentliche** Token verwenden
  (siehe Abschnitt "About Ecwid REST API" zu public tokens), nie das geheime Token
  im ausgelieferten Skript verbauen: https://docs.ecwid.com/api-reference/rest-api
