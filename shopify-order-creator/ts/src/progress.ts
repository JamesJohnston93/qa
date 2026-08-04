/**
 * Live progress line (TAA-14 Phase A step 4): a single updated-per-poll-tick
 * line showing repeat/case/stage position, time in the current stage,
 * overall run completion %, and elapsed/ETA. Pure, offline-testable —
 * runner.ts/cli.ts wire this to console.log.
 */

export const STAGE_FALLBACK_SECONDS = 9; // ~65s end-to-end / ~7.5 stages per case (TAA-14 ticket baseline)

/** The stage names a case runs through, in order — varies only by refund vs no-refund path. */
export function stageSequenceFor(hasRefund: boolean): string[] {
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

export interface RunPlanEntry {
  repeatIndex: number;
  caseIndex: number;
  caseName: string;
  stages: string[];
}

/** The full ordered stage plan for a run: every case, every repeat. */
export function buildRunPlan(caseNames: string[], hasRefundFor: (name: string) => boolean, totalRepeats: number): RunPlanEntry[] {
  const plan: RunPlanEntry[] = [];
  for (let repeatIndex = 0; repeatIndex < totalRepeats; repeatIndex += 1) {
    caseNames.forEach((caseName, caseIndex) => {
      plan.push({ repeatIndex, caseIndex, caseName, stages: stageSequenceFor(hasRefundFor(caseName)) });
    });
  }
  return plan;
}

export function flattenPlan(plan: RunPlanEntry[]): string[] {
  return plan.flatMap((entry) => entry.stages);
}

export interface StageAverages {
  [stageName: string]: { sum: number; count: number };
}

export function recordStageAverage(averages: StageAverages, name: string, elapsed: number): void {
  const entry = averages[name] ?? { sum: 0, count: 0 };
  entry.sum += elapsed;
  entry.count += 1;
  averages[name] = entry;
}

export function averageFor(averages: StageAverages, name: string, fallback: number = STAGE_FALLBACK_SECONDS): number {
  const entry = averages[name];
  if (!entry || entry.count === 0) {
    return fallback;
  }
  return entry.sum / entry.count;
}

export interface ProgressTracker {
  totalRepeats: number;
  totalCases: number;
  flatPlan: string[]; // every stage name, in run order, across all repeats/cases
  completedStages: number; // count of stages completed so far, anywhere in the run
  averages: StageAverages;
  runStart: number; // Date.now() ms, set once at CLI start
}

export function createProgressTracker(plan: RunPlanEntry[], totalRepeats: number, totalCases: number, runStart: number): ProgressTracker {
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
export function estimateRemainingSeconds(tracker: ProgressTracker, secondsInCurrentStage: number): number {
  const remaining = tracker.flatPlan.slice(tracker.completedStages);
  if (remaining.length === 0) {
    return 0;
  }
  const [current, ...rest] = remaining;
  const currentRemaining = Math.max(0, averageFor(tracker.averages, current) - secondsInCurrentStage);
  const restTotal = rest.reduce((sum, name) => sum + averageFor(tracker.averages, name), 0);
  return currentRemaining + restTotal;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export interface ProgressLineInfo {
  repeatIndex: number; // 0-based
  totalRepeats: number;
  caseIndex: number; // 0-based
  totalCases: number;
  caseName: string;
  stageIndex: number; // 0-based, within this case's own stage sequence
  totalCaseStages: number;
  stageName: string;
  secondsInStage: number;
  completedStages: number; // across the whole run
  totalStages: number; // across the whole run
  elapsedSeconds: number; // since the run (all repeats) started
  etaSeconds: number;
}

export function formatProgressLine(info: ProgressLineInfo): string {
  const pct = info.totalStages > 0 ? Math.round((info.completedStages / info.totalStages) * 100) : 0;
  return (
    `[repeat ${info.repeatIndex + 1}/${info.totalRepeats} · ` +
    `case ${info.caseIndex + 1}/${info.totalCases} ${info.caseName} · ` +
    `stage ${info.stageIndex + 1}/${info.totalCaseStages} ${info.stageName} · ` +
    `${Math.round(info.secondsInStage)}s in stage · ` +
    `run ${pct}% · ` +
    `${formatDuration(info.elapsedSeconds)}/${formatDuration(info.elapsedSeconds + info.etaSeconds)}]`
  );
}
