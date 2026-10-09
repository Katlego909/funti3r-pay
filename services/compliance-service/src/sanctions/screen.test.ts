import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenName, screenNames } from './screen.js';

test('exact match against a listed name', () => {
  const matches = screenName('Kim Jong Un');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].distance, 0);
  assert.equal(matches[0].program, 'DPRK2');
});

test('matches case-insensitively and ignores punctuation/diacritics', () => {
  const matches = screenName('bashar al assad');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].list, 'OFAC-SDN');
});

test('near-miss typo still matches within tolerance', () => {
  const matches = screenName('Nicolass Maduro');
  assert.equal(matches.length, 1);
});

test('unrelated name produces no match', () => {
  const matches = screenName('Jane Everyday Worker');
  assert.equal(matches.length, 0);
});

test('screenNames dedupes matches shared across candidate fields', () => {
  const matches = screenNames(['Viktor Bout', 'Viktor Bout']);
  assert.equal(matches.length, 1);
});

test('synthetic QA canary matches for demo/e2e evidence', () => {
  const matches = screenName('Sanctions Test Subject');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].program, 'QA-CANARY');
});

test('an applicant who adds a middle name to a listed name is still caught', () => {
  const matches = screenName('Viktor Michael Bout');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].extraNames, 1);
});

test('a listed name buried in a much longer name is not a match', () => {
  assert.equal(screenName('Viktor Anna Maria Sofia Bout').length, 0);
});

test('a middle name never turns a different surname into a match', () => {
  assert.equal(screenName('Viktor Michael Boutros').length, 0);
});
