/**
 * The walker's batch file: one per Playwright invocation (``WALKER_RUNS``).
 *
 * Each run is its own Playwright test. A crashed run fails its test, and
 * Playwright then RESTARTS the worker, which re-evaluates the spec module: any
 * in-memory base seed or running total would be lost, the next run would draw
 * a fresh random seed, and the final summary would count only the runs after
 * the crash. The batch file keeps both on disk, keyed by the runner's pid (the
 * worker's parent, which outlives a worker restart).
 */

import fs from 'fs'
import path from 'path'

/** One finished run, as kept in the batch file. */
export interface BatchRun {
  readonly index: number
  readonly seed: number
  readonly findings: number
  readonly appCrashed: boolean
  readonly resultsDir: string
}

/** The invocation's shared state: base seed + finished runs. */
export interface BatchState {
  baseSeed: number
  runs: BatchRun[]
}

/**
 * Path of the batch file for one invocation.
 *
 * @param dir - The walker results root.
 * @param runnerPid - The Playwright runner's pid (``process.ppid`` in a worker).
 */
export function batchFilePath(dir: string, runnerPid: number): string {
  return path.join(dir, `batch-${runnerPid}.json`)
}

/**
 * Read the batch file, or create it with ``newBaseSeed()`` when absent.
 *
 * @param file - The batch file path.
 * @param newBaseSeed - Draws the base seed the first time only.
 * @returns The current state.
 */
export function loadBatch(file: string, newBaseSeed: () => number): BatchState {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BatchState
  } catch {
    const state: BatchState = { baseSeed: newBaseSeed(), runs: [] }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8')
    return state
  }
}

/**
 * Record (or replace) one run's result.
 *
 * @param file - The batch file path (must exist: ``loadBatch`` ran first).
 * @param run - The finished run.
 * @returns The state after the write.
 */
export function recordRun(file: string, run: BatchRun): BatchState {
  const state = loadBatch(file, () => run.seed)
  state.runs = [...state.runs.filter(r => r.index !== run.index), run].sort((a, b) => a.index - b.index)
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8')
  return state
}
