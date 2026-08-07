"use strict";
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
exports.REPORT_RETENTION = void 0;
exports.stableSignature = stableSignature;
exports.diffRepeats = diffRepeats;
exports.reportsToPrune = reportsToPrune;
exports.pruneReports = pruneReports;
exports.writeReports = writeReports;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Deterministic view of a run: what should be identical across repeats. */
function stableSignature(runResult) {
    const signature = {};
    for (const result of runResult.cases) {
        signature[result.case] = {
            passed: result.passed,
            failedCheck: result.error?.check ?? null,
        };
    }
    return signature;
}
function signaturesEqual(a, b) {
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
function diffRepeats(runs) {
    const signatures = runs.map(stableSignature);
    const variance = {};
    for (const caseName of Object.keys(signatures[0] ?? {})) {
        const seen = signatures.map((sig) => sig[caseName]);
        if (seen.some((entry) => !signaturesEqual(entry, seen[0]))) {
            variance[caseName] = seen;
        }
    }
    return { consistent: Object.keys(variance).length === 0, variance };
}
/** How many runs' reports to keep on disk. Older ones are deleted after each run. */
exports.REPORT_RETENTION = 10;
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
function reportsToPrune(fileNames, keep = exports.REPORT_RETENTION) {
    const byStem = new Map();
    for (const name of fileNames) {
        const match = REPORT_NAME.exec(name);
        if (!match) {
            continue;
        }
        const stem = name.replace(/\.(md|json)$/, "");
        const group = byStem.get(stem);
        if (group) {
            group.names.push(name);
        }
        else {
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
function pruneReports(dir, keep = exports.REPORT_RETENTION) {
    let entries;
    try {
        entries = fs.readdirSync(dir);
    }
    catch {
        return [];
    }
    const deleted = [];
    for (const name of reportsToPrune(entries, keep)) {
        try {
            fs.unlinkSync(path.join(dir, name));
            deleted.push(name);
        }
        catch (error) {
            console.warn(`[reports] could not prune ${name}: ${error.message}`);
        }
    }
    return deleted;
}
/**
 * Writes <stamp>.json and <stamp>.md under reportDir, then prunes older runs
 * back to REPORT_RETENTION. Returns paths + verdict.
 */
function writeReports(config, runs, outDir) {
    const out = outDir ?? config.reportDir;
    fs.mkdirSync(out, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const base = path.join(out, `regression_${config.store}_${stamp}`);
    const repeatDiff = runs.length > 1 ? diffRepeats(runs) : { consistent: true, variance: {} };
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
        console.log(`[reports] pruned ${pruned.length / 2} older run(s), keeping the ${exports.REPORT_RETENTION} most recent`);
    }
    return { json: jsonPath, markdown: markdownPath, passed: verdict };
}
function renderFailure(result) {
    if (result.passed || !result.error) {
        return "";
    }
    const e = result.error;
    return `\`${e.check}\` expected ${JSON.stringify(e.expected)} got ${JSON.stringify(e.actual)} ${e.detail ?? ""}`.trim();
}
function renderMarkdown(payload) {
    const lines = [
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
    lines.push("---", "_Stage timings feed PollWindows tuning (config.ts). A stage passing near its timeout is a drift signal._");
    return lines.join("\n");
}
