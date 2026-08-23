"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * TAA-31 slice D prep — one-shot write: top up STORE_99 (ATP#99) for a SKU.
 * Not wired into index.ts/cli.ts. Used to test whether seeding a harness-
 * controlled backup store immediately before a reject call gives the
 * reallocator a reliable target, given slice C/D-prep found this SKU's
 * ambient real per-store stock is thin and mostly exhausted.
 *
 * Usage: node dist/probe-seed-store99.js <sku> [qty=99]
 */
const config_1 = require("./config");
const dynamo_1 = require("./clients/dynamo");
async function main() {
    const sku = process.argv[2];
    const qty = Number(process.argv[3] ?? 99);
    if (!sku) {
        throw new Error("usage: node dist/probe-seed-store99.js <sku> [qty=99]");
    }
    const dynamo = new dynamo_1.DynamoClient((0, config_1.defaultConfig)());
    await dynamo.setStock(sku, qty, config_1.STORE_99);
    console.log(`Set ${sku} @ ${config_1.STORE_99} to qty ${qty}`);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
