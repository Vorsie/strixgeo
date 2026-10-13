/**
 * Pins for the walker's report formatter (explicit vitest imports, see
 * walkerPolicy.test.ts).
 */

import { describe, it, expect } from 'vitest'

import { formatReport, summaryLine, totalSummaryLine, type ReportFinding, type RunMeta } from './walkerReport'

const META: RunMeta = {
  seed: 12345,
  steps: 300,
  stepBudget: 300,
  timeBudgetS: 900,
  durationS: 42.5,
  stagesVisited: ['Data', 'Sections'],
  projectId: 'p-1',
  startedAt: '2026-09-06T23:00:00.000Z',
  appCrashed: false,
}

describe('walker report -- summary line', () => {
  it('is the grep-stable "WALKER: <n> findings"', () => {
    expect(summaryLine([])).toBe('WALKER: 0 findings')
    expect(summaryLine([{ step: 1, invariant: 'phantom-row', detail: 'x' }])).toBe('WALKER: 1 findings')
  })
})

describe('walker report -- markdown', () => {
  it('carries the summary line and the seed even with no findings', () => {
    const md = formatReport(META, [])
    expect(md).toContain('WALKER: 0 findings')
    expect(md).toContain('WALKER_SEED')
    expect(md).toContain('12345')
  })

  it('renders each finding with its detail and last-steps repro trail', () => {
    const findings: ReportFinding[] = [
      {
        step: 12,
        invariant: 'refused-request',
        detail: '500 POST /projects/p/geology',
        screenshot: 'step-12.png',
        trail: ['step 10: click <button>', 'step 11: right-click <canvas>', 'step 12: click <button#x>'],
      },
    ]
    const md = formatReport(META, findings)
    expect(md).toContain('WALKER: 1 findings')
    expect(md).toContain('[refused-request] step 12')
    expect(md).toContain('500 POST /projects/p/geology')
    expect(md).toContain('step-12.png')
    // The trail stamps step numbers ending at the finding's step.
    expect(md).toContain('step 12: click <button#x>')
  })
})

// WALKER_RUNS (owner 2026-10-13): N independent walks in one invocation. The
// gate stays "0 findings over all runs", so the line the session main greps
// keeps its prefix and counts every run.
describe('walker report -- total over several runs', () => {
  it('sums the findings of every run and keeps the grep-stable prefix', () => {
    expect(totalSummaryLine([0, 2, 1], 3)).toBe('WALKER: 3 findings over 3 of 3 runs')
  })

  it('says when not every planned run reported (a crashed run)', () => {
    expect(totalSummaryLine([0], 2)).toBe('WALKER: 0 findings over 1 of 2 runs')
  })

  it('one finding in any run is not a pass', () => {
    expect(totalSummaryLine([0, 0, 1], 3).startsWith('WALKER: 0 findings')).toBe(false)
  })
})
