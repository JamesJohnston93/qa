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

const STAGING_HOST = "celmqip2md.execute-api.ap-southeast-2.amazonaws.com";
const BRISBANE_TIME_ZONE = "Australia/Brisbane";

/** Free text, deliberately identifiable so QA-originated fulfilments are obvious in staging data. */
export const FULFILLER = "QA auto fulfilment";

// Constants from the reference payload in the dev doc. Unvalidated pass-through — nothing asserts on them.
const ITEM_WEIGHT = "0.2";
const FINAL_WEIGHT = "0.6";
const PACKAGING_WEIGHT = "0.1";

export interface FulfilShipmentItem {
  shipment_item_id: string;
  weight: string;
}

export interface FulfilPackage {
  shipment_items: FulfilShipmentItem[];
  final_weight: string;
  packaging_weight: string;
}

export interface FulfilPayload {
  shipment_id: string;
  package_composition: FulfilPackage[];
  fulfiller: string;
  fulfilled_at: string;
}

/**
 * One package per item — multi-item packages are legal per the contract but
 * not exercised here (JJ: "doesn't particularly matter at all for this").
 * `shipmentId` and each entry of `itemIds` are passed through verbatim; it is
 * the caller's job to have already stripped/retained the right prefixes.
 */
export function buildFulfilPayload(
  shipmentId: string,
  itemIds: string[],
  fulfiller: string,
  fulfilledAt: string,
): FulfilPayload {
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
export function formatFulfilledAt(date: Date): string {
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

  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export interface FulfilmentClientOptions {
  /** Overridable for tests; defaults to FULFIL_BASE_URL / FULFIL_API_KEY from env. */
  baseUrl?: string;
  apiKey?: string;
}

export class FulfilmentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: FulfilmentClientOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env.FULFIL_BASE_URL;
    const apiKey = options.apiKey ?? process.env.FULFIL_API_KEY;
    if (!baseUrl) {
      throw new Error("Missing FULFIL_BASE_URL environment variable");
    }
    if (!apiKey) {
      throw new Error("Missing FULFIL_API_KEY environment variable");
    }

    let host: string;
    try {
      host = new URL(baseUrl).hostname;
    } catch {
      throw new Error(`FULFIL_BASE_URL is not a valid URL: "${baseUrl}"`);
    }
    if (host !== STAGING_HOST) {
      throw new Error(
        `FulfilmentClient refuses to run against non-staging host "${host}" (expected "${STAGING_HOST}"). ` +
          "This project is staging-only by design — there is no production configuration to fall back to.",
      );
    }

    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /** Throws on any non-200, carrying the response body into the error message. */
  async fulfil(payload: FulfilPayload): Promise<Record<string, unknown>> {
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
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new Error(`Fulfil request returned 200 but the body was not valid JSON: ${rawBody}`);
    }
  }
}
