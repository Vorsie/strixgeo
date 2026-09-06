/**
 * Pins for the walker's action policy.
 *
 * Explicit vitest imports (not globals) so this file typechecks under
 * ``tsconfig.e2e`` (whose ``types`` array does not include vitest) while still
 * running under Vitest. Playwright never runs it -- the config's testMatch is
 * ``**\/*.spec.ts``.
 */

import { describe, it, expect } from 'vitest'

import { REOPEN_CAP, decideAction } from './walkerPolicy'
import type { Candidate, WalkerContext, SpineLabel } from './walkerTypes'

/** A small, fixed set of discovered elements to decide against. */
function candidates(): Candidate[] {
  const mk = (i: number, testid: string | null, kind: Candidate['kind']): Candidate => ({
    key: `wt:${i}`,
    testid,
    role: kind === 'button' ? 'button' : null,
    tag: kind === 'input' ? 'input' : kind === 'canvas' ? 'canvas' : 'button',
    text: testid ?? `el-${i}`,
    enabled: true,
    kind,
    box: { x: 10 + i * 20, y: 40 + i * 15, w: 30, h: 18 },
  })
  return [
    mk(0, 'litho-suggest', 'button'),
    mk(1, 'section-create', 'button'),
    mk(2, null, 'button'),
    mk(3, 'data-inspector-search', 'input'),
    mk(4, 'sections-canvas', 'canvas'),
    mk(5, null, 'checkbox'),
    mk(6, null, 'generic'),
  ]
}

/** A context template for a given step; only stepIndex varies across the walk. */
function ctxAt(step: number): WalkerContext {
  const visited: SpineLabel[] = ['Data', 'Sections']
  return {
    stepIndex: step,
    currentStage: 'Sections',
    visitedStages: visited,
    stepsSinceStageSwitch: step % 7,
    candidates: candidates(),
    openMenu: step % 5 === 0,
    reopenCount: 0,
  }
}

/** Play a bounded sequence and serialise it for comparison. */
function sequence(seed: number, steps: number): string {
  const plans = []
  for (let s = 0; s < steps; s++) plans.push(decideAction(ctxAt(s), seed))
  return JSON.stringify(plans)
}

describe('walker policy -- reproducibility', () => {
  it('the same seed replays the same action sequence', () => {
    // The core replay contract: a printed seed reproduces a finding.
    expect(sequence(12345, 60)).toEqual(sequence(12345, 60))
  })

  it('a different seed generally produces a different action sequence', () => {
    // Guards against a degenerate policy that ignores the seed (a constant
    // policy would replay identically AND look reproducible -- this pin is what
    // makes the reproducibility test meaningful).
    expect(sequence(12345, 60)).not.toEqual(sequence(98765, 60))
  })
})

describe('walker policy -- behaviour guards', () => {
  it('every action that names a target names a discovered candidate', () => {
    const keys = new Set(candidates().map(c => c.key))
    for (let s = 0; s < 400; s++) {
      const plan = decideAction(ctxAt(s), 24680)
      if (plan.targetKey !== undefined) expect(keys.has(plan.targetKey)).toBe(true)
      if (plan.secondaryKey !== undefined) expect(keys.has(plan.secondaryKey)).toBe(true)
    }
  })

  it('never proposes reopening the project once the cap is reached', () => {
    for (let s = 0; s < 400; s++) {
      const plan = decideAction({ ...ctxAt(s), reopenCount: REOPEN_CAP }, 555)
      expect(plan.kind).not.toBe('reopenProject')
    }
  })

  it('picks elements with no testid, not only tutorial verbs', () => {
    // Candidate wt:2 and wt:6 have testid null; over many steps at least one
    // untestid'd element must be chosen (DOM discovery, not a testid allowlist).
    const untestid = new Set(candidates().filter(c => c.testid === null).map(c => c.key))
    let hit = false
    for (let s = 0; s < 400 && !hit; s++) {
      const plan = decideAction(ctxAt(s), 13579)
      if (plan.targetKey !== undefined && untestid.has(plan.targetKey)) hit = true
    }
    expect(hit).toBe(true)
  })

  it('produces a variety of action kinds over a walk (not degenerate)', () => {
    const kinds = new Set<string>()
    for (let s = 0; s < 300; s++) kinds.add(decideAction(ctxAt(s), 42).kind)
    expect(kinds.size).toBeGreaterThanOrEqual(4)
  })

  it('eventually switches away from a stage sat on for many steps', () => {
    // With a high stepsSinceStageSwitch the switch bias saturates; a switch must
    // appear across a short window rather than never.
    let switched = false
    for (let s = 0; s < 40 && !switched; s++) {
      const plan = decideAction({ ...ctxAt(s), stepsSinceStageSwitch: 15 }, 909)
      if (plan.kind === 'switchStage') switched = true
    }
    expect(switched).toBe(true)
  })
})
