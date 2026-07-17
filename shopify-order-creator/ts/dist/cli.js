"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.printHelp = printHelp;
exports.printCases = printCases;
exports.parseArgs = parseArgs;
exports.runCli = runCli;
const runner_1 = require("./runner");
const report_1 = require("./report");
const baselineCases_1 = require("./cases/baselineCases");
const config_1 = require("./config");
function printHelp() {
    console.log(`Usage: node dist/index.js [options]

Options:
  --store <US|PS>         Target store (default: US)
  --cases <name[,name]>   Comma-separated case names (single,multi,split,undeliverable)
  --repeat <n>            Number of repeats (default: 1)
  --report-dir <path>     Output directory for reports (default: ./reports)
  --quiet                 Disable verbose output in the run summary
  --list-cases            Print the available baseline cases and exit
  --help, -h              Show this help text
`);
}
function printCases() {
    for (const entry of baselineCases_1.BASELINE_CASES) {
        console.log(`- ${entry.name}: ${entry.description}`);
    }
}
function parseArgs(argv) {
    const config = (0, config_1.defaultConfig)();
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--store" && argv[index + 1]) {
            config.store = argv[index + 1];
            index += 1;
        }
        else if (argument === "--repeat" && argv[index + 1]) {
            config.repeat = Number(argv[index + 1]);
            index += 1;
        }
        else if (argument === "--quiet") {
            config.verbose = false;
        }
        else if (argument === "--cases" && argv[index + 1]) {
            config.caseNames = argv[index + 1].split(",").map((entry) => entry.trim()).filter(Boolean);
            index += 1;
        }
        else if (argument === "--report-dir" && argv[index + 1]) {
            config.reportDir = argv[index + 1];
            index += 1;
        }
        else if (argument === "--help" || argument === "-h") {
            config.help = true;
        }
        else if (argument === "--list-cases") {
            config.listCases = true;
        }
    }
    return config;
}
async function runCli(argv = process.argv.slice(2)) {
    const config = parseArgs(argv);
    if (config.help) {
        printHelp();
        return;
    }
    if (config.listCases) {
        printCases();
        return;
    }
    const summary = await (0, runner_1.run)(config);
    const reportPaths = (0, report_1.writeReport)(summary, config.reportDir);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Report markdown: ${reportPaths.markdown}`);
    console.log(`Report json: ${reportPaths.json}`);
}
