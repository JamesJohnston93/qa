const test = require('node:test');
const assert = require('node:assert/strict');
const {
  US_VARIANTS,
  PS_VARIANTS,
  US_SKU_ORDER,
  PS_SKU_ORDER,
  skuPoolFor,
} = require('../dist/variants.js');

test('US_SKU_ORDER/PS_SKU_ORDER have exactly 80 entries (TAA-46 slice C)', () => {
  assert.equal(US_SKU_ORDER.length, 80);
  assert.equal(PS_SKU_ORDER.length, 80);
});

test('US_SKU_ORDER.length matches Object.keys(US_VARIANTS).length, same for PS', () => {
  assert.equal(US_SKU_ORDER.length, Object.keys(US_VARIANTS).length);
  assert.equal(PS_SKU_ORDER.length, Object.keys(PS_VARIANTS).length);
});

test('every entry in US_SKU_ORDER exists as a key in US_VARIANTS', () => {
  for (const sku of US_SKU_ORDER) {
    assert.ok(sku in US_VARIANTS, `${sku} missing from US_VARIANTS`);
  }
});

test('every entry in PS_SKU_ORDER exists as a key in PS_VARIANTS', () => {
  for (const sku of PS_SKU_ORDER) {
    assert.ok(sku in PS_VARIANTS, `${sku} missing from PS_VARIANTS`);
  }
});

test('sku(i) resolves to a non-empty GID for every i in 0..79, both stores', () => {
  for (const store of ['US', 'PS']) {
    const pool = skuPoolFor(store);
    const variants = store === 'US' ? US_VARIANTS : PS_VARIANTS;
    for (let i = 0; i < 80; i++) {
      const sku = pool[i % pool.length];
      const gid = variants[sku];
      assert.ok(typeof gid === 'string' && gid.startsWith('gid://shopify/ProductVariant/'), `slot ${i} (${store}) did not resolve to a real GID`);
    }
  }
});

test('no duplicate SKUs within US_SKU_ORDER or PS_SKU_ORDER', () => {
  assert.equal(new Set(US_SKU_ORDER).size, US_SKU_ORDER.length);
  assert.equal(new Set(PS_SKU_ORDER).size, PS_SKU_ORDER.length);
});

test('slots 0-13 are unchanged from the pre-TAA-46 pool (existing cases must not move)', () => {
  const usOriginal14 = [
    '32625134', '32357875', '33006246', '33660301', '33413679',
    '33898889', '33992457', '33788579', '34023587', '33946269',
    '33837352', '33773452', '33819099', '33775371',
  ];
  const psOriginal14 = [
    '33203669', '33801421', '34012956', '33487854', '34013038',
    '33975283', '33948010', '34061343', '33997759', '33948256',
    '34013458', '33790626', '33933542', '33950419',
  ];
  assert.deepEqual(US_SKU_ORDER.slice(0, 14), usOriginal14);
  assert.deepEqual(PS_SKU_ORDER.slice(0, 14), psOriginal14);
});
