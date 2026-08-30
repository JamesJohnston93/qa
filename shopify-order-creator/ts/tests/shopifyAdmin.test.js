const test = require('node:test');
const assert = require('node:assert/strict');
const { ShopifyClient } = require('../dist/clients/shopify.js');
const { ShopifyAdminClient } = require('../dist/clients/shopifyAdmin.js');
const { getOrder } = require('../dist/readers/shopifyReader.js');

function fakeResponse(status, jsonBody) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `STATUS_${status}`,
    headers: { get: () => null },
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  };
}

function withToken(t) {
  process.env.US_ACCESS_TOKEN = 'test-token';
  t.after(() => {
    delete process.env.US_ACCESS_TOKEN;
  });
}

/** Queues canned GraphQL responses in call order and records each request's {query, variables}. */
function withQueuedFetch(t, responses) {
  const calls = [];
  const originalFetch = global.fetch;
  let i = 0;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, query: body.query, variables: body.variables });
    const response = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return fakeResponse(200, response);
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  return calls;
}

function client(t, responses) {
  withToken(t);
  const calls = withQueuedFetch(t, responses);
  const shopify = new ShopifyClient('US', { throttleRetryDelaysMs: [] });
  return { admin: new ShopifyAdminClient(shopify), shopify, calls };
}

// ---------------------------------------------------------------------------
// Edit chain
// ---------------------------------------------------------------------------

test('beginEdit sends the order id and maps calculatedOrder + existing line items', async (t) => {
  const { admin, calls } = client(t, [
    {
      data: {
        orderEditBegin: {
          calculatedOrder: {
            id: 'gid://shopify/CalculatedOrder/1',
            lineItems: {
              edges: [
                { node: { id: 'gid://shopify/CalculatedLineItem/1', quantity: 2, variant: { sku: '12345' } } },
                { node: { id: 'gid://shopify/CalculatedLineItem/2', quantity: 1, variant: null } },
              ],
            },
          },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.beginEdit('gid://shopify/Order/1');

  assert.deepEqual(calls[0].variables, { id: 'gid://shopify/Order/1' });
  assert.match(calls[0].query, /orderEditBegin/);
  assert.deepEqual(result, {
    calculatedOrderId: 'gid://shopify/CalculatedOrder/1',
    lineItems: [
      { id: 'gid://shopify/CalculatedLineItem/1', quantity: 2, sku: '12345' },
      { id: 'gid://shopify/CalculatedLineItem/2', quantity: 1, sku: null },
    ],
  });
});

test('beginEdit throws on userErrors without calling anything further', async (t) => {
  const { admin } = client(t, [
    { data: { orderEditBegin: { calculatedOrder: null, userErrors: [{ field: ['id'], message: 'not found' }] } } },
  ]);

  await assert.rejects(() => admin.beginEdit('gid://shopify/Order/1'), /orderEditBegin failed/);
});

test('beginEdit throws (no fallback id) when calculatedOrder is null with no userErrors', async (t) => {
  const { admin } = client(t, [{ data: { orderEditBegin: { calculatedOrder: null, userErrors: [] } } }]);

  await assert.rejects(() => admin.beginEdit('gid://shopify/Order/1'), /returned no calculatedOrder/);
});

test('editAddVariant pins the id/variantId/quantity variables and maps the result', async (t) => {
  const { admin, calls } = client(t, [
    {
      data: {
        orderEditAddVariant: {
          calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/9', quantity: 3 },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.editAddVariant('gid://shopify/CalculatedOrder/1', 'gid://shopify/ProductVariant/1', 3);

  assert.deepEqual(calls[0].variables, {
    id: 'gid://shopify/CalculatedOrder/1',
    variantId: 'gid://shopify/ProductVariant/1',
    quantity: 3,
  });
  assert.match(calls[0].query, /orderEditAddVariant/);
  assert.deepEqual(result, { calculatedLineItemId: 'gid://shopify/CalculatedLineItem/9', quantity: 3 });
});

test('editSetQuantity pins the id/lineItemId/quantity variables and maps editableQuantity', async (t) => {
  const { admin, calls } = client(t, [
    {
      data: {
        orderEditSetQuantity: {
          calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/1', quantity: 1, editableQuantity: 1 },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.editSetQuantity('gid://shopify/CalculatedOrder/1', 'gid://shopify/CalculatedLineItem/1', 1);

  assert.deepEqual(calls[0].variables, {
    id: 'gid://shopify/CalculatedOrder/1',
    lineItemId: 'gid://shopify/CalculatedLineItem/1',
    quantity: 1,
  });
  assert.match(calls[0].query, /orderEditSetQuantity/);
  assert.deepEqual(result, { calculatedLineItemId: 'gid://shopify/CalculatedLineItem/1', quantity: 1, editableQuantity: 1 });
});

test('editAddDiscount pins the fixedValue discount input shape', async (t) => {
  const { admin, calls } = client(t, [
    { data: { orderEditAddLineItemDiscount: { calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/9' }, userErrors: [] } } },
  ]);

  const result = await admin.editAddDiscount('gid://shopify/CalculatedOrder/1', 'gid://shopify/CalculatedLineItem/9', {
    description: 'discount',
    fixedValue: { amount: '1.00', currencyCode: 'AUD' },
  });

  assert.deepEqual(calls[0].variables, {
    id: 'gid://shopify/CalculatedOrder/1',
    lineItemId: 'gid://shopify/CalculatedLineItem/9',
    discount: { description: 'discount', fixedValue: { amount: '1.00', currencyCode: 'AUD' } },
  });
  assert.match(calls[0].query, /orderEditAddLineItemDiscount/);
  assert.deepEqual(result, { calculatedLineItemId: 'gid://shopify/CalculatedLineItem/9' });
});

test('commitEdit sends notifyCustomer:false baked into the mutation string, staffNote defaulting to null, and maps the committed order', async (t) => {
  const { admin, calls } = client(t, [
    { data: { orderEditCommit: { order: { id: 'gid://shopify/Order/1', name: '#9999', edited: true }, userErrors: [] } } },
  ]);

  const result = await admin.commitEdit('gid://shopify/CalculatedOrder/1');

  assert.deepEqual(calls[0].variables, { id: 'gid://shopify/CalculatedOrder/1', staffNote: null });
  assert.match(calls[0].query, /notifyCustomer:\s*false/);
  assert.deepEqual(result, { orderId: 'gid://shopify/Order/1', orderName: '#9999', edited: true });
});

// ---------------------------------------------------------------------------
// createRefund
// ---------------------------------------------------------------------------

test('createRefund (targeted) pins refundLineItems shape, defaulting restockType to NO_RESTOCK', async (t) => {
  const { admin, calls } = client(t, [
    {
      data: {
        refundCreate: {
          order: { id: 'gid://shopify/Order/1' },
          refund: { id: 'gid://shopify/Refund/1', totalRefundedSet: { shopMoney: { amount: '10.00', currencyCode: 'AUD' } } },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.createRefund('gid://shopify/Order/1', [{ lineItemId: 'gid://shopify/LineItem/1', quantity: 1 }]);

  assert.equal(calls.length, 1, 'targeted refund never resolves a SALE transaction');
  assert.deepEqual(calls[0].variables, {
    input: {
      orderId: 'gid://shopify/Order/1',
      note: 'TAA-55 admin client — targeted refund',
      notify: false,
      refundLineItems: [{ lineItemId: 'gid://shopify/LineItem/1', quantity: 1, restockType: 'NO_RESTOCK' }],
    },
  });
  assert.deepEqual(result, {
    refundId: 'gid://shopify/Refund/1',
    orderId: 'gid://shopify/Order/1',
    totalRefunded: 10,
    currencyCode: 'AUD',
  });
});

test('createRefund (untargeted, lineItems omitted) resolves the SALE transaction first, then builds the transactions[] input', async (t) => {
  const { admin, calls } = client(t, [
    { data: { order: { transactions: [{ id: 'gid://shopify/OrderTransaction/1', kind: 'SALE', gateway: 'bogus' }] } } },
    {
      data: {
        refundCreate: {
          order: { id: 'gid://shopify/Order/1' },
          refund: { id: 'gid://shopify/Refund/2', totalRefundedSet: { shopMoney: { amount: '1.00', currencyCode: 'AUD' } } },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.createRefund('gid://shopify/Order/1', undefined, '1.00');

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].variables, { id: 'gid://shopify/Order/1' });
  assert.match(calls[0].query, /OrderSaleTransaction/);
  assert.deepEqual(calls[1].variables, {
    input: {
      orderId: 'gid://shopify/Order/1',
      note: 'TAA-55 admin client — untargeted/appeasement refund',
      notify: false,
      transactions: [
        { orderId: 'gid://shopify/Order/1', amount: '1.00', gateway: 'bogus', kind: 'REFUND', parentId: 'gid://shopify/OrderTransaction/1' },
      ],
    },
  });
  assert.deepEqual(result, {
    refundId: 'gid://shopify/Refund/2',
    orderId: 'gid://shopify/Order/1',
    totalRefunded: 1,
    currencyCode: 'AUD',
  });
});

test('createRefund throws without firing any request when lineItems is omitted and untargetedAmount is missing', async (t) => {
  const { admin, calls } = client(t, []);

  await assert.rejects(() => admin.createRefund('gid://shopify/Order/1'), /untargetedAmount is required/);
  assert.equal(calls.length, 0);
});

test('createRefund throws on userErrors (with code shape) without a fallback refund id', async (t) => {
  const { admin } = client(t, [
    { data: { refundCreate: { order: null, refund: null, userErrors: [{ field: ['refundLineItems'], message: 'bad quantity' }] } } },
  ]);

  await assert.rejects(
    () => admin.createRefund('gid://shopify/Order/1', [{ lineItemId: 'gid://shopify/LineItem/1', quantity: 99 }]),
    /refundCreate failed/,
  );
});

// ---------------------------------------------------------------------------
// Fulfillment-order hold / release / move
// ---------------------------------------------------------------------------

test('holdFulfillmentOrder pins the FulfillmentOrderHoldInput shape with notifyMerchant hardcoded false', async (t) => {
  const { admin, calls } = client(t, [
    {
      data: {
        fulfillmentOrderHold: {
          fulfillmentHold: { id: 'gid://shopify/FulfillmentHold/1', reason: 'HIGH_RISK_OF_FRAUD', reasonNotes: 'probe hold' },
          fulfillmentOrder: { id: 'gid://shopify/FulfillmentOrder/1', status: 'ON_HOLD' },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.holdFulfillmentOrder('gid://shopify/FulfillmentOrder/1', 'HIGH_RISK_OF_FRAUD', 'probe hold');

  assert.deepEqual(calls[0].variables, {
    id: 'gid://shopify/FulfillmentOrder/1',
    fulfillmentHold: { reason: 'HIGH_RISK_OF_FRAUD', reasonNotes: 'probe hold', notifyMerchant: false },
  });
  assert.deepEqual(result, {
    fulfillmentHoldId: 'gid://shopify/FulfillmentHold/1',
    fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
    status: 'ON_HOLD',
  });
});

test('releaseHold pins the bare id variable', async (t) => {
  const { admin, calls } = client(t, [
    {
      data: {
        fulfillmentOrderReleaseHold: {
          fulfillmentOrder: { id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN' },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.releaseHold('gid://shopify/FulfillmentOrder/1');

  assert.deepEqual(calls[0].variables, { id: 'gid://shopify/FulfillmentOrder/1' });
  assert.deepEqual(result, { fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN' });
});

test('moveFulfillmentOrder pins id/newLocationId and maps a resolved assignedLocation', async (t) => {
  const { admin, calls } = client(t, [
    {
      data: {
        fulfillmentOrderMove: {
          movedFulfillmentOrder: {
            id: 'gid://shopify/FulfillmentOrder/2',
            status: 'OPEN',
            assignedLocation: { location: { id: 'gid://shopify/Location/1' } },
          },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.moveFulfillmentOrder('gid://shopify/FulfillmentOrder/1', 'gid://shopify/Location/1');

  assert.deepEqual(calls[0].variables, { id: 'gid://shopify/FulfillmentOrder/1', newLocationId: 'gid://shopify/Location/1' });
  assert.deepEqual(result, { movedFulfillmentOrderId: 'gid://shopify/FulfillmentOrder/2', status: 'OPEN', locationId: 'gid://shopify/Location/1' });
});

test('moveFulfillmentOrder surfaces a null locationId rather than crashing when assignedLocation is absent', async (t) => {
  const { admin } = client(t, [
    {
      data: {
        fulfillmentOrderMove: {
          movedFulfillmentOrder: { id: 'gid://shopify/FulfillmentOrder/2', status: 'OPEN', assignedLocation: null },
          userErrors: [],
        },
      },
    },
  ]);

  const result = await admin.moveFulfillmentOrder('gid://shopify/FulfillmentOrder/1', 'gid://shopify/Location/1');
  assert.equal(result.locationId, null);
});

// ---------------------------------------------------------------------------
// Returns / markAsPaid
// ---------------------------------------------------------------------------

test('createReturn pins the ReturnInput shape, defaulting returnReason to UNWANTED', async (t) => {
  const { admin, calls } = client(t, [
    { data: { returnCreate: { return: { id: 'gid://shopify/Return/1', name: 'R1', status: 'OPEN' }, userErrors: [] } } },
  ]);

  const result = await admin.createReturn('gid://shopify/Order/1', [
    { fulfillmentLineItemId: 'gid://shopify/FulfillmentLineItem/1', quantity: 1 },
  ]);

  assert.deepEqual(calls[0].variables, {
    returnInput: {
      orderId: 'gid://shopify/Order/1',
      returnLineItems: [{ fulfillmentLineItemId: 'gid://shopify/FulfillmentLineItem/1', quantity: 1, returnReason: 'UNWANTED' }],
    },
  });
  assert.deepEqual(result, { returnId: 'gid://shopify/Return/1', name: 'R1', status: 'OPEN' });
});

test('createReturn throws on an empty line-item list without firing any request', async (t) => {
  const { admin, calls } = client(t, []);
  await assert.rejects(() => admin.createReturn('gid://shopify/Order/1', []), /requires at least one line item/);
  assert.equal(calls.length, 0);
});

test('closeReturn pins the bare id variable and maps closedAt', async (t) => {
  const { admin, calls } = client(t, [
    { data: { returnClose: { return: { id: 'gid://shopify/Return/1', status: 'CLOSED', closedAt: '2026-08-30T00:00:00Z' }, userErrors: [] } } },
  ]);

  const result = await admin.closeReturn('gid://shopify/Return/1');

  assert.deepEqual(calls[0].variables, { id: 'gid://shopify/Return/1' });
  assert.deepEqual(result, { returnId: 'gid://shopify/Return/1', status: 'CLOSED', closedAt: '2026-08-30T00:00:00Z' });
});

test('markAsPaid pins the OrderMarkAsPaidInput shape and maps displayFinancialStatus', async (t) => {
  const { admin, calls } = client(t, [
    { data: { orderMarkAsPaid: { order: { id: 'gid://shopify/Order/1', name: '#9999', displayFinancialStatus: 'PAID' }, userErrors: [] } } },
  ]);

  const result = await admin.markAsPaid('gid://shopify/Order/1');

  assert.deepEqual(calls[0].variables, { input: { id: 'gid://shopify/Order/1' } });
  assert.deepEqual(result, { orderId: 'gid://shopify/Order/1', name: '#9999', financialStatus: 'PAID' });
});

// ---------------------------------------------------------------------------
// readers/shopifyReader.ts ORDER_QUERY extension: fulfillmentOrders
// ---------------------------------------------------------------------------

function fullOrderResponse(fulfillmentOrderEdges) {
  return {
    data: {
      node: {
        id: 'gid://shopify/Order/1',
        name: '#9999',
        displayFinancialStatus: 'PAID',
        lineItems: { edges: [] },
        refunds: [],
        fulfillments: [],
        fulfillmentOrders: { edges: fulfillmentOrderEdges },
      },
    },
  };
}

test('getOrder maps fulfillmentOrders (a real connection, unlike fulfillments) including holds', async (t) => {
  withToken(t);
  withQueuedFetch(t, [
    fullOrderResponse([
      {
        node: {
          id: 'gid://shopify/FulfillmentOrder/1',
          status: 'ON_HOLD',
          fulfillmentHolds: [{ id: 'gid://shopify/FulfillmentHold/1', reason: 'HIGH_RISK_OF_FRAUD', reasonNotes: 'probe hold' }],
        },
      },
    ]),
  ]);
  const shopify = new ShopifyClient('US', { throttleRetryDelaysMs: [] });

  const snapshot = await getOrder(shopify, 'gid://shopify/Order/1');

  assert.deepEqual(snapshot.fulfillmentOrders, [
    {
      id: 'gid://shopify/FulfillmentOrder/1',
      status: 'ON_HOLD',
      holds: [{ id: 'gid://shopify/FulfillmentHold/1', reason: 'HIGH_RISK_OF_FRAUD', reasonNotes: 'probe hold' }],
    },
  ]);
});

test('getOrder maps a fulfillment order with no holds to an empty holds array', async (t) => {
  withToken(t);
  withQueuedFetch(t, [
    fullOrderResponse([{ node: { id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN', fulfillmentHolds: [] } }]),
  ]);
  const shopify = new ShopifyClient('US', { throttleRetryDelaysMs: [] });

  const snapshot = await getOrder(shopify, 'gid://shopify/Order/1');

  assert.deepEqual(snapshot.fulfillmentOrders, [{ id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN', holds: [] }]);
});
