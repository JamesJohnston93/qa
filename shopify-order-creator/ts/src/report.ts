/**
 * Run reports: JSON artifact (diffable between runs) + markdown summary.
 * Ports regression/report.py.
 *
 * The JSON is the consistency signal: --repeat N runs the identical set N
 * times and diffs the *stable signatures* of each run (pass/fail + failing
 * check per case, excluding volatile fields like order ids and timings). Any
 * variance between identical runs is flagged - that's the race-condition
 * detector.
 */

import * as fs from "fs";
import * as path from "path";
import type { CaseResult, RunSummary } from "./runner";
import type { RegressionConfig } from "./config";

export interface ReportPaths {
  markdown: string;
  json: string;
  passed: boolean;
}

export interface StableSignatureEntry {
  passed: boolean;
  failedCheck: string | null;
}

export type StableSignature = Record<string, StableSignatureEntry>;

export interface RepeatDiff {
  consistent: boolean;
  variance: Record<string, Array<StableSignatureEntry | undefined>>;
}

/** Deterministic view of a run: what should be identical across repeats. */
export function stableSignature(runResult: RunSummary): StableSignature {
  const signature: StableSignature = {};
  for (const result of runResult.cases) {
    signature[result.case] = {
      passed: result.passed,
      failedCheck: result.error?.check ?? null,
    };
  }
  return signature;
}

function signaturesEqual(a: StableSignatureEntry | undefined, b: StableSignatureEntry | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.passed === b.passed && a.failedCheck === b.failedCheck;
}

/**
 * Compares stable signatures across repeated identical runs. Returns
 * {consistent, variance: {case: [per-run signature, ...]}}.
 */
export function diffRepeats(runs: RunSummary[]): RepeatDiff {
  const signatures = runs.map(stableSignature);
  const variance: Record<string, Array<StableSignatureEntry | undefined>> = {};
  for (const caseName of Object.keys(signatures[0] ?? {})) {
    const seen = signatures.map((sig) => sig[caseName]);
    if (seen.some((entry) => !signaturesEqual(entry, seen[0]))) {
      variance[caseName] = seen;
    }
  }
  return { consistent: Object.keys(variance).length === 0, variance };
}

/** Writes <stamp>.json and <stamp>.md under reportDir. Returns paths + verdict. */
export function writeReports(config: RegressionConfig, runs: RunSummary[], outDir?: string): ReportPaths {
  const out = outDir ?? config.reportDir;
  fs.mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = path.join(out, `regression_${config.store}_${stamp}`);

  const repeatDiff: RepeatDiff = runs.length > 1 ? diffRepeats(runs) : { consistent: true, variance: {} };
  const allPassed = runs.every((r) => r.passed);
  const verdict = allPassed && repeatDiff.consistent;

  const payload = {
    store: config.store,
    timestamp: stamp,
    repeat: runs.length,
    passed: verdict,
    repeatConsistent: repeatDiff.consistent,
    variance: repeatDiff.variance,
    runs,
  };

  const jsonPath = `${base}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  const markdownPath = `${base}.md`;
  fs.writeFileSync(markdownPath, renderMarkdown(payload));

  return { json: jsonPath, markdown: markdownPath, passed: verdict };
}

interface ReportPayload {
  store: string;
  timestamp: string;
  repeat: number;
  passed: boolean;
  repeatConsistent: boolean;
  variance: Record<string, Array<StableSignatureEntry | undefined>>;
  runs: RunSummary[];
}

function renderFailure(result: CaseResult): string {
  if (result.passed || !result.error) {
    return "";
  }
  const e = result.error;
  return `\`${e.check}\` expected ${JSON.stringify(e.expected)} got ${JSON.stringify(e.actual)} ${e.detail ?? ""}`.trim();
}

function renderMarkdown(payload: ReportPayload): string {
  const lines: string[] = [
    `# Regression run — ${payload.store} — ${payload.timestamp}`,
    "",
    `**Verdict: ${payload.passed ? "PASS" : "FAIL"}**` +
      (payload.repeat > 1
        ? ` · ${payload.repeat} repeats, ${payload.repeatConsistent ? "consistent" : "VARIANCE DETECTED"}`
        : ""),
    "",
  ];

  if (Object.keys(payload.variance).length > 0) {
    lines.push("## ⚠ Repeat variance (race-condition signal)", "");
    for (const [caseName, seen] of Object.entries(payload.variance)) {
      lines.push(`- **${caseName}**: ` + seen.map((entry) => JSON.stringify(entry)).join(" | "));
    }
    lines.push("");
  }

  payload.runs.forEach((run, index) => {
    if (payload.repeat > 1) {
      lines.push(`## Run ${index + 1}`, "");
    }
    lines.push("| Case | Order | Result | Stage timings (s) | Failure |", "| --- | --- | --- | --- | --- |");
    for (const result of run.cases) {
      const timings = result.stages.map((s) => `${s.name}=${s.elapsed}`).join(", ");
      const status = result.passed ? "✅ pass" : "❌ fail";
      lines.push(`| ${result.case} | ${result.orderName || "—"} | ${status} | ${timings} | ${renderFailure(result)} |`);
    }
    lines.push("");
  });

  lines.push(
    "---",
    "_Stage timings feed PollWindows tuning (config.ts). A stage passing near its timeout is a drift signal._",
  );
  return lines.join("\n");
}
