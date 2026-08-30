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
/**
 * The stage names a case runs through, in order — varies by refund vs
 * no-refund path, by whether the case also drives a fulfilment (TAA-39:
 * fulfil_single/fulfil_split), and now by whether it drives a reject (TAA-31:
 * reject_reallocate/reject_undeliverable). This list is hand-maintained, NOT
 * derived from runner.ts's actual stageDone() calls — any new stage
 * runner.ts adds must be added here too, or run progress/ETA silently drift
 * out of sync with what's actually happening.
 *
 * `rejectMode: "reallocate"` inserts `reject_seed` (the mid-flight backup-
 * store top-up slice D's design needs, since ambient real stock for this
 * SKU is too thin to trust), `reject`, and `reject_transactions` (TAA-31
 * slice G: confirms the SHIPMENT_REJECTED/SHIPMENT_ITEM_REJECTED
 * TRANSACTION# rows) before the refund branch, and SKIPS `inventory`
 * entirely — the mid-flight top-up perturbs the before/after snapshot
 * `assertDecrements` compares, so this case doesn't run that check (see
 * `ts/signoffs/TAA-31-slice-f.md`). `rejectMode: "undeliverable"` inserts
 * `reject` and `reject_transactions` (no mid-flight seed — slice E's audited
 * targeted-zero happens entirely in `seed_inventory`) and keeps `inventory`,
 * since nothing moves between stores after the reject.
 *
 * `orders_table_refund` (TAA-59) inserts after `cleanup` only when
 * `hasRefund && !rejectMode`: the plain undeliverable/partial_undeliverable
 * refund path, not `reject_undeliverable`'s (that case also carries a
 * non-empty expectedRefundSkus but reaches its refund through the reject
 * endpoint, a different, unconfirmed-shape pathway, deliberately excluded,
 * see ts/plans/TAA-59-plan.md).
 */
function stageSequenceFor(hasRefund, hasFulfilment = false, rejectMode = undefined) {
    const rejectStages = rejectMode === "reallocate"
        ? ["reject_seed", "reject", "reject_transactions"]
        : rejectMode === "undeliverable"
            ? ["reject", "reject_transactions"]
            : [];
    const refundStages = hasRefund
        ? ["refund", "cleanup", ...(rejectMode ? [] : ["orders_table_refund"])]
        : ["no_refund"];
    return [
        "seed_inventory",
        "create_order",
        "shopify_readback",
        "orders_table",
        "allocation",
        ...rejectStages,
        ...refundStages,
        ...(rejectMode === "reallocate" ? [] : ["inventory"]),
        ...(hasFulfilment ? ["fulfil", "fulfilment_verify", "allocation_reflection"] : []),
    ];
}
/**
 * The full ordered stage plan for a run: every case, every repeat.
 * `hasFulfilmentFor`/`rejectModeFor` default to "no case fulfils/rejects" so
 * existing callers (and offline tests) that only know about refund vs
 * no-refund keep working unchanged.
 */
function buildRunPlan(caseNames, hasRefundFor, totalRepeats, hasFulfilmentFor = () => false, rejectModeFor = () => undefined) {
    const plan = [];
    for (let repeatIndex = 0; repeatIndex < totalRepeats; repeatIndex += 1) {
        caseNames.forEach((caseName, caseIndex) => {
            plan.push({
                repeatIndex,
                caseIndex,
                caseName,
                stages: stageSequenceFor(hasRefundFor(caseName), hasFulfilmentFor(caseName), rejectModeFor(caseName)),
            });
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
