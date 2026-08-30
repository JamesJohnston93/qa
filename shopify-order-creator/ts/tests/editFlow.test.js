const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { editSettled, waitForEditSettled, addItemToOrder, ORDERS_SERVICE_SETTLE_WINDOW_SECONDS } = require('../dist/flows/editFlow.js');
const { orderItemRowsFromRows, transactionRowsFromRows } = require('../dist/readers/dynamoReader.js');
const { DEFAULT_POLL_WINDOWS } = require('../dist/config.js');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

// Fixtures below are REAL rows captured live this ticket (TAA-57):
// US-taa57-hold-outstanding-10008.json is order #10008 (US), created with sku
// 32131659, then edited to add sku 33773476 via addItemToOrder — the exact
// edit chain this file drives. See ts/signoffs/TAA-57.md.

test('ORDERS_SERVICE_SETTLE_WINDOW_SECONDS reuses config.ts DEFAULT_POLL_WINDOWS.ordersService, not a re-invented local constant', () => {
  assert.equal(ORDERS_SERVICE_SETTLE_WINDOW_SECONDS, DEFAULT_POLL_WINDOWS.ordersService);
});

test('editSettled: true against the real order #10008 post-edit rows (new ITEM# row + ADD_ITEM row both present for the added sku)', () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const items = orderItemRowsFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.equal(editSettled(items, transactions, '33773476'), true);
});

test('editSettled: false if the ITEM# row exists but no ADD_ITEM transaction names the sku (e.g. only CREATE_ORDER has it)', () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const items = orderItemRowsFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  // 32131659 is the order's ORIGINAL sku (from CREATE_ORDER), never added via
  // an edit — proves the predicate doesn't false-positive on the order's
  // pre-existing item just because *some* itemChanges.added event exists.
  assert.equal(editSettled(items, transactions, '32131659'), false);
});

test('editSettled: false if neither the item row nor the transaction row exist yet', () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const items = orderItemRowsFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.equal(editSettled(items, transactions, '99999999'), false);
});

test('editSettled: false if the ITEM# row has landed but the ADD_ITEM transaction has not yet (intermediate state)', () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const items = orderItemRowsFromRows(rows);
  const transactions = transactionRowsFromRows(rows).filter((t) => t.event !== 'ADD_ITEM');
  assert.equal(editSettled(items, transactions, '33773476'), false);
});

// --- waitForEditSettled (fake reader — no network) --------------------------

test('waitForEditSettled: resolves via the reader, deriving items/transactions off one getOrderRows call', async () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  let calls = 0;
  const reader = {
    getOrderRows: async () => {
      calls += 1;
      return rows;
    },
  };

  const result = await waitForEditSettled(reader, 'US', '7899548811537', '33773476');

  assert.equal(calls, 1);
  assert.equal(result.value.items.some((i) => i.sku === '33773476'), true);
});

// --- addItemToOrder (fake admin/reader — no network) ------------------------

test('addItemToOrder: drives Begin -> AddVariant -> Commit (no discount) and waits for settle', async () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const calls = [];
  const admin = {
    beginEdit: async (orderId) => {
      calls.push(['beginEdit', orderId]);
      return { calculatedOrderId: 'calc1', lineItems: [] };
    },
    editAddVariant: async (calcId, variantId, quantity) => {
      calls.push(['editAddVariant', calcId, variantId, quantity]);
      return { calculatedLineItemId: 'cli1', quantity };
    },
    editAddDiscount: async () => {
      calls.push(['editAddDiscount']);
      return { calculatedLineItemId: 'cli1' };
    },
    commitEdit: async (calcId, staffNote) => {
      calls.push(['commitEdit', calcId, staffNote]);
      return { orderId: 'gid://shopify/Order/1', orderName: '#1', edited: true };
    },
  };
  const reader = { getOrderRows: async () => rows };

  const result = await addItemToOrder(
    { admin, reader },
    'US',
    'gid://shopify/Order/1',
    '7899548811537',
    'gid://shopify/ProductVariant/1',
    '33773476',
  );

  assert.deepEqual(
    calls.map((c) => c[0]),
    ['beginEdit', 'editAddVariant', 'commitEdit'],
  );
  assert.equal(result.addedSku, '33773476');
  assert.equal(result.discount, null);
  assert.equal(result.committed.edited, true);
});

test('addItemToOrder: calls editAddDiscount when a discount is supplied', async () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const calls = [];
  const admin = {
    beginEdit: async () => ({ calculatedOrderId: 'calc1', lineItems: [] }),
    editAddVariant: async () => ({ calculatedLineItemId: 'cli1', quantity: 1 }),
    editAddDiscount: async (calcId, lineItemId, discount) => {
      calls.push(['editAddDiscount', calcId, lineItemId, discount]);
      return { calculatedLineItemId: lineItemId };
    },
    commitEdit: async () => ({ orderId: 'gid://shopify/Order/1', orderName: '#1', edited: true }),
  };
  const reader = { getOrderRows: async () => rows };
  const discount = { description: 'test', fixedValue: { amount: '1.00', currencyCode: 'AUD' } };

  const result = await addItemToOrder(
    { admin, reader },
    'US',
    'gid://shopify/Order/1',
    '7899548811537',
    'gid://shopify/ProductVariant/1',
    '33773476',
    1,
    discount,
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][3], discount);
  assert.deepEqual(result.discount, { calculatedLineItemId: 'cli1' });
});
