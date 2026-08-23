const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFulfilArgs } = require('../dist/cli-fulfil.js');

test('parseFulfilArgs: parses --order and --store', () => {
  const config = parseFulfilArgs(['--order', '9928', '--store', 'PS']);
  assert.equal(config.order, '9928');
  assert.equal(config.store, 'PS');
});

test('parseFulfilArgs: --store defaults to US when omitted', () => {
  const config = parseFulfilArgs(['--order', '9928']);
  assert.equal(config.store, 'US');
});

test('parseFulfilArgs: --help short-circuits without requiring --order', () => {
  const config = parseFulfilArgs(['--help']);
  assert.equal(config.help, true);
});

test('parseFulfilArgs: throws when --order is missing', () => {
  assert.throws(() => parseFulfilArgs(['--store', 'US']), /--order is required/);
});

test('parseFulfilArgs: throws on an invalid --store value', () => {
  assert.throws(() => parseFulfilArgs(['--order', '9928', '--store', 'AU']), /--store must be US or PS/);
});

test('parseFulfilArgs: throws on an unknown argument', () => {
  assert.throws(() => parseFulfilArgs(['--order', '9928', '--bogus']), /Unknown argument/);
});
