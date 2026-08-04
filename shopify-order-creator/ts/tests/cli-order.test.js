const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItems, expandSkuQuantities, parseOrderArgs } = require('../dist/cli-order.js');

// --- parseItems --------------------------------------------------------------

test('parseItems: a bare SKU implies quantity 1', () => {
  assert.deepEqual(parseItems('32625134'), { '32625134': 1 });
});

test('parseItems: SKUxQTY sets an explicit quantity', () => {
  assert.deepEqual(parseItems('32625134x2'), { '32625134': 2 });
});

test('parseItems: comma-separated list of mixed bare/explicit entries', () => {
  assert.deepEqual(parseItems('32625134x2,33006246'), { '32625134': 2, '33006246': 1 });
});

test('parseItems: duplicate SKUs sum their quantities', () => {
  assert.deepEqual(parseItems('32625134x2,32625134x3'), { '32625134': 5 });
});

test('parseItems: is case-insensitive on the "x" separator', () => {
  assert.deepEqual(parseItems('32625134X2'), { '32625134': 2 });
});

test('parseItems: tolerates whitespace and trailing commas', () => {
  assert.deepEqual(parseItems(' 32625134 x 2 , 33006246 , '), { '32625134': 2, '33006246': 1 });
});

test('parseItems: throws on an empty string', () => {
  assert.throws(() => parseItems(''), /requires at least one SKU/);
});

test('parseItems: throws on a zero quantity', () => {
  assert.throws(() => parseItems('32625134x0'), /positive integer/);
});

test('parseItems: throws on a negative quantity', () => {
  assert.throws(() => parseItems('32625134x-1'), /positive integer/);
});

test('parseItems: throws on a non-numeric quantity', () => {
  assert.throws(() => parseItems('32625134xabc'), /positive integer/);
});

test('parseItems: throws on a malformed entry with multiple separators', () => {
  assert.throws(() => parseItems('32625134x2x3'), /expected SKU or SKUxQTY/);
});

// --- expandSkuQuantities ------------------------------------------------------

test('expandSkuQuantities: expands {sku: qty} into a flat array with repeats', () => {
  const expanded = expandSkuQuantities({ '32625134': 2, '33006246': 1 });
  assert.deepEqual(expanded.filter((s) => s === '32625134').length, 2);
  assert.deepEqual(expanded.filter((s) => s === '33006246').length, 1);
  assert.equal(expanded.length, 3);
});

test('expandSkuQuantities: empty map expands to an empty array', () => {
  assert.deepEqual(expandSkuQuantities({}), []);
});

// --- parseOrderArgs: Shopify mode --------------------------------------------

test('parseOrderArgs: defaults to store US, seed standard, no delivery/email/ns', () => {
  const config = parseOrderArgs(['--items', '32625134x1']);
  assert.equal(config.store, 'US');
  assert.equal(config.seed, 'standard');
  assert.equal(config.delivery, undefined);
  assert.equal(config.email, undefined);
  assert.equal(config.ns, undefined);
  assert.deepEqual(config.items, { '32625134': 1 });
});

test('parseOrderArgs: --store PS overrides the default', () => {
  const config = parseOrderArgs(['--store', 'PS', '--items', '33203669x1']);
  assert.equal(config.store, 'PS');
});

test('parseOrderArgs: throws on an invalid --store value', () => {
  assert.throws(() => parseOrderArgs(['--store', 'UK', '--items', '32625134x1']), /--store must be US or PS/);
});

test('parseOrderArgs: throws when --items is missing', () => {
  assert.throws(() => parseOrderArgs([]), /--items is required/);
});

test('parseOrderArgs: --seed accepts each valid mode', () => {
  for (const mode of ['standard', 'split', 'zero', 'none']) {
    const config = parseOrderArgs(['--items', '32625134x1', '--seed', mode]);
    assert.equal(config.seed, mode);
  }
});

test('parseOrderArgs: throws on an invalid --seed value', () => {
  assert.throws(() => parseOrderArgs(['--items', '32625134x1', '--seed', 'bogus']), /--seed must be one of/);
});

test('parseOrderArgs: --delivery rate:<title> parses into a rate spec', () => {
  const config = parseOrderArgs(['--items', '32625134x1', '--delivery', 'rate:Standard Shipping']);
  assert.deepEqual(config.delivery, { type: 'rate', title: 'Standard Shipping' });
});

test('parseOrderArgs: --delivery pickup:<name> parses into a pickup spec', () => {
  const config = parseOrderArgs(['--items', '32625134x1', '--delivery', 'pickup:Chermside']);
  assert.deepEqual(config.delivery, { type: 'pickup', locationName: 'Chermside' });
});

test('parseOrderArgs: throws on a malformed --delivery value', () => {
  assert.throws(() => parseOrderArgs(['--items', '32625134x1', '--delivery', 'express']), /rate:<title>.*pickup:<location name>/);
});

test('parseOrderArgs: --email overrides the default customer email', () => {
  const config = parseOrderArgs(['--items', '32625134x1', '--email', 'someone@example.com']);
  assert.equal(config.email, 'someone@example.com');
});

test('parseOrderArgs: --help short-circuits before --items validation', () => {
  const config = parseOrderArgs(['--help']);
  assert.equal(config.help, true);
});

test('parseOrderArgs: throws on an unknown argument', () => {
  assert.throws(() => parseOrderArgs(['--bogus']), /Unknown argument/);
});

// --- parseOrderArgs: NewStore mode -------------------------------------------

test('parseOrderArgs: --ns sfs/otc switches to NewStore mode', () => {
  const sfs = parseOrderArgs(['--ns', 'sfs', '--items', '32625134x1']);
  assert.equal(sfs.ns, 'sfs');
  const otc = parseOrderArgs(['--ns', 'otc', '--items', '32625134x1']);
  assert.equal(otc.ns, 'otc');
});

test('parseOrderArgs: throws on an invalid --ns value', () => {
  assert.throws(() => parseOrderArgs(['--ns', 'bogus', '--items', '32625134x1']), /--ns must be sfs or otc/);
});

test('parseOrderArgs: --save-receipt is off by default, on when passed', () => {
  const withoutFlag = parseOrderArgs(['--ns', 'sfs', '--items', '32625134x1']);
  assert.equal(withoutFlag.saveReceipt, false);
  const withFlag = parseOrderArgs(['--ns', 'sfs', '--items', '32625134x1', '--save-receipt']);
  assert.equal(withFlag.saveReceipt, true);
});

test('parseOrderArgs: --ns + --email throws (NS customer identity is fixed per store)', () => {
  assert.throws(
    () => parseOrderArgs(['--ns', 'sfs', '--items', '32625134x1', '--email', 'x@example.com']),
    /--email is not supported for --ns orders/,
  );
});

test('parseOrderArgs: --ns + --delivery throws (NS orders skip Shopify shipping)', () => {
  assert.throws(
    () => parseOrderArgs(['--ns', 'sfs', '--items', '32625134x1', '--delivery', 'rate:Standard']),
    /--delivery is not supported for --ns orders/,
  );
});

test('parseOrderArgs: --ns + a non-default --seed throws (NS never touches inventory)', () => {
  assert.throws(
    () => parseOrderArgs(['--ns', 'sfs', '--items', '32625134x1', '--seed', 'zero']),
    /--seed is not supported for --ns orders/,
  );
});

test('parseOrderArgs: --ns with default --seed (standard) does not throw', () => {
  assert.doesNotThrow(() => parseOrderArgs(['--ns', 'sfs', '--items', '32625134x1']));
});
