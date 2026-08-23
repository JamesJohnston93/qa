const test = require('node:test');
const assert = require('node:assert/strict');
const {
  US_STORE_LOCATIONS,
  PS_STORE_LOCATIONS,
  storeLocationsFor,
  shopifyLocationForStoreNumber,
} = require('../dist/locations.js');

test('storeLocationsFor returns the right table per store', () => {
  assert.equal(storeLocationsFor('US'), US_STORE_LOCATIONS);
  assert.equal(storeLocationsFor('PS'), PS_STORE_LOCATIONS);
});

test('shopifyLocationForStoreNumber resolves WEB_DC (ATP#100) to a real GID per store', () => {
  assert.equal(shopifyLocationForStoreNumber('US', '100'), US_STORE_LOCATIONS['100']);
  assert.equal(shopifyLocationForStoreNumber('PS', '100'), PS_STORE_LOCATIONS['100']);
});

test('shopifyLocationForStoreNumber resolves the brand-specific branch store (CHERMSIDE_US/PS_STORE)', () => {
  assert.equal(shopifyLocationForStoreNumber('US', '407'), US_STORE_LOCATIONS['407']);
  assert.equal(shopifyLocationForStoreNumber('PS', '640'), PS_STORE_LOCATIONS['640']);
});

test('shopifyLocationForStoreNumber throws on an unmapped store number instead of returning undefined', () => {
  assert.throws(
    () => shopifyLocationForStoreNumber('US', '999'),
    /No known Shopify location GID for US store number "999"/,
  );
});

test('WEB_DC and STORE_99 resolve to a DIFFERENT GID per store — live finding, TAA-38: each shop has its own local GID for these two shared DC facilities, so US and PS must never share one lookup table', () => {
  assert.notEqual(US_STORE_LOCATIONS['100'], PS_STORE_LOCATIONS['100']);
  assert.notEqual(US_STORE_LOCATIONS['99'], PS_STORE_LOCATIONS['99']);
});

test('WEB_DC (ATP#100) and STORE_99 (ATP#99) are genuinely different Shopify locations within the same store (not an accidental alias)', () => {
  assert.notEqual(US_STORE_LOCATIONS['100'], US_STORE_LOCATIONS['99']);
  assert.notEqual(PS_STORE_LOCATIONS['100'], PS_STORE_LOCATIONS['99']);
});
