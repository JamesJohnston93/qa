"use strict";
/**
 * Explicit configuration for regression runs.
 *
 * Everything a run needs is carried in a RegressionConfig — no module
 * globals, no interactive prompts. Build one per run (the CLI does this from
 * argv) and pass it down.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_POLL_WINDOWS = exports.BASELINE_CUSTOMERS = exports.ALL_LOCATIONS = exports.PS_STORE = exports.CHERMSIDE_US = exports.STORE_99 = exports.WEB_DC = void 0;
exports.defaultConfig = defaultConfig;
exports.customerFor = customerFor;
exports.validateConfig = validateConfig;
// ---------------------------------------------------------------------------
// ATP locations (staging)
// ---------------------------------------------------------------------------
exports.WEB_DC = "ATP#100"; // web distribution centre
exports.STORE_99 = "ATP#99";
exports.CHERMSIDE_US = "ATP#407"; // BRANCH_407 (US)
exports.PS_STORE = "ATP#640"; // BRANCH_640 (PS)
exports.ALL_LOCATIONS = [exports.WEB_DC, exports.STORE_99, exports.CHERMSIDE_US, exports.PS_STORE];
exports.BASELINE_CUSTOMERS = {
    US: {
        id: "gid://shopify/Customer/8997370954001",
        email: "jared.davis@universalstore.com.au",
        firstName: "Jared",
        lastName: "Davis",
    },
    PS: {
        id: "gid://shopify/Customer/22959422669092",
        email: "jared.davis@universalstore.com.au",
        firstName: "Jared",
        lastName: "Davis",
    },
};
exports.DEFAULT_POLL_WINDOWS = {
    interval: 5,
    ordersTable: 120,
    shipmentsTable: 180,
    allocation: 240,
    refund: 300,
    cleanup: 300,
    inventory: 240,
};
function defaultConfig() {
    return {
        store: "US",
        repeat: 1,
        reportDir: "./reports",
        verbose: true,
        help: false,
        listCases: false,
        awsRegion: process.env.AWS_REGION ?? "ap-southeast-2",
        awsProfile: process.env.AWS_PROFILE ?? "staging",
        inventoryTable: "staging-inventory-v2",
        ordersTable: "staging-orders-v2",
        shipmentsTable: "staging-shipments",
        poll: { ...exports.DEFAULT_POLL_WINDOWS },
    };
}
function customerFor(config) {
    return exports.BASELINE_CUSTOMERS[config.store];
}
function validateConfig(config) {
    if (config.store !== "US" && config.store !== "PS") {
        throw new Error(`store must be US or PS, got ${config.store}`);
    }
    if (config.repeat < 1) {
        throw new Error("repeat must be >= 1");
    }
}
