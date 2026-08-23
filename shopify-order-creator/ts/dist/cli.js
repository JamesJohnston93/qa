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
const newstoreCases_1 = require("./cases/newstoreCases");
const config_1 = require("./config");
function printHelp() {
    console.log(`Usage: node dist/index.js [options]

Options:
  --store <US|PS>         Target store (default: US)
  --cases <name[,name]>   Comma-separated case names. Default set is all 10:
                          single, multi, unique, split, undeliverable,
                          partial_undeliverable, fulfil_single, fulfil_split
                          (pipeline cases) and ns_sfs, ns_otc (NewStore cases).
                          Use --list-cases for names + descriptions.
  --repeat <n>            Number of repeats (default: 1)
  --report-dir <path>     Output directory for reports (default: ./reports)
  --quiet                 Disable verbose output in the run summary
  --list-cases            Print the available cases and exit
  --sequential            Run cases one at a time (default: parallel).
                          Use for a readable single-case log, or to rule out
                          concurrency when triaging a failure.
  --parallel              Run SKU-disjoint cases concurrently. This is now the
                          default; the flag is kept so existing scripts and
                          docs keep working, and to state the intent explicitly.
  --concurrency <n>       Max simultaneous cases within a wave (default: 4)
  --help, -h              Show this help text

For ad-hoc order placement (not a regression run), use the "order" subcommand:
  node dist/index.js order --help
`);
}
function printCases(store = "US") {
    for (const entry of Object.values((0, baselineCases_1.buildCases)(store))) {
        console.log(`- ${entry.name}: ${entry.description}`);
    }
    for (const entry of Object.values((0, newstoreCases_1.buildNewStoreCases)(store))) {
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
            // Redundant now that parallel is the default, but harmless and kept so
            // older scripts/docs don't break — and so a run can still say so aloud.
            config.parallel = true;
        }
        else if (argument === "--sequential") {
            config.parallel = false;
        }
        else if (argument === "--concurrency" && argv[index + 1]) {
            config.parallelConcurrency = Number(argv[index + 1]);
            index += 1;
        }
    }
    return config;
}
/** Exit codes: 0 = all cases passed and repeats consistent; 1 = any failure or repeat variance. */
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
    // reflect total progress, not just the current repeat. The tracker only
    // plans "pipeline"-kind cases (Shopify/Dynamo stage sequences) — NewStore
    // cases are a separate 2-stage round trip (see runner.ts's run()) and
    // aren't part of this ETA math.
    const allCases = (0, baselineCases_1.buildCases)(config.store);
    const allNewStoreCases = (0, newstoreCases_1.buildNewStoreCases)(config.store);
    const allDefs = { ...allCases, ...allNewStoreCases };
    const names = config.caseNames?.length ? config.caseNames : Object.keys(allDefs);
    const pipelineNames = names.filter((name) => allDefs[name]?.kind === "pipeline");
    const plan = (0, progress_1.buildRunPlan)(pipelineNames, (name) => Object.keys(allCases[name].expectedRefundSkus).length > 0, config.repeat, (name) => allCases[name].fulfilment);
    const tracker = (0, progress_1.createProgressTracker)(plan, config.repeat, pipelineNames.length, Date.now());
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
