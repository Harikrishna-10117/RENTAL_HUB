import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from '../src/translations/messages.js';
import { translate } from '../src/translations/translate.js';

test('English, Hindi, and Tamil dictionaries define the same translation keys', () => {
  const englishKeys = Object.keys(messages.en).sort();
  assert.deepEqual(Object.keys(messages.hi).sort(), englishKeys);
  assert.deepEqual(Object.keys(messages.ta).sort(), englishKeys);
  for (const locale of ['en', 'hi', 'ta']) {
    for (const [key, value] of Object.entries(messages[locale])) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
    }
  }
});

test('important interface strings change by locale and interpolate values', () => {
  assert.equal(translate('en', 'language'), 'Language');
  assert.equal(translate('hi', 'language'), 'भाषा');
  assert.equal(translate('ta', 'language'), 'மொழி');
  assert.equal(translate('hi', 'productsAvailable', { products: 10, listings: 3 }), '10 उत्पाद · 3 उपलब्ध');
  assert.equal(translate('ta', 'productsAvailable', { products: 10, listings: 3 }), '10 தயாரிப்புகள் · 3 கிடைக்கும்');
});
