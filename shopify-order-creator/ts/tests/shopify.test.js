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
