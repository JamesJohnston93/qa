"use strict";
/**
 * DynamoDB access to staging-inventory-v2 (stock read/write/seed). Read-only
 * access to staging-orders-v2/staging-shipments (confirmed schema) lives
 * separately in readers/dynamoReader.ts.
 *
 * Failures always throw here — no soft/silent mode, no swallow-and-continue
 * fallback. Every AWS failure is a hard failure by design.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoClient = void 0;
exports.chunk = chunk;
exports.planTargetedZero = planTargetedZero;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const credential_providers_1 = require("@aws-sdk/credential-providers");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
/** Bounded-concurrency batch size for zeroEverywhere's writes (TAA-14 Phase A). */
const ZERO_BATCH_SIZE = 25;
/** Splits items into fixed-size chunks, preserving order. Pure — offline-testable. */
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
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
function planTargetedZero(locations, keepStore, keepQuantity) {
    const zero = locations.filter((loc) => loc.quantity > 0 && loc.store !== keepStore).map((loc) => loc.store);
    return { zero, keep: { store: keepStore, quantity: keepQuantity } };
}
class DynamoClient {
    config;
    doc;
    constructor(config) {
        this.config = config;
        const client = new client_dynamodb_1.DynamoDBClient({
            region: config.awsRegion,
            credentials: (0, credential_providers_1.fromSSO)({ profile: config.awsProfile }),
        });
        this.doc = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
    }
    /** Current quantity for a SKU at a given ATP location, or null if no record exists. */
    async getStock(sku, storeKey) {
        const result = await this.doc.send(new lib_dynamodb_1.GetCommand({
            TableName: this.config.inventoryTable,
            Key: { sku, store: storeKey },
        }));
        if (!result.Item) {
            return null;
        }
        return Number(result.Item.quantity ?? 0);
    }
    /** Upserts the stock quantity for a SKU at a given ATP location. Throws on AWS failure. */
    async setStock(sku, quantity, storeKey) {
        const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
        await this.doc.send(new lib_dynamodb_1.UpdateCommand({
            TableName: this.config.inventoryTable,
            Key: { sku, store: storeKey },
            UpdateExpression: "SET quantity = :qty, updatedAt = :ts, updatedReason = :reason",
            ExpressionAttributeValues: {
                ":qty": quantity,
                ":ts": now,
                ":reason": "TS_REGRESSION",
            },
        }));
    }
    /**
     * Every ATP location row that exists for a SKU: [{store, quantity}, ...].
     *
     * The inventory table's PK is the SKU, so one Query surfaces every
     * location — including stores beyond the four ALL_LOCATIONS knows about.
     * Critical for undeliverable cases: zeroing only known locations is not
     * enough if some other store row still holds stock.
     */
    async getAllLocationsForSku(sku) {
        const result = await this.doc.send(new lib_dynamodb_1.QueryCommand({
            TableName: this.config.inventoryTable,
            KeyConditionExpression: "sku = :sku",
            ExpressionAttributeValues: { ":sku": sku },
        }));
        return (result.Items ?? []).map((item) => ({
            store: String(item.store),
            quantity: Number(item.quantity ?? 0),
        }));
    }
    /** Applies an explicit seed plan: {sku: {location: qty}}. Throws on any AWS failure. */
    async seedInventory(seedPlan) {
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
    async zeroEverywhere(sku) {
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
    async zeroExceptStore(sku, keepStore, keepQuantity) {
        const locations = await this.getAllLocationsForSku(sku);
        const plan = planTargetedZero(locations, keepStore, keepQuantity);
        for (const batch of chunk(plan.zero, ZERO_BATCH_SIZE)) {
            await Promise.all(batch.map((store) => this.setStock(sku, 0, store)));
        }
        await this.setStock(sku, plan.keep.quantity, plan.keep.store);
        return plan;
    }
    /** Current quantity at every existing location for each SKU. */
    async snapshotInventory(skus) {
        const snapshot = {};
        for (const sku of skus) {
            const locations = await this.getAllLocationsForSku(sku);
            snapshot[sku] = Object.fromEntries(locations.map((l) => [l.store, l.quantity]));
        }
        return snapshot;
    }
}
exports.DynamoClient = DynamoClient;
