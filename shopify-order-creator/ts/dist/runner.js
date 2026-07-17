"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCase = runCase;
exports.run = run;
const config_1 = require("./config");
const orderFlow_1 = require("./flows/orderFlow");
const assertions_1 = require("./verification/assertions");
async function runCase(config = config_1.DEFAULT_CONFIG, caseDef) {
    const startedAt = Date.now();
    const order = await (0, orderFlow_1.createOrder)(config, { demo_sku: 1 });
    (0, assertions_1.assertOrderShape)(order);
    const elapsedMs = Date.now() - startedAt;
    return {
        case: caseDef.name,
        store: config.store,
        description: caseDef.description,
        passed: true,
        orderId: order.orderId,
        orderName: order.orderName,
        stages: [{ name: "create_order", elapsed: round(elapsedMs / 1000) }],
    };
}
async function run(config = config_1.DEFAULT_CONFIG) {
    const results = [];
    for (const caseDef of config_1.CASES) {
        results.push(await runCase(config, caseDef));
    }
    return {
        store: config.store,
        cases: results,
        passed: results.every((result) => result.passed),
    };
}
function round(value) {
    return Number(value.toFixed(1));
}
