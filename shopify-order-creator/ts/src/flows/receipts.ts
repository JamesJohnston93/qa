/**
 * Sales-receipt generation for NewStore-injected orders (TAA-17 receipt
 * decision: PORT — recorded 2026-07-31, per JJ). Ports receipt_service.py.
 *
 * NewStore only creates a Documents-section receipt via its own NOM app
 * checkout flow — an order injected via POST /v0/d/fulfill_order never
 * triggers that pipeline. This module works around it: render the sales
 * receipt Template Service template to PDF using the order's real data,
 * post the resulting link as an order note (visible in NewStore Manager),
 * and optionally save the PDF locally.
 *
 * Deliberately NON-FATAL by design (per JJ, 2026-07-31) — unlike the rest of
 * this harness, which is strict-by-default. A receipt decorates an
 * already-successful order; it isn't a correctness check, so a render
 * failure falls back to a text-only note instead of throwing, matching the
 * Python original's intent. This is a standalone utility (also per JJ) —
 * NOT wired into the automated ns_sfs/ns_otc regression cases, which stay
 * side-effect-free on every run/repeat.
 *
 * Two known bugs from the Python original are fixed in this port (CLAUDE.md
 * gotcha #5): shipping was hardcoded to 10.0 instead of the real 9.99
 * charged, and the store name was hardcoded to "Universal Store" even for
 * Perfect Stranger orders. Also fixed: customer_name was hardcoded to the
 * old "Jared Davis" identity — stale since the QA customer identity was
 * renamed everywhere else in the codebase (2026-07-22); this module was
 * missed at the time.
 */

import * as fs from "fs";
import * as path from "path";
import type { Store } from "../config";
import type { NewStoreClient } from "../clients/newstore";
import type { NewStoreOrderType } from "./newstoreOrders";
import { shopIdFor, customerNameFor, NS_SHOP_LOCALE, NS_SHIPPING_PRICE } from "./newstoreOrders";

const STORE_NAMES: Record<Store, string> = { US: "Universal Store", PS: "Perfect Stranger" };
const TENANT_ADDRESS = "Level 2, 100 Market St, Sydney NSW 2000";
const STORE_ADDRESS = "Chermside Shopping Centre, 395 Hamilton Rd, Chermside QLD 4032";
const TEMPLATE_ID_CANDIDATES = ["sales_receipt", "sales-receipt", "pos_sales_receipt", "receipt"];
const PDF_DOWNLOAD_TIMEOUT_MS = 15_000;

export interface CatalogInfo {
  name: string;
  ean: string;
}

interface TemplatesListResponse {
  data?: Array<{ id?: string }>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Discovers and caches the sales receipt template. Instance-scoped (not a
 * module global, per this harness's "no module-global state" rule) — one
 * ReceiptService per caller, reused across calls if you want the cache.
 */
export class ReceiptService {
  private templateId: string | null = null;
  private sampleData: Record<string, unknown> | null = null;

  constructor(private readonly client: NewStoreClient) {}

  /** Lists templates and finds the sales receipt template id (throws if none match). */
  async findReceiptTemplateId(): Promise<string> {
    if (this.templateId) {
      return this.templateId;
    }
    const data = await this.client.get<TemplatesListResponse>("/v0/d/templates/templates");
    const ids = (data.data ?? []).map((t) => t.id ?? "");
    for (const candidate of TEMPLATE_ID_CANDIDATES) {
      const match = ids.find((id) => id.toLowerCase().includes(candidate));
      if (match) {
        this.templateId = match;
        return match;
      }
    }
    throw new Error(`Could not find a sales receipt template. Available templates: ${JSON.stringify(ids)}`);
  }

  /** Fetches (and caches) the template's sample data — the base the render payload overlays real values onto. */
  async getSampleData(templateId: string): Promise<Record<string, unknown>> {
    if (this.sampleData) {
      return this.sampleData;
    }
    try {
      const data = await this.client.get<Record<string, unknown>>(
        `/v0/d/templates/templates/${templateId}/sample_data`,
      );
      this.sampleData = data && typeof data === "object" ? data : {};
    } catch (error) {
      console.log(`    [receipt] Could not fetch sample data: ${(error as Error).message}`);
      this.sampleData = {};
    }
    return this.sampleData;
  }
}

/**
 * Fetches product name + EAN for each SKU from the NewStore Customer API
 * (GET /v0/c/products/sku={sku}). Missing/failed SKUs are omitted — callers
 * fall back to the raw SKU as the display label. Non-fatal per SKU, matching
 * the Python original: one bad lookup never blocks the rest.
 */
export async function lookupCatalogInfo(
  client: NewStoreClient,
  store: Store,
  skus: string[],
): Promise<Record<string, CatalogInfo>> {
  const shop = shopIdFor(store);
  const info: Record<string, CatalogInfo> = {};
  for (const sku of new Set(skus)) {
    try {
      const data = await client.get<Record<string, unknown>>(
        `/v0/c/products/sku=${encodeURIComponent(sku)}?locale=${encodeURIComponent(NS_SHOP_LOCALE)}&shop=${encodeURIComponent(shop)}`,
      );
      const title = typeof data.title === "string" ? data.title : sku;
      const ext = (data.external_identifiers as Record<string, unknown>) ?? {};
      const ean = (ext.ean13 as string) || (ext.gtin as string) || (data.gtin as string) || "";
      info[sku] = { name: title, ean };
    } catch (error) {
      console.log(`    [receipt] Catalog lookup failed for ${sku}: ${(error as Error).message}`);
    }
  }
  return info;
}

export interface RenderDataParams {
  store: Store;
  skus: string[];
  prices: Record<string, number>;
  total: number;
  externalId: string;
  fulfillmentGroup: string;
  includeShipping: boolean;
  associateName?: string;
  productInfo?: Record<string, CatalogInfo>;
}

/** Maps order data to the shape the receipt template expects (pure — offline-testable). */
export function buildRenderData(params: RenderDataParams): Record<string, unknown> {
  const { store, skus, prices, total, externalId, fulfillmentGroup, includeShipping, associateName, productInfo } = params;

  const flatItems = skus.map((sku) => {
    const price = prices[sku] ?? 0;
    const tax = round2(price / 11);
    const net = round2(price - tax);
    const info = (productInfo ?? {})[sku];
    const name = info?.name || sku; // fall back to SKU if the catalog lookup missed
    const ean = info?.ean || "";
    return {
      product_name: name,
      product_id: sku,
      fulfillment_group_type: fulfillmentGroup,
      external_identifier: { epc: ean, sku },
      amount: price,
      product_attributes: { variation_size_value: "" },
      price_net: net,
      price_gross: price,
      price_tax: tax,
      price_catalog: price,
      price_override_reason: "",
      price_override_reason_type: "",
      item_discount: 0,
      item_order_discount: 0,
      product_image_url: "",
      tax_method: "vat_included",
      discounts: [],
      group_id: "",
      extended_attributes: [],
      addons: [],
    };
  });

  const shipping = includeShipping ? NS_SHIPPING_PRICE : 0; // fixed: was hardcoded 10.0, now the real 9.99 charged
  const totalTax = round2(total / 11);
  const totalNet = round2(total - totalTax);
  const taxLines = [{ name: "GST", rate: 0.1, amount: totalTax }];

  return {
    order_number: externalId,
    external_id: externalId,
    created_at: new Date().toISOString(),
    currency_code: "AUD",
    timezone: "Australia/Brisbane",
    tax_exempt: false,

    customer_name: customerNameFor(store), // fixed: was hardcoded "Jared Davis"
    associate_name: associateName || "QA Tool",
    store_name: STORE_NAMES[store], // fixed: was hardcoded "Universal Store" even for PS
    tenant_address: TENANT_ADDRESS,
    store_address: STORE_ADDRESS,
    store_phone_number: "",

    flat_items: flatItems,
    items: flatItems,
    discounts: [],
    extended_attributes: [],
    order_notes: [],
    shipping_method: includeShipping ? "shipping" : "in_store_handover",

    payment_method_label: "Cash",
    // payment_method must be "credit_card" — the template has a cash-specific
    // code path that crashes (confirmed against the Python original); brand
    // label is set to "Cash" so the rendered receipt still reads correctly.
    instruments: [
      {
        instrument_id: "00000000-0000-0000-0000-000000000000",
        payment_provider: "cash",
        payment_method: "credit_card",
        currency_code: "AUD",
        metadata: { instrument_details: { last4: "0000", brand: "Cash" } },
        amount: total,
      },
    ],

    amounts: {
      shipping_and_handling: shipping,
      taxes: totalTax,
      grand_total: total,
      sub_total: totalNet,
      tax_lines: taxLines,
      gift_wrapping: 0,
    },
    fulfillment_group_amounts: {
      [fulfillmentGroup]: {
        tax_lines: taxLines,
        sub_total: totalNet,
        grand_total: total,
        taxes: totalTax,
        shipping_and_handling: shipping,
      },
    },

    billing_address: null,
    shipping_address: null,

    // qr_code intentionally omitted — template expects base64 PNG, not a
    // plain string; the sample data's placeholder image passes through.
  };
}

async function downloadPdf(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`download failed: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export interface GenerateReceiptParams {
  client: NewStoreClient;
  orderUuid: string; // NewStore's internal 'id' from the injection response — required by the Order Notes API
  externalId: string;
  store: Store;
  skus: string[];
  prices: Record<string, number>;
  total: number;
  orderType: NewStoreOrderType;
  associateName?: string;
  saveLocally?: boolean;
  receiptsDir?: string; // defaults to shopify-order-creator/ts/receipts
}

/**
 * Renders the sales receipt template and posts a link as an order note.
 * Every step after order injection is non-fatal — errors are caught and
 * logged, and a fallback text-only note is posted so the order page still
 * shows something. The order itself is never affected by a failure here.
 */
export async function generateAndAttachReceipt(params: GenerateReceiptParams): Promise<void> {
  const { client, orderUuid, externalId, store, skus, prices, total, orderType, associateName, saveLocally, receiptsDir } =
    params;
  const includeShipping = orderType === "SFS";
  const fulfillmentGroup = orderType === "SFS" ? "SHIPPING" : "IN_STORE_HANDOVER";
  let permanentLink: string | null = null;

  // --- 1. Fetch product names/EANs from the NewStore catalog (non-fatal) ---
  let productInfo: Record<string, CatalogInfo> = {};
  try {
    productInfo = await lookupCatalogInfo(client, store, skus);
  } catch (error) {
    console.log(`    [receipt] Catalog lookup failed (${(error as Error).message}) — using SKUs as names`);
  }

  // --- 2. Render the receipt template to PDF (non-fatal) -------------------
  try {
    const service = new ReceiptService(client);
    const templateId = await service.findReceiptTemplateId();
    const sampleData = await service.getSampleData(templateId);
    const ourData = buildRenderData({
      store,
      skus,
      prices,
      total,
      externalId,
      fulfillmentGroup,
      includeShipping,
      associateName,
      productInfo,
    });
    // Sample data first so every template-required field is present, then
    // our real order values override it.
    const renderData = { ...sampleData, ...ourData };
    const renderResult = await client.post<Record<string, unknown>>(`/v0/d/templates/templates/${templateId}/render`, {
      locale: "en_AU",
      data: renderData,
      content_type: "pdf",
    });
    const link = (renderResult.permanent_link as string | undefined) ?? (renderResult.output as string | undefined);
    if (!link) {
      throw new Error(`Render succeeded but returned no link. Response: ${JSON.stringify(renderResult)}`);
    }
    permanentLink = link;
  } catch (error) {
    console.log(`    [receipt] Render failed: ${(error as Error).message}`);
  }

  // --- 3. Optionally save the PDF locally (non-fatal) -----------------------
  if (saveLocally && permanentLink) {
    try {
      const dir = receiptsDir ?? path.join(__dirname, "..", "..", "receipts");
      fs.mkdirSync(dir, { recursive: true });
      const pdfPath = path.join(dir, `${externalId}.pdf`);
      fs.writeFileSync(pdfPath, await downloadPdf(permanentLink));
      console.log(`    [receipt] Saved -> ${pdfPath}`);
    } catch (error) {
      console.log(`    [receipt] Local save failed: ${(error as Error).message}`);
    }
  }

  // --- 4. Post as an order note (always attempted, non-fatal) --------------
  const noteText = permanentLink
    ? `Sales Receipt:\n${permanentLink}`
    : `Sales Receipt (${orderType}): PDF could not be generated — check logs.`;
  try {
    await client.post(`/v0/d/orders/${orderUuid}/notes`, {
      text: noteText,
      source: associateName || "QA Tool",
      source_type: "app",
      tags: ["sales_receipt", "qa_tool"],
    });
    console.log(`    [receipt] Note posted (${permanentLink ? "with PDF link" : "text-only (render failed)"})`);
  } catch (error) {
    console.log(`    [receipt] Note post failed: ${(error as Error).message}`);
  }
}
