#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cli_1 = require("./cli");
const cli_order_1 = require("./cli-order");
async function main() {
    const argv = process.argv.slice(2);
    if (argv[0] === "order") {
        await (0, cli_order_1.runOrderCli)(argv.slice(1));
    }
    else {
        await (0, cli_1.runCli)();
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
