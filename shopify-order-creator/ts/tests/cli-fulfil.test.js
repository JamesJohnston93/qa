const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFulfilArgs } = require('../dist/cli-fulfil.js');

test('parseFulfilArgs: parses a shipment id and repeatable --item flags', () => {
  const config = parseFulfilArgs([
    '--shipment',
    'd4948c69-af52-488a-ad5c-48ac0fc38986',
    '--item',
    'ITEM#f8f9e240-b89a-46db-92e8-1a1483249997',
    '--item',
    'ITEM#aaaa1111-b89a-46db-92e8-1a1483249997',
  ]);

  assert.equal(config.shipmentId, 'd4948c69-af52-488a-ad5c-48ac0fc38986');
  assert.deepEqual(config.itemIds, [
    'ITEM#f8f9e240-b89a-46db-92e8-1a1483249997',
    'ITEM#aaaa1111-b89a-46db-92e8-1a1483249997',
  ]);
});

test('parseFulfilArgs: --help short-circuits without requiring --shipment/--item', () => {
  const config = parseFulfilArgs(['--help']);
  assert.equal(config.help, true);
});

test('parseFulfilArgs: throws when --shipment is missing', () => {
  assert.throws(() => parseFulfilArgs(['--item', 'ITEM#abc']), /--shipment is required/);
});

test('parseFulfilArgs: throws when no --item is given', () => {
  assert.throws(() => parseFulfilArgs(['--shipment', 'abc-123']), /at least one --item is required/);
});

test('parseFulfilArgs: rejects a --shipment value that still carries the SHIPMENT# prefix', () => {
  assert.throws(
    () => parseFulfilArgs(['--shipment', 'SHIPMENT#abc-123', '--item', 'ITEM#abc']),
    /prefix stripped/,
  );
});

test('parseFulfilArgs: rejects an --item value missing the ITEM# prefix', () => {
  assert.throws(
    () => parseFulfilArgs(['--shipment', 'abc-123', '--item', 'f8f9e240-b89a-46db-92e8-1a1483249997']),
    /must retain the "ITEM#" prefix/,
  );
});
