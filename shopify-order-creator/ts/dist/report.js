"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeReport = writeReport;
function writeReport(summary) {
    const markdown = [
        "# QA TypeScript Regression Run",
        "",
        `Store: ${summary.store}`,
        "",
        ...summary.cases.map((entry) => `- ${entry.case}: ${entry.passed ? "PASS" : "FAIL"} (${entry.orderId})`),
        "",
    ].join("\n");
    const outDir = "./reports";
    const fs = require("fs");
    const path = require("path");
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
