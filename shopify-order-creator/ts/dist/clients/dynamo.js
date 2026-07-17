"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoClient = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const credential_providers_1 = require("@aws-sdk/credential-providers");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
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
    /** Sets quantity to 0 at every location row that exists for this SKU (forces undeliverable deterministically). */
    async zeroEverywhere(sku) {
        const locations = await this.getAllLocationsForSku(sku);
        for (const location of locations) {
            await this.setStock(sku, 0, location.store);
        }
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
