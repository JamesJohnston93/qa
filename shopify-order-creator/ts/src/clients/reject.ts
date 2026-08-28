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

const STAGING_HOST = "celmqip2md.execute-api.ap-southeast-2.amazonaws.com";

/** The harness will only ever send this one reason — no enum, no CLI flag, per JJ (TAA-31 slice A). */
export const DEFAULT_REJECTION_REASON = "FAULTY";

export interface RejectedItem {
  shipment_item_id: string;
  rejection_reason: string;
}

export interface RejectPayload {
  shipment_id: string;
  rejected_items: RejectedItem[];
}

/** Confirmed live shape (slice A): `data` carries one human-readable message, not label fields. */
export interface RejectResponse {
  code: number;
  message: string;
  data: { message: string };
}

/**
 * Mirrors `buildFulfilPayload`'s shape (`clients/fulfilment.ts`) for the
 * reject body: bare-uuid `shipment_id`, `ITEM#`-prefixed `shipment_item_id`
 * retained verbatim, snake_case throughout — confirmed no mismatch against
 * the fulfil builder's conventions (TAA-31 slice A).
 */
export function buildRejectPayload(
  shipmentId: string,
  itemIds: string[],
  reason: string = DEFAULT_REJECTION_REASON,
): RejectPayload {
  if (itemIds.length === 0) {
    throw new Error("buildRejectPayload requires at least one item");
  }
  return {
    shipment_id: shipmentId,
    rejected_items: itemIds.map((shipment_item_id) => ({ shipment_item_id, rejection_reason: reason })),
  };
}

export interface RejectClientOptions {
  /** Overridable for tests; defaults to FULFIL_BASE_URL / FULFIL_API_KEY from env — same gateway as fulfil, different path. */
  baseUrl?: string;
  apiKey?: string;
}

export class RejectClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: RejectClientOptions = {}) {
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
        `RejectClient refuses to run against non-staging host "${host}" (expected "${STAGING_HOST}"). ` +
          "This project is staging-only by design — there is no production configuration to fall back to.",
      );
    }

    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /** Throws on any non-200, carrying the response body into the error message. */
  async reject(payload: RejectPayload): Promise<RejectResponse> {
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
      return JSON.parse(rawBody) as RejectResponse;
    } catch {
      throw new Error(`Reject request returned 200 but the body was not valid JSON: ${rawBody}`);
    }
  }
}
