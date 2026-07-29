import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveShopFromOrigin,
  todayBerlin,
  yesterdayBerlin,
  kvKeyForShopDate,
  KV_TTL_SECONDS,
  buildReportEmail,
} from '../src/logic.js';

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

test('resolveShopFromOrigin lehnt "constructor" als Origin ab', () => {
  assert.equal(resolveShopFromOrigin('constructor'), null);
});

test('resolveShopFromOrigin lehnt "toString" als Origin ab', () => {
  assert.equal(resolveShopFromOrigin('toString'), null);
});

test('resolveShopFromOrigin lehnt "__proto__" als Origin ab', () => {
  assert.equal(resolveShopFromOrigin('__proto__'), null);
});

test('todayBerlin formatiert als YYYY-MM-DD', () => {
  const date = new Date('2026-07-28T10:00:00Z'); // 12:00 Berlin (CEST, UTC+2)
  assert.equal(todayBerlin(date), '2026-07-28');
});

test('todayBerlin rechnet UTC-Zeit kurz vor Mitternacht korrekt in Berlin-Folgetag um', () => {
  // 23:00 UTC an einem Sommertag = 01:00 Berlin am naechsten Tag (CEST, UTC+2)
  const date = new Date('2026-07-28T23:00:00Z');
  assert.equal(todayBerlin(date), '2026-07-29');
});

test('todayBerlin behandelt Winterzeit (CET, UTC+1) korrekt, nicht mit Sommer-Offset verwechselt', () => {
  const date = new Date('2026-01-15T22:30:00Z'); // 23:30 Berlin (CET, UTC+1) - noch derselbe Tag
  assert.equal(todayBerlin(date), '2026-01-15');
});

test('yesterdayBerlin liefert den Kalendertag davor', () => {
  const date = new Date('2026-07-28T10:00:00Z');
  assert.equal(yesterdayBerlin(date), '2026-07-27');
});

test('yesterdayBerlin funktioniert ueber einen Monatswechsel hinweg', () => {
  const date = new Date('2026-08-01T10:00:00Z');
  assert.equal(yesterdayBerlin(date), '2026-07-31');
});

test('kvKeyForShopDate baut den erwarteten Schluessel', () => {
  assert.equal(kvKeyForShopDate('count', 'hauptshop', '2026-07-27'), 'count:hauptshop:2026-07-27');
});

test('kvKeyForShopDate baut unterschiedliche Schluessel fuer unterschiedliche Prefixe', () => {
  assert.equal(kvKeyForShopDate('clicks', 'hauptshop', '2026-07-27'), 'clicks:hauptshop:2026-07-27');
  assert.equal(kvKeyForShopDate('cart', 'hauptshop', '2026-07-27'), 'cart:hauptshop:2026-07-27');
});

test('KV_TTL_SECONDS entspricht 30 Tagen', () => {
  assert.equal(KV_TTL_SECONDS, 30 * 24 * 60 * 60);
});

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
