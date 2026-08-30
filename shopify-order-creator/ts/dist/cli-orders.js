"use strict";
/**
 * Hold lifecycle CLI (TAA-54) — `node dist/index.js orders ...`. Opt-in,
 * separate from the default regression suite (`cli.ts`, TAA-59's territory
 * this wave, not edited here). Follows cli-fulfil.ts's parse/print shape.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.printOrdersHelp = printOrdersHelp;
exports.parseOrdersArgs = parseOrdersArgs;
exports.runOrdersCli = runOrdersCli;
const ordersCases_1 = require("./cases/ordersCases");
const ordersRunner_1 = require("./ordersRunner");
function printOrdersHelp() {
    console.log(`Usage: node dist/index.js orders --store <US|PS> [--cases <name,...>]

Runs the hold lifecycle cases (TC7-12, TAA-54) against real staging: fraud
holds (fulfillmentOrderHold/ReleaseHold) and outstanding-payment holds (an
order edit that adds an unpaid item, released via orderMarkAsPaid). Opt-in —
not part of the default regression suite, and always runs sequentially (one
order per case, no concurrent scheduling).

  --store <US|PS>         Target store (default: US)
  --cases <name,...>      Run only the named case(s) (default: all six)
  --help, -h              Show this help text

Cases: ${ordersCases_1.ORDERS_CASE_NAMES.join(", ")}

Requires the usual Shopify/AWS staging environment (see CLAUDE.md).
`);
}
function parseOrdersArgs(argv) {
    const config = { help: false, store: "US" };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h") {
            config.help = true;
        }
        else if (arg === "--store" && argv[index + 1]) {
            const value = argv[index + 1];
            if (value !== "US" && value !== "PS") {
                throw new Error(`--store must be US or PS, got "${value}"`);
            }
            config.store = value;
            index += 1;
        }
        else if (arg === "--cases" && argv[index + 1]) {
            config.cases = argv[index + 1].split(",").map((name) => name.trim()).filter(Boolean);
            index += 1;
        }
        else {
            throw new Error(`Unknown argument: "${arg}"`);
        }
    }
    return config;
}
async function runOrdersCli(argv) {
    const config = parseOrdersArgs(argv);
    if (config.help) {
        printOrdersHelp();
        return;
    }
    const result = await (0, ordersRunner_1.runOrdersSuite)(config.store, config.cases);
    const passedCount = result.cases.filter((c) => c.passed).length;
    console.log(`\n${passedCount}/${result.cases.length} orders case(s) passed on ${result.store}`);
    if (!result.passed) {
        process.exitCode = 1;
    }
}
