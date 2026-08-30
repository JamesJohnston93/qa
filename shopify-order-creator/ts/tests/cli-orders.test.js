const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOrdersArgs } = require('../dist/cli-orders.js');

test('parseOrdersArgs: --store defaults to US when omitted', () => {
  const config = parseOrdersArgs([]);
  assert.equal(config.store, 'US');
  assert.equal(config.cases, undefined);
});

test('parseOrdersArgs: parses --store PS', () => {
  const config = parseOrdersArgs(['--store', 'PS']);
  assert.equal(config.store, 'PS');
});

test('parseOrdersArgs: throws on an invalid --store value', () => {
  assert.throws(() => parseOrdersArgs(['--store', 'AU']), /--store must be US or PS/);
});

test('parseOrdersArgs: --cases splits and trims a comma-separated list', () => {
  const config = parseOrdersArgs(['--cases', 'os_hold_fraud, os_hold_multi']);
  assert.deepEqual(config.cases, ['os_hold_fraud', 'os_hold_multi']);
});

test('parseOrdersArgs: --help short-circuits without requiring anything else', () => {
  const config = parseOrdersArgs(['--help']);
  assert.equal(config.help, true);
});

test('parseOrdersArgs: throws on an unknown argument', () => {
  assert.throws(() => parseOrdersArgs(['--bogus']), /Unknown argument/);
});
