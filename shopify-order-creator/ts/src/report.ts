/**
 * Run reports: JSON artifact (diffable between runs) + markdown summary.
 *
 * The JSON is the consistency signal: --repeat N runs the identical set N
 * times and diffs the *stable signatures* of each run (pass/fail + failing
 * check per case, excluding volatile fields like order ids and timings). Any
 * variance between identical runs is flagged - that's the race-condition
 * detector.
 *
 * Reports are deliberately disposable (JJ, 2026-08-06): the verdict matters at
 * the time of the run, and anything worth keeping gets written up in CLAUDE.md
 * or on the ticket. So each run prunes the directory back to the REPORT_RETENTION
 * most recent runs - see pruneReports().
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

/** How many runs' reports to keep on disk. Older ones are deleted after each run. */
export const REPORT_RETENTION = 10;

/** Matches the names writeReports() produces: regression_<STORE>_<stamp>.{md,json}. */
const REPORT_NAME = /^regression_[A-Z]+_(\d{8}T\d{6}Z)\.(md|json)$/;

/**
 * Pure half of the retention policy, so it can be tested without a filesystem.
 * Groups report filenames by run (the <STORE>_<stamp> stem shared by the .md and
 * .json of one run), keeps the `keep` newest stems, and returns the filenames
 * belonging to every older run.
 *
 * Only ever selects names matching REPORT_NAME - anything else in the directory
 * (a hand-saved report, the old regression-report.md dry-run sample, a stray
 * note) is left alone rather than swept up by a glob.
 */
export function reportsToPrune(fileNames: string[], keep: number = REPORT_RETENTION): string[] {
  const byStem = new Map<string, { stamp: string; names: string[] }>();
  for (const name of fileNames) {
    const match = REPORT_NAME.exec(name);
    if (!match) {
      continue;
    }
    const stem = name.replace(/\.(md|json)$/, "");
    const group = byStem.get(stem);
    if (group) {
      group.names.push(name);
    } else {
      byStem.set(stem, { stamp: match[1], names: [name] });
    }
  }
  // Order by the run's timestamp, NOT by filename: the store code precedes the
  // stamp in the name, so a lexical sort of the whole stem would group by store
  // first and prune a recent PS run ahead of an older US one. Stamps are
  // ISO-8601 basic UTC, so they compare correctly as strings.
  const stems = [...byStem.entries()].sort((a, b) => (a[1].stamp < b[1].stamp ? -1 : a[1].stamp > b[1].stamp ? 1 : 0));
  const doomed = stems.slice(0, Math.max(0, stems.length - keep));
  return doomed.flatMap(([, group]) => group.names).sort();
}

/**
 * Deletes all but the `keep` most recent runs' reports from `dir`. Best-effort
 * by design: a report that can't be removed (permissions, a file open in an
 * editor) must never fail a regression run that otherwise passed, so failures
 * are warned about and swallowed. Returns the filenames actually deleted.
 */
export function pruneReports(dir: string, keep: number = REPORT_RETENTION): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const deleted: string[] = [];
  for (const name of reportsToPrune(entries, keep)) {
    try {
      fs.unlinkSync(path.join(dir, name));
      deleted.push(name);
    } catch (error) {
      console.warn(`[reports] could not prune ${name}: ${(error as Error).message}`);
    }
  }
  return deleted;
}

/**
 * Writes <stamp>.json and <stamp>.md under reportDir, then prunes older runs
 * back to REPORT_RETENTION. Returns paths + verdict.
 */
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

  const pruned = pruneReports(out);
  if (pruned.length > 0) {
    console.log(`[reports] pruned ${pruned.length / 2} older run(s), keeping the ${REPORT_RETENTION} most recent`);
  }

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
