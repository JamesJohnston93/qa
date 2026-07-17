import { run } from "./runner";
import { writeReport } from "./report";
import { BASELINE_CASES } from "./cases/baselineCases";
import { DEFAULT_CONFIG, type RegressionConfig, type Store } from "./config";

export function printHelp(): void {
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

export function printCases(): void {
  for (const entry of BASELINE_CASES) {
    console.log(`- ${entry.name}: ${entry.description}`);
  }
}

export function parseArgs(argv: string[]): RegressionConfig {
  const config: RegressionConfig = { ...DEFAULT_CONFIG };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--store" && argv[index + 1]) {
      config.store = argv[index + 1] as Store;
      index += 1;
    } else if (argument === "--repeat" && argv[index + 1]) {
      config.repeat = Number(argv[index + 1]);
      index += 1;
    } else if (argument === "--quiet") {
      config.verbose = false;
    } else if (argument === "--cases" && argv[index + 1]) {
      config.caseNames = argv[index + 1].split(",").map((entry) => entry.trim()).filter(Boolean);
      index += 1;
    } else if (argument === "--report-dir" && argv[index + 1]) {
      config.reportDir = argv[index + 1];
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      config.help = true;
    } else if (argument === "--list-cases") {
      config.listCases = true;
    }
  }
  return config;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const config = parseArgs(argv);
  if (config.help) {
    printHelp();
    return;
  }
  if (config.listCases) {
    printCases();
    return;
  }
  const summary = await run(config);
  const reportPaths = writeReport(summary, config.reportDir);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report markdown: ${reportPaths.markdown}`);
  console.log(`Report json: ${reportPaths.json}`);
}
