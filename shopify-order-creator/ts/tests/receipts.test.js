const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ReceiptService,
  lookupCatalogInfo,
  buildRenderData,
  generateAndAttachReceipt,
} = require('../dist/flows/receipts.js');

function fakeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    get: async (path) => {
      calls.push({ method: 'GET', path });
      if (overrides.get) return overrides.get(path);
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path, payload) => {
      calls.push({ method: 'POST', path, payload });
      if (overrides.post) return overrides.post(path, payload);
      return {};
    },
  };
}

test('ReceiptService.findReceiptTemplateId matches a known candidate and caches it', async () => {
  let getCalls = 0;
  const client = fakeClient({
    get: async () => {
      getCalls += 1;
      return { data: [{ id: 'pos_receipt_v2' }, { id: 'gift_card' }] };
    },
  });
  const service = new ReceiptService(client);

  const id1 = await service.findReceiptTemplateId();
  const id2 = await service.findReceiptTemplateId();
  assert.equal(id1, 'pos_receipt_v2');
  assert.equal(id2, 'pos_receipt_v2');
  assert.equal(getCalls, 1, 'second call should use the cached template id, not refetch');
});

test('ReceiptService.findReceiptTemplateId throws with the available list when nothing matches', async () => {
  const client = fakeClient({ get: async () => ({ data: [{ id: 'gift_card' }, { id: 'loyalty_card' }] }) });
  const service = new ReceiptService(client);

  await assert.rejects(() => service.findReceiptTemplateId(), /Could not find a sales receipt template/);
});

test('ReceiptService.getSampleData caches and falls back to {} on failure (non-fatal)', async () => {
  let getCalls = 0;
  const client = fakeClient({
    get: async () => {
      getCalls += 1;
      throw new Error('sample data unavailable');
    },
  });
  const service = new ReceiptService(client);

  const data1 = await service.getSampleData('tmpl-1');
  const data2 = await service.getSampleData('tmpl-1');
  assert.deepEqual(data1, {});
  assert.deepEqual(data2, {});
  assert.equal(getCalls, 1, 'a failed fetch should still cache the {} fallback, not retry every call');
});

test('lookupCatalogInfo parses title/ean and omits a SKU whose lookup fails (non-fatal per SKU)', async () => {
  const client = fakeClient({
    get: async (path) => {
      if (path.includes('sku=32625134')) {
        return { title: 'Test Tee', external_identifiers: { ean13: '1234567890123' } };
      }
      throw new Error('not found');
    },
  });

  const info = await lookupCatalogInfo(client, 'US', ['32625134', '99999999']);
  assert.deepEqual(info, { '32625134': { name: 'Test Tee', ean: '1234567890123' } });
});

test('buildRenderData: SFS charges the real 9.99 shipping (not the old hardcoded 10.0)', () => {
  const data = buildRenderData({
    store: 'US',
    skus: ['32625134'],
    prices: { '32625134': 100 },
    total: 109.99,
    externalId: 'QASFS_1_a',
    fulfillmentGroup: 'SHIPPING',
    includeShipping: true,
  });
  assert.equal(data.amounts.shipping_and_handling, 9.99);
  assert.equal(data.fulfillment_group_amounts.SHIPPING.shipping_and_handling, 9.99);
});

test('buildRenderData: OTC charges no shipping', () => {
  const data = buildRenderData({
    store: 'US',
    skus: ['32625134'],
    prices: { '32625134': 100 },
    total: 100,
    externalId: 'QAOTC_1_a',
    fulfillmentGroup: 'IN_STORE_HANDOVER',
    includeShipping: false,
  });
  assert.equal(data.amounts.shipping_and_handling, 0);
  assert.equal(data.shipping_method, 'in_store_handover');
});

test('buildRenderData: store_name reflects the actual brand, not hardcoded "Universal Store"', () => {
  const us = buildRenderData({
    store: 'US',
    skus: ['32625134'],
    prices: { '32625134': 100 },
    total: 100,
    externalId: 'QAOTC_1_a',
    fulfillmentGroup: 'IN_STORE_HANDOVER',
    includeShipping: false,
  });
  const ps = buildRenderData({
    store: 'PS',
    skus: ['33203669'],
    prices: { '33203669': 100 },
    total: 100,
    externalId: 'QAOTC_1_b',
    fulfillmentGroup: 'IN_STORE_HANDOVER',
    includeShipping: false,
  });
  assert.equal(us.store_name, 'Universal Store');
  assert.equal(ps.store_name, 'Perfect Stranger');
});

test('buildRenderData: customer_name uses the real per-brand QA identity, not the stale "Jared Davis"', () => {
  const data = buildRenderData({
    store: 'PS',
    skus: ['33203669'],
    prices: { '33203669': 100 },
    total: 100,
    externalId: 'QAOTC_1_a',
    fulfillmentGroup: 'IN_STORE_HANDOVER',
    includeShipping: false,
  });
  assert.equal(data.customer_name, 'JJQA AutoNS');
  assert.notEqual(data.customer_name, 'Jared Davis');
});

test('buildRenderData: falls back to the SKU as product_name when catalog info is missing', () => {
  const data = buildRenderData({
    store: 'US',
    skus: ['32625134'],
    prices: { '32625134': 55 },
    total: 55,
    externalId: 'QAOTC_1_a',
    fulfillmentGroup: 'IN_STORE_HANDOVER',
    includeShipping: false,
  });
  assert.equal(data.flat_items[0].product_name, '32625134');
  assert.equal(data.flat_items[0].price_tax, 5); // 55/11
});

test('generateAndAttachReceipt: full success path posts a note with the rendered PDF link', async () => {
  const client = fakeClient({
    get: (path) => {
      if (path === '/v0/d/templates/templates') return { data: [{ id: 'sales_receipt' }] };
      if (path.includes('/sample_data')) return { some_field: 'x' };
      throw new Error(`unexpected GET ${path}`);
    },
    post: (path, payload) => {
      if (path.includes('/render')) return { permanent_link: 'https://ns.example/receipt.pdf' };
      if (path.endsWith('/notes')) return { ok: true, _payload: payload };
      throw new Error(`unexpected POST ${path}`);
    },
  });

  await generateAndAttachReceipt({
    client,
    orderUuid: 'order-uuid-1',
    externalId: 'QASFS_1_a',
    store: 'US',
    skus: ['32625134'],
    prices: { '32625134': 100 },
    total: 109.99,
    orderType: 'SFS',
  });

  const noteCall = client.calls.find((c) => c.path.endsWith('/notes'));
  assert.ok(noteCall, 'a note must always be posted');
  assert.match(noteCall.payload.text, /Sales Receipt:\nhttps:\/\/ns\.example\/receipt\.pdf/);
});

test('generateAndAttachReceipt: render failure falls back to a text-only note and does not throw', async () => {
  const client = fakeClient({
    get: () => {
      throw new Error('templates unavailable');
    },
    post: (path) => {
      if (path.endsWith('/notes')) return { ok: true };
      throw new Error(`unexpected POST ${path}`);
    },
  });

  await generateAndAttachReceipt({
    client,
    orderUuid: 'order-uuid-1',
    externalId: 'QAOTC_1_a',
    store: 'US',
    skus: ['32625134'],
    prices: { '32625134': 100 },
    total: 100,
    orderType: 'OTC',
  });

  const noteCall = client.calls.find((c) => c.path.endsWith('/notes'));
  assert.ok(noteCall);
  assert.match(noteCall.payload.text, /PDF could not be generated/);
});

test('generateAndAttachReceipt: a note-post failure is swallowed, never thrown (non-fatal by design)', async () => {
  const client = fakeClient({
    get: () => {
      throw new Error('templates unavailable');
    },
    post: () => {
      throw new Error('notes API down');
    },
  });

  await assert.doesNotReject(() =>
    generateAndAttachReceipt({
      client,
      orderUuid: 'order-uuid-1',
      externalId: 'QAOTC_1_a',
      store: 'US',
      skus: ['32625134'],
      prices: { '32625134': 100 },
      total: 100,
      orderType: 'OTC',
    }),
  );
});
