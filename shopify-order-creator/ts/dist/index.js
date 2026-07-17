"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const runner_1 = require("./runner");
const report_1 = require("./report");
async function main() {
    console.log("QA TypeScript rewrite scaffold initialized");
    const summary = await (0, runner_1.run)(config_1.DEFAULT_CONFIG);
    const reportPaths = (0, report_1.writeReport)(summary);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Report markdown: ${reportPaths.markdown}`);
    console.log(`Report json: ${reportPaths.json}`);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
