#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cli_1 = require("./cli");
async function main() {
    await (0, cli_1.runCli)();
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
