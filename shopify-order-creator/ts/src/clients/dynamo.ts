/**
 * DynamoDB access to staging-inventory-v2 (stock read/write/seed). Read-only
 * access to staging-orders-v2/staging-shipments (confirmed schema) lives
 * separately in readers/dynamoReader.ts.
 *
 * Failures always throw here — no soft/silent mode, no swallow-and-continue
 * fallback. Every AWS failure is a hard failure by design.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { fromSSO } from "@aws-sdk/credential-providers";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RegressionConfig } from "../config";

export interface InventoryLocation {
  store: string;
  quantity: number;
}

/** Bounded-concurrency batch size for zeroEverywhere's writes (TAA-14 Phase A). */
const ZERO_BATCH_SIZE = 25;

/** Splits items into fixed-size chunks, preserving order. Pure — offline-testable. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface TargetedZeroPlan {
  /** Stores to write 0 to — every currently-nonzero location except keepStore. */
  zero: string[];
  /** The one designated store, and the quantity it will be seeded to. */
  keep: { store: string; quantity: number };
}

/**
 * Pure planning for the "audited targeted-zero" seed (TAA-31 slice E): zero
 * only the locations an audit finds holding nonzero stock, except one
 * designated store — never a blanket write to every existing row the way
 * `zeroEverywhere` does. Proposed in `ts/signoffs/TAA-31-slice-a.md` for the
 * reject -> undeliverable case, where the SKU in question is shared across
 * this whole workstream's live trials and a blanket zero is unnecessary cost,
 * not a correctness requirement. `keepStore` is excluded from the zero list
 * even if it's currently 0 — `zeroExceptStore` sets it to `keepQuantity`
 * unconditionally afterward regardless of its starting value.
 */
export function planTargetedZero(
  locations: InventoryLocation[],
  keepStore: string,
  keepQuantity: number,
): TargetedZeroPlan {
  const zero = locations.filter((loc) => loc.quantity > 0 && loc.store !== keepStore).map((loc) => loc.store);
  return { zero, keep: { store: keepStore, quantity: keepQuantity } };
}

export class DynamoClient {
  readonly doc: DynamoDBDocumentClient;

  constructor(private readonly config: RegressionConfig) {
    const client = new DynamoDBClient({
      region: config.awsRegion,
      credentials: fromSSO({ profile: config.awsProfile }),
    });
    this.doc = DynamoDBDocumentClient.from(client);
  }

  /** Current quantity for a SKU at a given ATP location, or null if no record exists. */
  async getStock(sku: string, storeKey: string): Promise<number | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.config.inventoryTable,
        Key: { sku, store: storeKey },
      }),
    );
    if (!result.Item) {
      return null;
    }
    return Number(result.Item.quantity ?? 0);
  }

  /** Upserts the stock quantity for a SKU at a given ATP location. Throws on AWS failure. */
  async setStock(sku: string, quantity: number, storeKey: string): Promise<void> {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    await this.doc.send(
      new UpdateCommand({
        TableName: this.config.inventoryTable,
        Key: { sku, store: storeKey },
        UpdateExpression: "SET quantity = :qty, updatedAt = :ts, updatedReason = :reason",
        ExpressionAttributeValues: {
          ":qty": quantity,
          ":ts": now,
          ":reason": "TS_REGRESSION",
        },
      }),
    );
  }

  /**
   * Every ATP location row that exists for a SKU: [{store, quantity}, ...].
   *
   * The inventory table's PK is the SKU, so one Query surfaces every
   * location — including stores beyond the four ALL_LOCATIONS knows about.
   * Critical for undeliverable cases: zeroing only known locations is not
   * enough if some other store row still holds stock.
   */
  async getAllLocationsForSku(sku: string): Promise<InventoryLocation[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.config.inventoryTable,
        KeyConditionExpression: "sku = :sku",
        ExpressionAttributeValues: { ":sku": sku },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      store: String(item.store),
      quantity: Number(item.quantity ?? 0),
    }));
  }

  /** Applies an explicit seed plan: {sku: {location: qty}}. Throws on any AWS failure. */
  async seedInventory(seedPlan: Record<string, Record<string, number>>): Promise<void> {
    for (const [sku, locations] of Object.entries(seedPlan)) {
      for (const [location, qty] of Object.entries(locations)) {
        await this.setStock(sku, qty, location);
      }
    }
  }

  /**
   * Sets quantity to 0 at every location row that exists for this SKU
   * (forces undeliverable deterministically). Writes go out in bounded
   * batches (ZERO_BATCH_SIZE concurrent) rather than one at a time — with
   * ~194 locations per SKU in staging this was the dominant cost of
   * seed_inventory. Batches run in sequence so a failure in one batch still
   * throws immediately (strict-failure preserved) without racing writes
   * that haven't started yet.
   */
  async zeroEverywhere(sku: string): Promise<void> {
    const locations = await this.getAllLocationsForSku(sku);
    for (const batch of chunk(locations, ZERO_BATCH_SIZE)) {
      await Promise.all(batch.map((location) => this.setStock(sku, 0, location.store)));
    }
  }

  /**
   * Audited targeted-zero (TAA-31 slice E, see `planTargetedZero`): zeroes
   * only the nonzero locations an audit finds for this SKU, except
   * `keepStore`, which is set to `keepQuantity`. Bounds the write count to
   * however many locations actually hold stock, rather than `zeroEverywhere`'s
   * every-existing-row sweep. Returns the plan it executed, for logging.
   */
  async zeroExceptStore(sku: string, keepStore: string, keepQuantity: number): Promise<TargetedZeroPlan> {
    const locations = await this.getAllLocationsForSku(sku);
    const plan = planTargetedZero(locations, keepStore, keepQuantity);
    for (const batch of chunk(plan.zero, ZERO_BATCH_SIZE)) {
      await Promise.all(batch.map((store) => this.setStock(sku, 0, store)));
    }
    await this.setStock(sku, plan.keep.quantity, plan.keep.store);
    return plan;
  }

  /** Current quantity at every existing location for each SKU. */
  async snapshotInventory(skus: string[]): Promise<Record<string, Record<string, number>>> {
    const snapshot: Record<string, Record<string, number>> = {};
    for (const sku of skus) {
      const locations = await this.getAllLocationsForSku(sku);
      snapshot[sku] = Object.fromEntries(locations.map((l) => [l.store, l.quantity]));
    }
    return snapshot;
  }
}
