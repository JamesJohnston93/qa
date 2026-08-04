"use strict";
/**
 * Live progress line (TAA-14 Phase A step 4): a single updated-per-poll-tick
 * line showing repeat/case/stage position, time in the current stage,
 * overall run completion %, and elapsed/ETA. Pure, offline-testable —
 * runner.ts/cli.ts wire this to console.log.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGE_FALLBACK_SECONDS = void 0;
exports.stageSequenceFor = stageSequenceFor;
exports.buildRunPlan = buildRunPlan;
exports.flattenPlan = flattenPlan;
exports.recordStageAverage = recordStageAverage;
exports.averageFor = averageFor;
exports.createProgressTracker = createProgressTracker;
exports.estimateRemainingSeconds = estimateRemainingSeconds;
exports.formatDuration = formatDuration;
exports.formatProgressLine = formatProgressLine;
exports.STAGE_FALLBACK_SECONDS = 9; // ~65s end-to-end / ~7.5 stages per case (TAA-14 ticket baseline)
/** The stage names a case runs through, in order — varies only by refund vs no-refund path. */
function stageSequenceFor(hasRefund) {
    return [
        "seed_inventory",
        "create_order",
        "shopify_readback",
        "orders_table",
        "allocation",
        ...(hasRefund ? ["refund", "cleanup"] : ["no_refund"]),
        "inventory",
    ];
}
/** The full ordered stage plan for a run: every case, every repeat. */
function buildRunPlan(caseNames, hasRefundFor, totalRepeats) {
    const plan = [];
    for (let repeatIndex = 0; repeatIndex < totalRepeats; repeatIndex += 1) {
        caseNames.forEach((caseName, caseIndex) => {
            plan.push({ repeatIndex, caseIndex, caseName, stages: stageSequenceFor(hasRefundFor(caseName)) });
        });
    }
    return plan;
}
function flattenPlan(plan) {
    return plan.flatMap((entry) => entry.stages);
}
function recordStageAverage(averages, name, elapsed) {
    const entry = averages[name] ?? { sum: 0, count: 0 };
    entry.sum += elapsed;
    entry.count += 1;
    averages[name] = entry;
}
function averageFor(averages, name, fallback = exports.STAGE_FALLBACK_SECONDS) {
    const entry = averages[name];
    if (!entry || entry.count === 0) {
        return fallback;
    }
    return entry.sum / entry.count;
}
function createProgressTracker(plan, totalRepeats, totalCases, runStart) {
    return {
        totalRepeats,
        totalCases,
        flatPlan: flattenPlan(plan),
        completedStages: 0,
        averages: {},
        runStart,
    };
}
/**
 * Rolling-average ETA for everything still to come: the rest of the current
 * stage (its average minus time already spent, floored at 0) plus the
 * average for every stage still pending in the run. Stages with no samples
 * yet fall back to STAGE_FALLBACK_SECONDS.
 */
function estimateRemainingSeconds(tracker, secondsInCurrentStage) {
    const remaining = tracker.flatPlan.slice(tracker.completedStages);
    if (remaining.length === 0) {
        return 0;
    }
    const [current, ...rest] = remaining;
    const currentRemaining = Math.max(0, averageFor(tracker.averages, current) - secondsInCurrentStage);
    const restTotal = rest.reduce((sum, name) => sum + averageFor(tracker.averages, name), 0);
    return currentRemaining + restTotal;
}
function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
function formatProgressLine(info) {
    const pct = info.totalStages > 0 ? Math.round((info.completedStages / info.totalStages) * 100) : 0;
    return (`[repeat ${info.repeatIndex + 1}/${info.totalRepeats} · ` +
        `case ${info.caseIndex + 1}/${info.totalCases} ${info.caseName} · ` +
        `stage ${info.stageIndex + 1}/${info.totalCaseStages} ${info.stageName} · ` +
        `${Math.round(info.secondsInStage)}s in stage · ` +
        `run ${pct}% · ` +
        `${formatDuration(info.elapsedSeconds)}/${formatDuration(info.elapsedSeconds + info.etaSeconds)}]`);
}
