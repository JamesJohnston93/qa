import { DEFAULT_CONFIG } from "./config";
import { run } from "./runner";
import { writeReport } from "./report";

async function main(): Promise<void> {
  console.log("QA TypeScript rewrite scaffold initialized");
  const summary = await run(DEFAULT_CONFIG);
  const reportPaths = writeReport(summary);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report markdown: ${reportPaths.markdown}`);
  console.log(`Report json: ${reportPaths.json}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
