"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.printHelp = printHelp;
exports.printCases = printCases;
exports.parseArgs = parseArgs;
exports.runCli = runCli;
const runner_1 = require("./runner");
const report_1 = require("./report");
const baselineCases_1 = require("./cases/baselineCases");
const progress_1 = require("./progress");
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
  --parallel              Run SKU-disjoint cases concurrently (default: off, sequential)
  --concurrency <n>       Max simultaneous cases within a wave under --parallel (default: 4)
  --help, -h              Show this help text
`);
}
function printCases(store = "US") {
    for (const entry of Object.values((0, baselineCases_1.buildCases)(store))) {
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
        else if (argument === "--parallel") {
            config.parallel = true;
        }
        else if (argument === "--concurrency" && argv[index + 1]) {
            config.parallelConcurrency = Number(argv[index + 1]);
            index += 1;
        }
    }
    return config;
}
/**
 * Exit codes (matching python -m regression's contract): 0 = all cases
 * passed and repeats consistent; 1 = any failure or repeat variance.
 */
async function runCli(argv = process.argv.slice(2)) {
    const config = parseArgs(argv);
    if (config.help) {
        printHelp();
        return;
    }
    if (config.listCases) {
        printCases(config.store);
        return;
    }
    (0, config_1.validateConfig)(config);
    // TAA-14 Phase A step 4: one tracker spans the whole --repeat N run, so
    // "run %" and the rolling per-stage-average ETA in the live progress line
    // reflect total progress, not just the current repeat.
    const allCases = (0, baselineCases_1.buildCases)(config.store);
    const names = config.caseNames?.length ? config.caseNames : Object.keys(allCases);
    const plan = (0, progress_1.buildRunPlan)(names, (name) => (allCases[name] ? Object.keys(allCases[name].expectedRefundSkus).length > 0 : false), config.repeat);
    const tracker = (0, progress_1.createProgressTracker)(plan, config.repeat, names.length, Date.now());
    const runs = [];
    for (let i = 0; i < config.repeat; i += 1) {
        if (config.verbose && config.repeat > 1) {
            console.log(`\n######## repeat ${i + 1}/${config.repeat} ########`);
        }
        runs.push(await (0, runner_1.run)(config, tracker, i, config.repeat));
    }
    const reportPaths = (0, report_1.writeReports)(config, runs);
    console.log(`\nReport: ${reportPaths.markdown}`);
    console.log(`JSON:   ${reportPaths.json}`);
    console.log(reportPaths.passed ? "PASS" : "FAIL");
    process.exitCode = reportPaths.passed ? 0 : 1;
}
