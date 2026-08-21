"use strict";
/**
 * Fulfilment client (TAA-34, slice A of the TAA-21 fulfilment workstream).
 *
 * `POST /staging/fulfil` on the staging API gateway, `X-API-KEY` auth. This
 * is an existing Universal Store service (predates Kian) sent via RapidAPI —
 * not something this harness owns, only calls. Contract confirmed with JJ,
 * 2026-08-07 (dev doc: Confluence QD space, page 1866727460).
 *
 * Staging-only by design: the constructor asserts the configured host is the
 * staging host and throws otherwise. This project has no production
 * configuration anywhere, on purpose — there is nothing to fall back to.
 *
 * Payload asymmetry (real, not a typo): `shipment_id` is the `SHIPMENT#<id>`
 * sort key with the prefix stripped (bare UUID); `shipment_item_id` is the
 * `ITEM#<uuid>` sort key with the prefix retained, verbatim. Weights are
 * unvalidated pass-through constants — the reference payload's own
 * `final_weight` (0.6) doesn't even sum from its item weight (0.2) plus
 * packaging (0.1), which confirms nothing checks them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FulfilmentClient = exports.FULFILLER = void 0;
exports.buildFulfilPayload = buildFulfilPayload;
exports.formatFulfilledAt = formatFulfilledAt;
const STAGING_HOST = "celmqip2md.execute-api.ap-southeast-2.amazonaws.com";
const BRISBANE_TIME_ZONE = "Australia/Brisbane";
/** Free text, deliberately identifiable so QA-originated fulfilments are obvious in staging data. */
exports.FULFILLER = "QA auto fulfilment";
// Constants from the reference payload in the dev doc. Unvalidated pass-through — nothing asserts on them.
const ITEM_WEIGHT = "0.2";
const FINAL_WEIGHT = "0.6";
const PACKAGING_WEIGHT = "0.1";
/**
 * One package per item — multi-item packages are legal per the contract but
 * not exercised here (JJ: "doesn't particularly matter at all for this").
 * `shipmentId` and each entry of `itemIds` are passed through verbatim; it is
 * the caller's job to have already stripped/retained the right prefixes.
 */
function buildFulfilPayload(shipmentId, itemIds, fulfiller, fulfilledAt) {
    return {
        shipment_id: shipmentId,
        package_composition: itemIds.map((itemId) => ({
            shipment_items: [{ shipment_item_id: itemId, weight: ITEM_WEIGHT }],
            final_weight: FINAL_WEIGHT,
            packaging_weight: PACKAGING_WEIGHT,
        })),
        fulfiller,
        fulfilled_at: fulfilledAt,
    };
}
/**
 * Formats a `Date` as `YYYY-MM-DD HH:MM:SS` in Australia/Brisbane, explicitly
 * via `Intl.DateTimeFormat` with `timeZone: "Australia/Brisbane"` — NOT host
 * local time. Brisbane has no DST (UTC+10 year-round), which removes the
 * usual class of bug here but not the need to be explicit: a CI runner or a
 * laptop in another timezone would otherwise silently send a wrong timestamp.
 */
function formatFulfilledAt(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BRISBANE_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const part = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
class FulfilmentClient {
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
            throw new Error(`FulfilmentClient refuses to run against non-staging host "${host}" (expected "${STAGING_HOST}"). ` +
                "This project is staging-only by design — there is no production configuration to fall back to.");
        }
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    /** Throws on any non-200, carrying the response body into the error message. */
    async fulfil(payload) {
        const response = await fetch(`${this.baseUrl}/staging/fulfil`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": this.apiKey,
            },
            body: JSON.stringify(payload),
        });
        const rawBody = await response.text();
        if (response.status !== 200) {
            throw new Error(`Fulfil request failed: ${response.status} ${response.statusText} — ${rawBody}`);
        }
        try {
            return JSON.parse(rawBody);
        }
        catch {
            throw new Error(`Fulfil request returned 200 but the body was not valid JSON: ${rawBody}`);
        }
    }
}
exports.FulfilmentClient = FulfilmentClient;
