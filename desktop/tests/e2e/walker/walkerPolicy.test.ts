/**
 * Pins for the walker's action policy.
 *
 * Explicit vitest imports (not globals) so this file typechecks under
 * ``tsconfig.e2e`` (whose ``types`` array does not include vitest) while still
 * running under Vitest. Playwright never runs it -- the config's testMatch is
 * ``**\/*.spec.ts``.
 */

import { describe, it, expect } from 'vitest'

import {
  IMPORT_ROUTES,
  MIN_STEPS_BETWEEN_PROJECT_SWITCHES,
  REOPEN_CAP,
  SWITCH_PROJECT_CAP,
  WORKFLOW_ACTION_WEIGHTS,
  decideAction,
} from './walkerPolicy'
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
    projectSwitchCount: 0,
    stepsSinceProjectSwitch: 500,
    canSwitchProject: true,
    importRoutesDone: [],
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

// Owner 2026-10-13: "Walk again, add more steps. I test it once and find a
// bug, walker is thus not doing its job." The bug: opening a SECOND project
// left the first project's models active. The walker never opened another
// project, so it could not find it. The new verbs below are what a real
// engineer does between projects and must be drawn by the policy.
describe('walker policy -- the project-level verbs are drawn', () => {
  /** Kinds drawn over a long walk with every new verb eligible. */
  function kindsOver(steps: number, seed: number): Map<string, number> {
    const counts = new Map<string, number>()
    for (let s = 0; s < steps; s++) {
      const k = decideAction(ctxAt(s), seed).kind
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return counts
  }

  it('switchProject, undoRedoBurst, saveProject, openSettings and openImportDialog all appear in a 900-step walk', () => {
    const counts = kindsOver(900, 2026_10_13)
    for (const k of ['switchProject', 'undoRedoBurst', 'saveProject', 'openSettings', 'openImportDialog']) {
      expect(counts.get(k) ?? 0, k).toBeGreaterThan(0)
    }
  })

  it('the weights are the ruled ones', () => {
    expect(WORKFLOW_ACTION_WEIGHTS).toEqual({
      switchProject: 3,
      undoRedoBurst: 4,
      saveProject: 3,
      openSettings: 2,
      openImportDialog: 3,
    })
  })

  it('draws them in proportion to their weights (undo/redo burst more often than settings)', () => {
    const counts = kindsOver(4000, 77)
    expect(counts.get('undoRedoBurst') ?? 0).toBeGreaterThan(counts.get('openSettings') ?? 0)
  })
})

describe('walker policy -- switchProject: close this project and open ANOTHER one', () => {
  it('never more than the cap per walk', () => {
    expect(SWITCH_PROJECT_CAP).toBe(4)
    for (let s = 0; s < 600; s++) {
      const plan = decideAction({ ...ctxAt(s), projectSwitchCount: SWITCH_PROJECT_CAP }, 31)
      expect(plan.kind).not.toBe('switchProject')
    }
  })

  it('never when there is no second project to open', () => {
    for (let s = 0; s < 600; s++) {
      const plan = decideAction({ ...ctxAt(s), canSwitchProject: false }, 32)
      expect(plan.kind).not.toBe('switchProject')
    }
  })

  it('never straight after the previous switch: the walk first spends time in the new project', () => {
    for (let s = 0; s < 600; s++) {
      const plan = decideAction(
        { ...ctxAt(s), stepsSinceProjectSwitch: MIN_STEPS_BETWEEN_PROJECT_SWITCHES - 1 },
        33,
      )
      expect(plan.kind).not.toBe('switchProject')
    }
  })

  it('says how to answer an unsaved-changes prompt: discard or save', () => {
    const choices = new Set<string>()
    for (let s = 0; s < 3000; s++) {
      const plan = decideAction(ctxAt(s), 34)
      if (plan.kind === 'switchProject') choices.add(String(plan.closeChoice))
    }
    expect([...choices].sort()).toEqual(['discard', 'save'])
  })
})

describe('walker policy -- undoRedoBurst: Ctrl+Z x n then Ctrl+Y x n', () => {
  it('n is between 1 and 5', () => {
    const seen = new Set<number>()
    for (let s = 0; s < 3000; s++) {
      const plan = decideAction(ctxAt(s), 35)
      if (plan.kind !== 'undoRedoBurst') continue
      expect(plan.repeat).toBeGreaterThanOrEqual(1)
      expect(plan.repeat).toBeLessThanOrEqual(5)
      seen.add(plan.repeat ?? -1)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('walker policy -- openImportDialog: each import route once per walk', () => {
  it('covers CPT .gef / DOV / pdf, borehole XML / DOV / pdf and lab', () => {
    expect(IMPORT_ROUTES.map(r => r.id)).toEqual([
      'cpt-gef',
      'cpt-dov',
      'cpt-pdf',
      'borehole-xml',
      'borehole-dov',
      'borehole-pdf',
      'lab',
    ])
    for (const r of IMPORT_ROUTES) expect(r.chain[0]).toBe('import-menu-button')
  })

  it('never picks a route already opened this walk', () => {
    const done = ['cpt-gef', 'cpt-dov', 'cpt-pdf', 'borehole-xml', 'borehole-dov', 'borehole-pdf']
    for (let s = 0; s < 1500; s++) {
      const plan = decideAction({ ...ctxAt(s), importRoutesDone: done }, 36)
      if (plan.kind === 'openImportDialog') expect(plan.importRoute).toBe('lab')
    }
  })

  it('stops once every route has been opened', () => {
    const all = IMPORT_ROUTES.map(r => r.id)
    for (let s = 0; s < 1500; s++) {
      const plan = decideAction({ ...ctxAt(s), importRoutesDone: all }, 37)
      expect(plan.kind).not.toBe('openImportDialog')
    }
  })
})
