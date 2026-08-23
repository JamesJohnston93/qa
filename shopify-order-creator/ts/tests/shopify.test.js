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
