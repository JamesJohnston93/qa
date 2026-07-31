/**
 * SKU-disjoint wave scheduler (TAA-14 Phase B step 3). Cases in the same
 * wave touch no SKU in common, so they're safe to run concurrently; waves
 * run one after another, and a bounded-concurrency pool caps how many
 * cases run at once within a wave — Shopify's Admin API is cost-throttled,
 * so an unbounded Promise.all across a large wave would hit that quickly.
 */

import type { CaseDefinition } from "./cases/baselineCases";

export const DEFAULT_PARALLEL_CONCURRENCY = 4;

function skusFor(caseDef: CaseDefinition): Set<string> {
  return new Set(Object.keys(caseDef.skuQuantities));
}

/**
 * Greedily assigns each case to the earliest wave whose already-assigned
 * cases share no SKU with it. Pure, offline-testable — the "never run two
 * SKU-overlapping cases concurrently" guarantee lives entirely here, not in
 * the caller, and is computed from each case's declared skuQuantities, not
 * assumed from case names or ordering.
 */
export function buildWaves(cases: CaseDefinition[]): CaseDefinition[][] {
  const waves: CaseDefinition[][] = [];
  const waveSkus: Set<string>[] = [];

  for (const caseDef of cases) {
    const skus = skusFor(caseDef);
    let placedInWave = -1;
    for (let i = 0; i < waves.length; i += 1) {
      let overlaps = false;
      for (const s of skus) {
        if (waveSkus[i].has(s)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        placedInWave = i;
        break;
      }
    }
    if (placedInWave === -1) {
      waves.push([caseDef]);
      waveSkus.push(new Set(skus));
    } else {
      waves[placedInWave].push(caseDef);
      for (const s of skus) {
        waveSkus[placedInWave].add(s);
      }
    }
  }

  return waves;
}

/**
 * Runs `items` through `worker`, at most `concurrency` at a time. Results
 * are returned in input order regardless of completion order, so callers
 * don't need to re-sort.
 */
export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function pump(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) {
        return;
      }
      results[i] = await worker(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, pump));
  return results;
}
