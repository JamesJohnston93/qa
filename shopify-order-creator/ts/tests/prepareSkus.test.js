const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { classifySku, formatPoolBlock, loadInput } = require("../scripts/prepare-skus.js");

test("classifySku FAILs with a distinct reason when no GID resolved", () => {
  const result = classifySku({ sku: "99999999", gid: null, title: null, price: null, realStock: null });
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /variant GID/);
  assert.equal(result.realStock, null);
});

test("classifySku FAILs on zero real stock, distinct reason from unresolved GID", () => {
  const result = classifySku({
    sku: "33174570",
    gid: "gid://shopify/ProductVariant/1",
    title: "Some Product",
    price: "10.00",
    realStock: 0,
  });
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /zero real stock/);
  assert.doesNotMatch(result.reason, /variant GID/);
});

test("classifySku PASSes on positive real stock and carries the resolved fields through", () => {
  const result = classifySku({
    sku: "33174570",
    gid: "gid://shopify/ProductVariant/1",
    title: "Some Product - Variant",
    price: "10.00",
    realStock: 42,
  });
  assert.equal(result.status, "PASS");
  assert.match(result.reason, /42/);
  assert.equal(result.gid, "gid://shopify/ProductVariant/1");
  assert.equal(result.title, "Some Product - Variant");
  assert.equal(result.price, "10.00");
});

test("classifySku treats stock summed across multiple locations, aggregate exclusion happens upstream", () => {
  // realStockFor (not pure, excluded from this test) is the layer that strips
  // AGGREGATE_LOCATIONS before summing; classifySku only sees the final number.
  const result = classifySku({ sku: "1", gid: "gid://shopify/ProductVariant/1", realStock: 3 });
  assert.equal(result.status, "PASS");
});

test("formatPoolBlock emits both halves, same order, matching variants.ts's own entry format", () => {
  const passing = [
    { sku: "111", gid: "gid://shopify/ProductVariant/1" },
    { sku: "222", gid: "gid://shopify/ProductVariant/2" },
  ];
  const block = formatPoolBlock(passing, "US");
  assert.match(block, /US_VARIANTS/);
  assert.match(block, /US_SKU_ORDER/);
  assert.match(block, /"111": "gid:\/\/shopify\/ProductVariant\/1",/);
  assert.match(block, /"222": "gid:\/\/shopify\/ProductVariant\/2",/);

  const variantsIndex = block.indexOf('"111": "gid');
  const orderIndex = block.indexOf('"111",');
  const variantsSecondIndex = block.indexOf('"222": "gid');
  const orderSecondIndex = block.indexOf('"222",');
  assert.ok(variantsIndex < variantsSecondIndex);
  assert.ok(orderIndex < orderSecondIndex);
  // Both halves declare 111 before 222 — same order in both, as required.
  assert.ok(variantsIndex < orderIndex);
});

test("formatPoolBlock uses PS_VARIANTS/PS_SKU_ORDER for the PS store", () => {
  const block = formatPoolBlock([{ sku: "1", gid: "gid://x" }], "PS");
  assert.match(block, /PS_VARIANTS/);
  assert.match(block, /PS_SKU_ORDER/);
  assert.doesNotMatch(block, /US_VARIANTS/);
});

test("formatPoolBlock throws rather than emitting an empty block", () => {
  assert.throws(() => formatPoolBlock([], "US"));
});

test("loadInput reads a plain-text list, one SKU per line, deduplicated", () => {
  const tmp = path.join(os.tmpdir(), `prepare-skus-test-${Date.now()}.txt`);
  fs.writeFileSync(tmp, "111\n222\n111\n\n333\n");
  try {
    const entries = loadInput(tmp);
    assert.deepEqual(
      entries.map((e) => e.sku),
      ["111", "222", "333"],
    );
    assert.equal(entries[0].gid, null);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("loadInput reads an already-resolved JSON list, carrying gid/title/price through", () => {
  const tmp = path.join(os.tmpdir(), `prepare-skus-test-${Date.now()}.json`);
  fs.writeFileSync(
    tmp,
    JSON.stringify([{ sku: "111", gid: "gid://shopify/ProductVariant/1", title: "T", price: "1.00" }]),
  );
  try {
    const entries = loadInput(tmp);
    assert.deepEqual(entries, [{ sku: "111", gid: "gid://shopify/ProductVariant/1", title: "T", price: "1.00" }]);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("loadInput throws on a JSON entry missing sku", () => {
  const tmp = path.join(os.tmpdir(), `prepare-skus-test-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify([{ gid: "gid://x" }]));
  try {
    assert.throws(() => loadInput(tmp));
  } finally {
    fs.unlinkSync(tmp);
  }
});
