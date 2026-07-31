const test = require('node:test');
const assert = require('node:assert/strict');
const { ShopifyClient } = require('../dist/clients/shopify.js');

function fakeResponse(status, jsonBody) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `STATUS_${status}`,
    json: async () => jsonBody,
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
