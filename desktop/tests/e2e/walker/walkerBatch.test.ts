/**
 * Pins for the walker's batch file (WALKER_RUNS, owner 2026-10-13).
 *
 * The rule: N runs use seeds seed, seed+1, ... and the summary counts findings
 * over ALL runs -- also when a crashed run made Playwright restart the worker
 * and re-evaluate the spec (the in-memory state is gone; the file is not).
 *
 * Explicit vitest imports (see walkerPolicy.test.ts for why).
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { batchFilePath, loadBatch, recordRun } from './walkerBatch'

const made: string[] = []

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-batch-test-'))
  made.push(dir)
  return batchFilePath(path.join(dir, 'walker'), 4242)
}

afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('walker batch -- the base seed survives a worker restart', () => {
  it('the first load draws the seed; every later load reads it back', () => {
    const file = tmpFile()
    expect(loadBatch(file, () => 7).baseSeed).toBe(7)
    // A restarted worker would draw a different random seed -- it must not be used.
    expect(loadBatch(file, () => 999).baseSeed).toBe(7)
  })
})

describe('walker batch -- every run is counted', () => {
  it('keeps each run once, in run order', () => {
    const file = tmpFile()
    loadBatch(file, () => 7)
    recordRun(file, { index: 2, seed: 8, findings: 1, appCrashed: false, resultsDir: 'b' })
    recordRun(file, { index: 1, seed: 7, findings: 0, appCrashed: true, resultsDir: 'a' })
    recordRun(file, { index: 2, seed: 8, findings: 3, appCrashed: false, resultsDir: 'b' })
    const runs = loadBatch(file, () => 0).runs
    expect(runs.map(r => [r.index, r.findings])).toEqual([
      [1, 0],
      [2, 3],
    ])
  })
})
