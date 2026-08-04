/**
 * DynamoDB access to staging-inventory-v2 (ports aws_inventory.py / the
 * flows.py inventory helpers). Read-only access to staging-orders-v2 and
 * staging-shipments lives in readers/dynamoReader.ts, which is schema-guarded
 * separately (TABLE_SCHEMAS there is unconfirmed until the schema probe runs).
 *
 * Failures always throw here — no soft/silent mode. The Python CLI's
 * `ensure_stock` swallow-on-error behaviour is a CLI-only convenience; the
 * regression harness treats every AWS failure as a hard failure by design.
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
