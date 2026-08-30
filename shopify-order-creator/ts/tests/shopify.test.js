const test = require('node:test');
const assert = require('node:assert/strict');
const { ShopifyClient } = require('../dist/clients/shopify.js');

function fakeResponse(status, jsonBody, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `STATUS_${status}`,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  };
}

function withFetch(t, impl) {
  const originalFetch = global.fetch;
  global.fetch = impl;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

function withToken(t) {
  process.env.US_ACCESS_TOKEN = 'test-token';
  t.after(() => {
    delete process.env.US_ACCESS_TOKEN;
  });
}

function withPsCreds(t) {
  process.env.PS_CLIENT_ID = 'test-ps-client-id';
  process.env.PS_CLIENT_SECRET = 'test-ps-client-secret';
  t.after(() => {
    delete process.env.PS_CLIENT_ID;
    delete process.env.PS_CLIENT_SECRET;
  });
}

test('execute retries on HTTP 429 then returns the eventual success', async (t) => {
  withToken(t);
  let calls = 0;
  withFetch(t, async () => {
    calls += 1;
    if (calls < 3) {
      return fakeResponse(429, {});
    }
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('US', { throttleRetryDelaysMs: [0, 0, 0] });
  const result = await client.execute('query {}', {});
  assert.equal(calls, 3);
  assert.deepEqual(result, { data: { ok: true } });
});

test('execute honors a Retry-After header on 429 instead of the default delay', async (t) => {
  withToken(t);
  const delays = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => {
    delays.push(ms);
    return realSetTimeout(fn, 0);
  };
  t.after(() => {
    global.setTimeout = realSetTimeout;
  });

  let calls = 0;
  withFetch(t, async () => {
    calls += 1;
    if (calls === 1) {
      return fakeResponse(429, {}, { 'Retry-After': '3' });
    }
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('US', { throttleRetryDelaysMs: [999] });
  await client.execute('query {}', {});
  assert.equal(delays[0], 3000, 'should use the 3s Retry-After header, not the 999ms default');
});

test('execute retries on a GraphQL THROTTLED error then returns the eventual success', async (t) => {
  withToken(t);
  let calls = 0;
  withFetch(t, async () => {
    calls += 1;
    if (calls === 1) {
      return fakeResponse(200, { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] });
    }
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('US', { throttleRetryDelaysMs: [0, 0] });
  const result = await client.execute('query {}', {});
  assert.equal(calls, 2);
  assert.deepEqual(result, { data: { ok: true } });
});

test('execute exhausts retries and throws a clear error on persistent 429', async (t) => {
  withToken(t);
  withFetch(t, async () => fakeResponse(429, {}));

  const client = new ShopifyClient('US', { throttleRetryDelaysMs: [0, 0] });
  await assert.rejects(() => client.execute('query {}', {}), /throttled \(429\) after 3 attempts/);
});

test('execute does not retry a non-throttled 5xx failure', async (t) => {
  withToken(t);
  let calls = 0;
  withFetch(t, async () => {
    calls += 1;
    return fakeResponse(500, {});
  });

  const client = new ShopifyClient('US', { throttleRetryDelaysMs: [0, 0] });
  await assert.rejects(() => client.execute('query {}', {}), /Shopify request failed: 500/);
  assert.equal(calls, 1, 'a plain 5xx should fail immediately, not be treated as a throttle');
});

test('execute does not retry a non-throttled GraphQL error', async (t) => {
  withToken(t);
  let calls = 0;
  withFetch(t, async () => {
    calls += 1;
    return fakeResponse(200, { errors: [{ message: 'Field does not exist' }] });
  });

  const client = new ShopifyClient('US', { throttleRetryDelaysMs: [0, 0] });
  const result = await client.execute('query {}', {});
  assert.equal(calls, 1);
  assert.deepEqual(result.errors, [{ message: 'Field does not exist' }]);
});

test('execute throws on a non-ok HTTP response', async (t) => {
  withToken(t);
  withFetch(t, async () => fakeResponse(500, {}));

  const client = new ShopifyClient('US');
  await assert.rejects(() => client.execute('query {}', {}), /Shopify request failed: 500/);
});

test('fetchVariantPrices returns an empty map without calling fetch for an empty input', async (t) => {
  withToken(t);
  let called = false;
  withFetch(t, async () => {
    called = true;
    return fakeResponse(200, { data: { nodes: [] } });
  });

  const client = new ShopifyClient('US');
  const prices = await client.fetchVariantPrices([]);
  assert.deepEqual(prices, {});
  assert.equal(called, false);
});

test('fetchVariantPrices maps resolved nodes by GID and silently omits null entries (unknown/deleted variant, no error)', async (t) => {
  withToken(t);
  withFetch(t, async () =>
    fakeResponse(200, {
      data: {
        nodes: [
          { id: 'gid://shopify/ProductVariant/1', price: '75.00' },
          null,
        ],
      },
    }),
  );

  const client = new ShopifyClient('US');
  const prices = await client.fetchVariantPrices(['gid://shopify/ProductVariant/1', 'gid://shopify/ProductVariant/2']);
  assert.deepEqual(prices, { 'gid://shopify/ProductVariant/1': 75 });
});

test('fetchVariantPrices surfaces a top-level GraphQL errors array instead of silently treating it as "not found"', async (t) => {
  withToken(t);
  withFetch(t, async () =>
    fakeResponse(200, {
      data: { nodes: [null] },
      errors: [
        {
          message: 'Access denied for ProductVariant object. Required access: `read_products` access scope.',
          extensions: { code: 'ACCESS_DENIED' },
        },
      ],
    }),
  );

  const client = new ShopifyClient('US');
  await assert.rejects(
    () => client.fetchVariantPrices(['gid://shopify/ProductVariant/1']),
    /ACCESS_DENIED/,
  );
});

test('fetchVariantPrices throws if the response has no data at all', async (t) => {
  withToken(t);
  withFetch(t, async () => fakeResponse(200, {}));

  const client = new ShopifyClient('US');
  await assert.rejects(
    () => client.fetchVariantPrices(['gid://shopify/ProductVariant/1']),
    /returned no data/,
  );
});

test('PS execute obtains an OAuth token via the client-credentials grant before calling the GraphQL endpoint', async (t) => {
  withPsCreds(t);
  let capturedTokenUrl;
  let capturedTokenInit;
  withFetch(t, async (url, init) => {
    if (String(url).includes('/admin/oauth/access_token')) {
      capturedTokenUrl = String(url);
      capturedTokenInit = init;
      return fakeResponse(200, { access_token: 'ps-tok-1', expires_in: 86399 });
    }
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('PS');
  await client.execute('query {}', {});

  assert.match(capturedTokenUrl, /^https:\/\/perfect-stranger-staging\.myshopify\.com\/admin\/oauth\/access_token$/);
  assert.equal(capturedTokenInit.method, 'POST');
  assert.equal(capturedTokenInit.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(capturedTokenInit.body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'test-ps-client-id');
  assert.equal(body.get('client_secret'), 'test-ps-client-secret');
});

test('PS execute caches the OAuth token across calls instead of refetching it', async (t) => {
  withPsCreds(t);
  let tokenCallCount = 0;
  withFetch(t, async (url) => {
    if (String(url).includes('/admin/oauth/access_token')) {
      tokenCallCount += 1;
      return fakeResponse(200, { access_token: 'ps-tok', expires_in: 86399 });
    }
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('PS');
  await client.execute('query {}', {});
  await client.execute('query {}', {});

  assert.equal(tokenCallCount, 1, 'a still-valid PS token should be reused, not refetched');
});

test('PS execute refetches the token once it is within the pre-expiry refresh buffer', async (t) => {
  withPsCreds(t);
  let tokenCallCount = 0;
  withFetch(t, async (url) => {
    if (String(url).includes('/admin/oauth/access_token')) {
      tokenCallCount += 1;
      // expires_in is well under the refresh buffer, so every call sees a
      // token that's already "about to expire" and must refetch.
      return fakeResponse(200, { access_token: `ps-tok-${tokenCallCount}`, expires_in: 10 });
    }
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('PS');
  await client.execute('query {}', {});
  await client.execute('query {}', {});

  assert.equal(tokenCallCount, 2, 'a PS token inside the refresh buffer should be refetched, not reused');
});

test('PS execute throws immediately when PS_CLIENT_ID/PS_CLIENT_SECRET are missing, without calling fetch', async (t) => {
  let called = false;
  withFetch(t, async () => {
    called = true;
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('PS');
  await assert.rejects(
    () => client.execute('query {}', {}),
    /Missing PS_CLIENT_ID\/PS_CLIENT_SECRET/,
  );
  assert.equal(called, false);
});

test('PS execute surfaces a failed OAuth token request with the response body', async (t) => {
  withPsCreds(t);
  withFetch(t, async (url) => {
    if (String(url).includes('/admin/oauth/access_token')) {
      return fakeResponse(401, { error: 'invalid_client' });
    }
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('PS');
  await assert.rejects(
    () => client.execute('query {}', {}),
    /PS OAuth token request failed: 401/,
  );
});

test('US execute is unaffected by PS OAuth and still uses the static US_ACCESS_TOKEN', async (t) => {
  withToken(t);
  let capturedHeaders;
  withFetch(t, async (url, init) => {
    capturedHeaders = init.headers;
    return fakeResponse(200, { data: { ok: true } });
  });

  const client = new ShopifyClient('US');
  await client.execute('query {}', {});

  assert.equal(capturedHeaders['X-Shopify-Access-Token'], 'test-token');
});

test('findOrderIdTailByName returns the numeric tail of the matched order\'s gid', async (t) => {
  withToken(t);
  let capturedVariables;
  withFetch(t, async (url, init) => {
    capturedVariables = JSON.parse(init.body).variables;
    return fakeResponse(200, {
      data: { orders: { edges: [{ node: { id: 'gid://shopify/Order/7772060320017' } }] } },
    });
  });

  const client = new ShopifyClient('US');
  const tail = await client.findOrderIdTailByName('#9928');

  assert.equal(tail, '7772060320017');
  assert.equal(capturedVariables.query, 'name:#9928');
});

test('findOrderIdTailByName returns null when no order matches', async (t) => {
  withToken(t);
  withFetch(t, async () => fakeResponse(200, { data: { orders: { edges: [] } } }));

  const client = new ShopifyClient('US');
  const tail = await client.findOrderIdTailByName('#nope');

  assert.equal(tail, null);
});

test('findOrderIdTailByName surfaces a GraphQL error instead of returning null', async (t) => {
  withToken(t);
  withFetch(t, async () => fakeResponse(200, { errors: [{ message: 'boom' }] }));

  const client = new ShopifyClient('US');
  await assert.rejects(() => client.findOrderIdTailByName('#9928'), /order lookup by name failed/);
});

// --- createDraftOrder: delivery shapes (TAA-68) -------------------------------
//
// Pins both the default/rate flow (must keep working unchanged) and the
// pickup flow's replacement two-step shape, per tests/reject.test.js's
// pinning precedent. TAA-50 confirmed live that DraftOrderInput.
// deliveryMethod is entirely absent from the 2025-10 schema; these tests
// assert the draftOrderCreate payload never sends it and that both flows
// converge on the same shippingLine.shippingRateHandle shape.

const DRAFT_ORDER_LINE_ITEMS = [{ variantId: 'gid://shopify/ProductVariant/1', quantity: 1 }];

function routeGql(t, handlers) {
  const calls = [];
  withFetch(t, async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    for (const [match, respond] of handlers) {
      if (body.query.includes(match)) {
        return respond(body);
      }
    }
    throw new Error(`unexpected query in test router: ${body.query}`);
  });
  return calls;
}

function findCall(calls, match) {
  return calls.find((c) => c.query.includes(match));
}

const DRAFT_ORDER_CREATE_OK = () =>
  fakeResponse(200, { data: { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/1' }, userErrors: [] } } });
const DRAFT_ORDER_COMPLETE_OK = () =>
  fakeResponse(200, {
    data: {
      draftOrderComplete: {
        draftOrder: { createdAt: '2026-01-01T00:00:00Z', order: { id: 'gid://shopify/Order/1', name: '#1' } },
        userErrors: [],
      },
    },
  });

test('createDraftOrder (no delivery override): calculates rates, creates with shippingAddress + first rate handle, no deliveryMethod', async (t) => {
  withToken(t);
  const calls = routeGql(t, [
    [
      'draftOrderCalculate',
      () =>
        fakeResponse(200, {
          data: {
            draftOrderCalculate: {
              calculatedDraftOrder: { availableShippingRates: [{ handle: 'rate-first', title: 'Standard' }] },
              userErrors: [],
            },
          },
        }),
    ],
    ['mutation draftOrderCreate', DRAFT_ORDER_CREATE_OK],
    ['draftOrderComplete', DRAFT_ORDER_COMPLETE_OK],
  ]);

  const client = new ShopifyClient('US');
  await client.createDraftOrder('qa@example.com', DRAFT_ORDER_LINE_ITEMS, 'JJQA', 'AutoUS');

  const createCall = findCall(calls, 'mutation draftOrderCreate');
  assert.deepEqual(createCall.variables.input.shippingLine, { shippingRateHandle: 'rate-first' });
  assert.ok(createCall.variables.input.shippingAddress, 'draftOrderCreate must send a shippingAddress');
  assert.equal('deliveryMethod' in createCall.variables.input, false, 'deliveryMethod must never be sent — removed from DraftOrderInput in 2025-10');
});

test('createDraftOrder (rate delivery): matches the named rate, creates with shippingAddress + matched handle, no deliveryMethod', async (t) => {
  withToken(t);
  const calls = routeGql(t, [
    [
      'draftOrderCalculate',
      (body) => {
        assert.deepEqual(body.variables.input.lineItems, DRAFT_ORDER_LINE_ITEMS);
        assert.ok(body.variables.input.shippingAddress, 'draftOrderCalculate must send a shippingAddress');
        return fakeResponse(200, {
          data: {
            draftOrderCalculate: {
              calculatedDraftOrder: {
                availableShippingRates: [
                  { handle: 'rate-standard', title: 'Standard' },
                  { handle: 'rate-express', title: 'Express' },
                ],
              },
              userErrors: [],
            },
          },
        });
      },
    ],
    ['mutation draftOrderCreate', DRAFT_ORDER_CREATE_OK],
    ['draftOrderComplete', DRAFT_ORDER_COMPLETE_OK],
  ]);

  const client = new ShopifyClient('US');
  await client.createDraftOrder('qa@example.com', DRAFT_ORDER_LINE_ITEMS, 'JJQA', 'AutoUS', { type: 'rate', title: 'Express' });

  const createCall = findCall(calls, 'mutation draftOrderCreate');
  assert.deepEqual(createCall.variables.input.shippingLine, { shippingRateHandle: 'rate-express' });
  assert.ok(createCall.variables.input.shippingAddress, 'draftOrderCreate must send a shippingAddress for the rate flow');
  assert.equal('deliveryMethod' in createCall.variables.input, false, 'deliveryMethod must never be sent — removed from DraftOrderInput in 2025-10');
});

test('createDraftOrder (pickup delivery): queries draftOrderAvailableDeliveryOptions with lineItems+shippingAddress, then creates with shippingLine handle, no deliveryMethod', async (t) => {
  withToken(t);
  const calls = routeGql(t, [
    [
      'draftOrderAvailableDeliveryOptions',
      (body) => {
        assert.deepEqual(body.variables.input.lineItems, DRAFT_ORDER_LINE_ITEMS);
        assert.ok(body.variables.input.shippingAddress, 'draftOrderAvailableDeliveryOptions must send a shippingAddress');
        assert.equal('email' in body.variables.input, false, 'DraftOrderAvailableDeliveryOptionsInput has no email field (confirmed live)');
        return fakeResponse(200, {
          data: {
            draftOrderAvailableDeliveryOptions: {
              availableLocalPickupOptions: [
                { handle: 'pickup-chermside', title: 'Universal Store Chermside' },
                { handle: 'pickup-belconnen', title: 'Universal Store Belconnen' },
              ],
            },
          },
        });
      },
    ],
    ['mutation draftOrderCreate', DRAFT_ORDER_CREATE_OK],
    ['draftOrderComplete', DRAFT_ORDER_COMPLETE_OK],
  ]);

  const client = new ShopifyClient('US');
  await client.createDraftOrder('qa@example.com', DRAFT_ORDER_LINE_ITEMS, 'JJQA', 'AutoUS', {
    type: 'pickup',
    locationName: 'Universal Store Belconnen',
  });

  const createCall = findCall(calls, 'mutation draftOrderCreate');
  assert.deepEqual(createCall.variables.input.shippingLine, { shippingRateHandle: 'pickup-belconnen' });
  assert.ok(createCall.variables.input.shippingAddress, 'draftOrderCreate must send a shippingAddress for the pickup flow too');
  assert.equal('deliveryMethod' in createCall.variables.input, false, 'deliveryMethod must never be sent — removed from DraftOrderInput in 2025-10');
});

test('createDraftOrder (pickup delivery): throws listing the actually fulfillment-eligible titles when the requested name has no match', async (t) => {
  withToken(t);
  routeGql(t, [
    [
      'draftOrderAvailableDeliveryOptions',
      () =>
        fakeResponse(200, {
          data: {
            draftOrderAvailableDeliveryOptions: {
              availableLocalPickupOptions: [{ handle: 'pickup-chermside', title: 'Universal Store Chermside' }],
            },
          },
        }),
    ],
  ]);

  const client = new ShopifyClient('US');
  await assert.rejects(
    () =>
      client.createDraftOrder('qa@example.com', DRAFT_ORDER_LINE_ITEMS, 'JJQA', 'AutoUS', {
        type: 'pickup',
        locationName: 'Universal Store Nowhere',
      }),
    /Pickup location "Universal Store Nowhere" not found.*Universal Store Chermside/s,
  );
});

test('createDraftOrder (pickup delivery): surfaces a top-level GraphQL error from draftOrderAvailableDeliveryOptions instead of treating it as "no options"', async (t) => {
  withToken(t);
  withFetch(t, async () => fakeResponse(200, { errors: [{ message: 'boom' }] }));

  const client = new ShopifyClient('US');
  await assert.rejects(
    () =>
      client.createDraftOrder('qa@example.com', DRAFT_ORDER_LINE_ITEMS, 'JJQA', 'AutoUS', {
        type: 'pickup',
        locationName: 'Anywhere',
      }),
    /draftOrderAvailableDeliveryOptions failed/,
  );
});

test('createDraftOrder (pickup delivery): surfaces a draftOrderCreate userErrors failure (e.g. a stale/invalid shippingRateHandle) instead of completing', async (t) => {
  withToken(t);
  routeGql(t, [
    [
      'draftOrderAvailableDeliveryOptions',
      () =>
        fakeResponse(200, {
          data: {
            draftOrderAvailableDeliveryOptions: {
              availableLocalPickupOptions: [{ handle: 'pickup-chermside', title: 'Universal Store Chermside' }],
            },
          },
        }),
    ],
    [
      'mutation draftOrderCreate',
      () =>
        fakeResponse(200, {
          data: {
            draftOrderCreate: {
              draftOrder: null,
              userErrors: [{ field: ['shippingLine'], message: 'Shipping rate handle is invalid or expired' }],
            },
          },
        }),
    ],
  ]);

  const client = new ShopifyClient('US');
  await assert.rejects(
    () =>
      client.createDraftOrder('qa@example.com', DRAFT_ORDER_LINE_ITEMS, 'JJQA', 'AutoUS', {
        type: 'pickup',
        locationName: 'Universal Store Chermside',
      }),
    /draftOrderCreate failed.*Shipping rate handle is invalid or expired/s,
  );
});
