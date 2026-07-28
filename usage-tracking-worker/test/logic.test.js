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
