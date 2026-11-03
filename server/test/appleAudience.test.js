import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceAllowed } from '../src/auth/apple.js';

test('audience must match the bundle id exactly', () => {
  assert.equal(audienceAllowed('com.kvuua.marketapp', ['com.kvuua.marketapp']), true);
  assert.equal(audienceAllowed('com.kvuua.marketapp', ['com.marketapp.store']), false);
  assert.equal(audienceAllowed('COM.KVUUA.MARKETAPP', ['com.kvuua.marketapp']), false);
  assert.equal(audienceAllowed(' com.kvuua.marketapp ', ['com.kvuua.marketapp']), true);
});

test('audience accepts the comma-separated production + simulator list', () => {
  const allowed = 'com.kvuua.marketapp, com.marketapp.store';
  assert.equal(audienceAllowed('com.kvuua.marketapp', allowed), true);
  assert.equal(audienceAllowed('com.marketapp.store', allowed), true);
  assert.equal(audienceAllowed('com.example.other', allowed), false);
});

test('audience accepts an array claim and an empty configuration', () => {
  assert.equal(audienceAllowed(['com.kvuua.marketapp'], ['com.kvuua.marketapp']), true);
  assert.equal(audienceAllowed('anything', []), true);
  assert.equal(audienceAllowed(null, ['com.kvuua.marketapp']), false);
});
