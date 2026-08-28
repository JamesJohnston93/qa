"use strict";
/**
 * Reject client (TAA-31, slice B). `POST /staging/reject` on the staging API
 * gateway, `X-API-KEY` auth.
 *
 * NOT the same endpoint as fulfil, despite the original brief saying so —
 * confirmed live in slice A (`ts/signoffs/TAA-31-slice-a.md`): sending a
 * `rejected_items` body to `/staging/fulfil` crashes with a 502, because that
 * handler unconditionally expects `package_composition` and never inspects
 * `rejected_items` at all. Reject is a genuine sibling path on the same host
 * and the same `X-API-KEY`, with its own success-body shape
 * (`data.message`, a plain string — not `label_url`/`label_dimensions`), so
 * it gets its own client rather than a second body shape bolted onto
 * `FulfilmentClient.fulfil`.
 *
 * Staging-only by design, same as `FulfilmentClient`: the constructor
 * asserts the configured host is the staging host and throws otherwise.
 *
 * Per JJ (2026-08-23): reject is NEVER valid on an already-fulfilled
 * shipment and will never be exercised against one, in this client's tests
 * or in the regression suite. This client does not guard against that case
 * itself — same division of responsibility as `FulfilmentClient`, which also
 * has no pre-flight Dynamo check baked in (that check lives in the caller,
 * `flows/fulfilFlow.ts`). Any future reject flow must not call `reject()`
 * against a shipment whose status is already `FULFILLED`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RejectClient = exports.DEFAULT_REJECTION_REASON = void 0;
exports.buildRejectPayload = buildRejectPayload;
const STAGING_HOST = "celmqip2md.execute-api.ap-southeast-2.amazonaws.com";
/** The harness will only ever send this one reason — no enum, no CLI flag, per JJ (TAA-31 slice A). */
exports.DEFAULT_REJECTION_REASON = "FAULTY";
/**
 * Mirrors `buildFulfilPayload`'s shape (`clients/fulfilment.ts`) for the
 * reject body: bare-uuid `shipment_id`, `ITEM#`-prefixed `shipment_item_id`
 * retained verbatim, snake_case throughout — confirmed no mismatch against
 * the fulfil builder's conventions (TAA-31 slice A).
 */
function buildRejectPayload(shipmentId, itemIds, reason = exports.DEFAULT_REJECTION_REASON) {
    if (itemIds.length === 0) {
        throw new Error("buildRejectPayload requires at least one item");
    }
    return {
        shipment_id: shipmentId,
        rejected_items: itemIds.map((shipment_item_id) => ({ shipment_item_id, rejection_reason: reason })),
    };
}
class RejectClient {
    baseUrl;
    apiKey;
    constructor(options = {}) {
        const baseUrl = options.baseUrl ?? process.env.FULFIL_BASE_URL;
        const apiKey = options.apiKey ?? process.env.FULFIL_API_KEY;
        if (!baseUrl) {
            throw new Error("Missing FULFIL_BASE_URL environment variable");
        }
        if (!apiKey) {
            throw new Error("Missing FULFIL_API_KEY environment variable");
        }
        let host;
        try {
            host = new URL(baseUrl).hostname;
        }
        catch {
            throw new Error(`FULFIL_BASE_URL is not a valid URL: "${baseUrl}"`);
        }
        if (host !== STAGING_HOST) {
            throw new Error(`RejectClient refuses to run against non-staging host "${host}" (expected "${STAGING_HOST}"). ` +
                "This project is staging-only by design — there is no production configuration to fall back to.");
        }
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    /** Throws on any non-200, carrying the response body into the error message. */
    async reject(payload) {
        const response = await fetch(`${this.baseUrl}/staging/reject`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": this.apiKey,
            },
            body: JSON.stringify(payload),
        });
        const rawBody = await response.text();
        if (response.status !== 200) {
            throw new Error(`Reject request failed: ${response.status} ${response.statusText} — ${rawBody}`);
        }
        try {
            return JSON.parse(rawBody);
        }
        catch {
            throw new Error(`Reject request returned 200 but the body was not valid JSON: ${rawBody}`);
        }
    }
}
exports.RejectClient = RejectClient;
