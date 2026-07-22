const test = require('node:test');
const assert = require('node:assert/strict');
const { NewStoreClient } = require('../dist/clients/newstore.js');

function fakeResponse(status, jsonBody) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `STATUS_${status}`,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  };
}

function withCreds(t) {
  process.env.NS_STAGING_CLIENT_ID = 'test-client-id';
  process.env.NS_STAGING_CLIENT_SECRET = 'test-client-secret';
  t.after(() => {
    delete process.env.NS_STAGING_CLIENT_ID;
    delete process.env.NS_STAGING_CLIENT_SECRET;
  });
}

function withFetch(t, impl) {
  const originalFetch = global.fetch;
  global.fetch = impl;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

test('NewStoreClient caches the token across calls instead of refetching it', async (t) => {
  withCreds(t);
  const calls = [];
  withFetch(t, async (url) => {
    calls.push(String(url));
    if (String(url).includes('/protocol/openid-connect/token')) {
      return fakeResponse(200, { access_token: 'tok-1', expires_in: 300 });
    }
    return fakeResponse(200, { ok: true });
  });

  const client = new NewStoreClient();
  await client.get('/v0/d/external_orders/abc');
  await client.get('/v0/d/external_orders/def');

  const tokenCalls = calls.filter((u) => u.includes('token'));
  assert.equal(tokenCalls.length, 1, 'a still-valid token should be reused, not refetched');
  assert.equal(calls.length, 3); // 1 token fetch + 2 data calls
});

test('NewStoreClient refetches the token once it is within the 30s pre-expiry buffer', async (t) => {
  withCreds(t);
  let tokenCallCount = 0;
  withFetch(t, async (url) => {
    if (String(url).includes('token')) {
      tokenCallCount += 1;
      // expires_in is well under the 30s refresh buffer, so every call sees
      // a token that's already "about to expire" and must refetch.
      return fakeResponse(200, { access_token: `tok-${tokenCallCount}`, expires_in: 10 });
    }
    return fakeResponse(200, { ok: true });
  });

  const client = new NewStoreClient();
  await client.get('/v0/d/x');
  await client.get('/v0/d/y');

  assert.equal(tokenCallCount, 2, 'a token inside the refresh buffer should be refetched, not reused');
});

test('NewStoreClient retries a 5xx with backoff then returns the eventual success', async (t) => {
  withCreds(t);
  let dataCallCount = 0;
  withFetch(t, async (url) => {
    if (String(url).includes('token')) {
      return fakeResponse(200, { access_token: 'tok', expires_in: 300 });
    }
    dataCallCount += 1;
    if (dataCallCount === 1) {
      return fakeResponse(503, { error: 'temporary' });
    }
    return fakeResponse(200, { external_order_id: 'QA123' });
  });

  // Near-instant backoff so the test doesn't wait out the real 2s/4s delays.
  const client = new NewStoreClient({ retryDelaysMs: [1, 1] });
  const result = await client.get('/v0/d/external_orders/QA123');

  assert.equal(dataCallCount, 2, 'should retry exactly once after the 503 then succeed');
  assert.deepEqual(result, { external_order_id: 'QA123' });
});

test('NewStoreClient throws immediately on a 4xx without retrying', async (t) => {
  withCreds(t);
  let dataCallCount = 0;
  withFetch(t, async (url) => {
    if (String(url).includes('token')) {
      return fakeResponse(200, { access_token: 'tok', expires_in: 300 });
    }
    dataCallCount += 1;
    return fakeResponse(404, { error_code: 'invalid_external_id', messages: 'not found' });
  });

  const client = new NewStoreClient({ retryDelaysMs: [1, 1] });
  await assert.rejects(
    () => client.get('/v0/d/external_orders/nope'),
    /404/,
  );
  assert.equal(dataCallCount, 1, 'a 4xx must not be retried');
});

test('NewStoreClient exhausts retries and surfaces the final 5xx body', async (t) => {
  withCreds(t);
  let dataCallCount = 0;
  withFetch(t, async (url) => {
    if (String(url).includes('token')) {
      return fakeResponse(200, { access_token: 'tok', expires_in: 300 });
    }
    dataCallCount += 1;
    return fakeResponse(500, { error: 'still broken' });
  });

  const client = new NewStoreClient({ retryDelaysMs: [1, 1] });
  await assert.rejects(
    () => client.post('/v0/d/fulfill_order', { external_id: 'x' }),
    /still broken/,
  );
  assert.equal(dataCallCount, 3, 'should attempt 3 times total (1 + 2 retries) before giving up');
});
