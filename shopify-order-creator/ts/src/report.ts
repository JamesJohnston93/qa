import type { RunSummary } from "./runner";
import * as fs from "fs";
import * as path from "path";

export interface ReportPaths {
  markdown: string;
  json: string;
  passed: boolean;
}

export function writeReport(summary: RunSummary, reportDir = "./reports"): ReportPaths {
  const markdown = [
    "# QA TypeScript Regression Run",
    "",
    `Store: ${summary.store}`,
    "",
    ...summary.cases.map((entry) => {
      const stageSummary = entry.stages.map((stage) => `${stage.name}=${stage.elapsed.toFixed(1)}s`).join(", ");
      return `- ${entry.case}: ${entry.passed ? "PASS" : "FAIL"} | order=${entry.orderId} | stages=${stageSummary}`;
    }),
    "",
  ].join("\n");

  const outDir = reportDir;
  fs.mkdirSync(outDir, { recursive: true });
  const markdownPath = path.join(outDir, "regression-report.md");
  const jsonPath = path.join(outDir, "regression-report.json");
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  return {
    markdown: markdownPath,
    json: jsonPath,
    passed: summary.passed,
  };
}
