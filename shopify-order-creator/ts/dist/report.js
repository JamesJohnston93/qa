"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeReport = writeReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function writeReport(summary, reportDir = "./reports") {
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
