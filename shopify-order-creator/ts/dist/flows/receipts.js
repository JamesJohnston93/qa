"use strict";
/**
 * Sales-receipt generation for NewStore-injected orders (TAA-17 receipt
 * decision: PORT — recorded 2026-07-31, per JJ).
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
 * failure falls back to a text-only note instead of throwing. Standalone
 * utility — NOT wired into the automated ns_sfs/ns_otc regression cases,
 * which stay side-effect-free on every run/repeat.
 *
 * Three stale/hardcoded values fixed while building this: shipping was
 * hardcoded to 10.0 instead of the real 9.99 charged; store name was
 * hardcoded to "Universal Store" even for Perfect Stranger orders;
 * customer_name was hardcoded to the old "Jared Davis" identity (stale
 * since the QA customer identity was renamed everywhere else in the
 * codebase, 2026-07-22).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptService = void 0;
exports.lookupCatalogInfo = lookupCatalogInfo;
exports.buildRenderData = buildRenderData;
exports.generateAndAttachReceipt = generateAndAttachReceipt;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const newstoreOrders_1 = require("./newstoreOrders");
const STORE_NAMES = { US: "Universal Store", PS: "Perfect Stranger" };
const TENANT_ADDRESS = "Level 2, 100 Market St, Sydney NSW 2000";
const STORE_ADDRESS = "Chermside Shopping Centre, 395 Hamilton Rd, Chermside QLD 4032";
const TEMPLATE_ID_CANDIDATES = ["sales_receipt", "sales-receipt", "pos_sales_receipt", "receipt"];
const PDF_DOWNLOAD_TIMEOUT_MS = 15_000;
function round2(value) {
    return Math.round(value * 100) / 100;
}
/**
 * Discovers and caches the sales receipt template. Instance-scoped (not a
 * module global, per this harness's "no module-global state" rule) — one
 * ReceiptService per caller, reused across calls if you want the cache.
 */
class ReceiptService {
    client;
    templateId = null;
    sampleData = null;
    constructor(client) {
        this.client = client;
    }
    /** Lists templates and finds the sales receipt template id (throws if none match). */
    async findReceiptTemplateId() {
        if (this.templateId) {
            return this.templateId;
        }
        const data = await this.client.get("/v0/d/templates/templates");
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
    async getSampleData(templateId) {
        if (this.sampleData) {
            return this.sampleData;
        }
        try {
            const data = await this.client.get(`/v0/d/templates/templates/${templateId}/sample_data`);
            this.sampleData = data && typeof data === "object" ? data : {};
        }
        catch (error) {
            console.log(`    [receipt] Could not fetch sample data: ${error.message}`);
            this.sampleData = {};
        }
        return this.sampleData;
    }
}
exports.ReceiptService = ReceiptService;
/**
 * Fetches product name + EAN for each SKU from the NewStore Customer API
 * (GET /v0/c/products/sku={sku}). Missing/failed SKUs are omitted — callers
 * fall back to the raw SKU as the display label. Non-fatal per SKU: one bad
 * lookup never blocks the rest.
 */
async function lookupCatalogInfo(client, store, skus) {
    const shop = (0, newstoreOrders_1.shopIdFor)(store);
    const info = {};
    for (const sku of new Set(skus)) {
        try {
            const data = await client.get(`/v0/c/products/sku=${encodeURIComponent(sku)}?locale=${encodeURIComponent(newstoreOrders_1.NS_SHOP_LOCALE)}&shop=${encodeURIComponent(shop)}`);
            const title = typeof data.title === "string" ? data.title : sku;
            const ext = data.external_identifiers ?? {};
            const ean = ext.ean13 || ext.gtin || data.gtin || "";
            info[sku] = { name: title, ean };
        }
        catch (error) {
            console.log(`    [receipt] Catalog lookup failed for ${sku}: ${error.message}`);
        }
    }
    return info;
}
/** Maps order data to the shape the receipt template expects (pure — offline-testable). */
function buildRenderData(params) {
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
    const shipping = includeShipping ? newstoreOrders_1.NS_SHIPPING_PRICE : 0; // fixed: was hardcoded 10.0, now the real 9.99 charged
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
        customer_name: (0, newstoreOrders_1.customerNameFor)(store), // fixed: was hardcoded "Jared Davis"
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
        // code path that crashes; brand label is set to "Cash" so the rendered
        // receipt still reads correctly.
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
async function downloadPdf(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PDF_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`download failed: ${response.status} ${response.statusText}`);
        }
        return Buffer.from(await response.arrayBuffer());
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Renders the sales receipt template and posts a link as an order note.
 * Every step after order injection is non-fatal — errors are caught and
 * logged, and a fallback text-only note is posted so the order page still
 * shows something. The order itself is never affected by a failure here.
 */
async function generateAndAttachReceipt(params) {
    const { client, orderUuid, externalId, store, skus, prices, total, orderType, associateName, saveLocally, receiptsDir } = params;
    const includeShipping = orderType === "SFS";
    const fulfillmentGroup = orderType === "SFS" ? "SHIPPING" : "IN_STORE_HANDOVER";
    let permanentLink = null;
    // --- 1. Fetch product names/EANs from the NewStore catalog (non-fatal) ---
    let productInfo = {};
    try {
        productInfo = await lookupCatalogInfo(client, store, skus);
    }
    catch (error) {
        console.log(`    [receipt] Catalog lookup failed (${error.message}) — using SKUs as names`);
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
        const renderResult = await client.post(`/v0/d/templates/templates/${templateId}/render`, {
            locale: "en_AU",
            data: renderData,
            content_type: "pdf",
        });
        const link = renderResult.permanent_link ?? renderResult.output;
        if (!link) {
            throw new Error(`Render succeeded but returned no link. Response: ${JSON.stringify(renderResult)}`);
        }
        permanentLink = link;
    }
    catch (error) {
        console.log(`    [receipt] Render failed: ${error.message}`);
    }
    // --- 3. Optionally save the PDF locally (non-fatal) -----------------------
    if (saveLocally && permanentLink) {
        try {
            const dir = receiptsDir ?? path.join(__dirname, "..", "..", "receipts");
            fs.mkdirSync(dir, { recursive: true });
            const pdfPath = path.join(dir, `${externalId}.pdf`);
            fs.writeFileSync(pdfPath, await downloadPdf(permanentLink));
            console.log(`    [receipt] Saved -> ${pdfPath}`);
        }
        catch (error) {
            console.log(`    [receipt] Local save failed: ${error.message}`);
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
    }
    catch (error) {
        console.log(`    [receipt] Note post failed: ${error.message}`);
    }
}
