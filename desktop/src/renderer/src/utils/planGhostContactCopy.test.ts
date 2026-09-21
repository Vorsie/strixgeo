/**
 * Red-first pins for the GHOST-contact copy planner (installer #42 owner ask,
 * verbatim: *"copying litho's on cptm is still clunky (can we drag copy ghosts
 * also?)"*).
 *
 * The accepted-litho copy (planLithoContactCopy) works only on ACCEPTED
 * boundaries and lands ACCEPTED layers. This planner is the sibling decision for
 * PENDING suggestions: Shift-drag a ghost boundary from one test onto another so
 * the target gets a GHOST column (suggestions, not accepted layers) carrying the
 * same units. It clips exactly like the accepted copy (a suggestion below the
 * target's depth is dropped, the count rides the plan for the toast), refuses a
 * source column that mixes accepted and pending boundaries, and refuses a target
 * that already carries a ghost column. Pure — no React, no I/O.
 */

import { describe, expect, it } from 'vitest'

import { planGhostContactCopy, type GhostCopySourceSuggestion } from './planGhostContactCopy'

/** One pending source suggestion (a ghost the segmenter produced, not accepted). */
function pending(
  depthTopM: number,
  depthBaseM: number,
  lithology: string,
): GhostCopySourceSuggestion {
  return { depthTopM, depthBaseM, lithology, admixtures: [], accepted: false, rejected: false }
}

// A two-unit ghost column: clay 0..3 over sand 3..7. The boundary sits at 3 m.
const GHOST_TWO: GhostCopySourceSuggestion[] = [
  pending(0, 3, 'KLEI'),
  pending(3, 7, 'ZAND'),
]

// A three-unit ghost column: clay 0..3 / sand 3..6 / silt 6..10.
const GHOST_THREE: GhostCopySourceSuggestion[] = [
  pending(0, 3, 'KLEI'),
  pending(3, 6, 'ZAND'),
  pending(6, 10, 'SILT'),
]

describe('planGhostContactCopy', () => {
  it('shift-dragging a ghost boundary onto another test gives that test a ghost column with the same units', () => {
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: GHOST_TWO,
      targetSuggestions: [],
      targetTerminalDepthM: 10,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    // The same units, at the same depth below the collar (verbatim — a ghost
    // column is not gap-free and is not extended to the target terminal).
    expect(
      plan.suggestions.map(s => [s.lithology, s.depthTopM, s.depthBaseM]),
    ).toEqual([
      ['KLEI', 0, 3],
      ['ZAND', 3, 7],
    ])
    expect(plan.droppedBelowTerminalCount).toBe(0)
  })

  it('a ghost boundary below the target’s depth is dropped like an accepted one', () => {
    // Target is only 5 m deep. The silt top at 6 m is below it → the silt unit is
    // dropped, the sand base is clamped to 5 m, and the clay is kept.
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: GHOST_THREE,
      targetSuggestions: [],
      targetTerminalDepthM: 5,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(
      plan.suggestions.map(s => [s.lithology, s.depthTopM, s.depthBaseM]),
    ).toEqual([
      ['KLEI', 0, 3],
      ['ZAND', 3, 5],
    ])
    expect(plan.droppedBelowTerminalCount).toBe(1)
  })

  it('an accepted and a ghost boundary in one drag are refused', () => {
    // The source column carries one ACCEPTED unit and one PENDING unit — the drag
    // cannot be both an accepted copy and a ghost copy, so it is refused.
    const mixed: GhostCopySourceSuggestion[] = [
      { depthTopM: 0, depthBaseM: 3, lithology: 'KLEI', admixtures: [], accepted: true, rejected: false },
      pending(3, 7, 'ZAND'),
    ]
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: mixed,
      targetSuggestions: [],
      targetTerminalDepthM: 10,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'mixed_accepted_ghost' })
  })

  it('a target that already holds a pending suggestion is refused', () => {
    // The planner now derives "the target is occupied" itself, from the target's
    // own suggestions: a pending one (neither accepted nor rejected) means the
    // drop would overwrite the user's live suggestions, so it is refused.
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: GHOST_TWO,
      targetSuggestions: [{ accepted: false, rejected: false }],
      targetTerminalDepthM: 10,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'target_has_ghost' })
  })

  it('a target the segmenter ran on but left with no pending suggestion is a free target', () => {
    // The segmenter leaves a RECORD on every column it ran on, also when it
    // suggested nothing. A record with zero suggestions, or one whose
    // suggestions are all accepted or all rejected, is NOT occupied and is a
    // free target (owner, installer #44: "this test already has suggestions when
    // it clearly does not"). This occupied-check now lives in the planner.
    const freeTargets: { accepted: boolean; rejected: boolean }[][] = [
      [],
      [
        { accepted: true, rejected: false },
        { accepted: true, rejected: false },
      ],
      [
        { accepted: false, rejected: true },
        { accepted: false, rejected: true },
      ],
    ]
    for (const targetSuggestions of freeTargets) {
      const plan = planGhostContactCopy({
        sourceInvestigationId: 'cpt-a',
        targetInvestigationId: 'cpt-b',
        sourceSuggestions: GHOST_TWO,
        targetSuggestions,
        targetTerminalDepthM: 10,
      })
      expect(plan.kind).toBe('create')
    }
  })

  it('a drop on the source column is a no-op', () => {
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-a',
      sourceSuggestions: GHOST_TWO,
      targetSuggestions: [],
      targetTerminalDepthM: 10,
    })
    expect(plan).toEqual({ kind: 'noop', reason: 'same_column' })
  })

  it('a source column with no pending suggestions (all accepted) is refused', () => {
    const allAccepted: GhostCopySourceSuggestion[] = [
      { depthTopM: 0, depthBaseM: 3, lithology: 'KLEI', admixtures: [], accepted: true, rejected: false },
      { depthTopM: 3, depthBaseM: 7, lithology: 'ZAND', admixtures: [], accepted: true, rejected: false },
    ]
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: allAccepted,
      targetSuggestions: [],
      targetTerminalDepthM: 10,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'no_pending_ghost' })
  })

  it('a drop where every unit sits below the target’s depth is refused', () => {
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: GHOST_TWO,
      targetSuggestions: [],
      targetTerminalDepthM: 0,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'below_terminal' })
  })

  it('rejected source suggestions are left out of the copy and the mix check', () => {
    // A rejected accepted-unit does not make the drag "mixed" — it is excluded
    // entirely. Only the two pending units are copied.
    const withRejected: GhostCopySourceSuggestion[] = [
      { depthTopM: 0, depthBaseM: 1, lithology: 'VEEN', admixtures: [], accepted: true, rejected: true },
      pending(0, 3, 'KLEI'),
      pending(3, 7, 'ZAND'),
    ]
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: withRejected,
      targetSuggestions: [],
      targetTerminalDepthM: 10,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.suggestions.map(s => s.lithology)).toEqual(['KLEI', 'ZAND'])
  })

  it('an unknown target depth copies the units verbatim (no clip)', () => {
    const plan = planGhostContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      sourceSuggestions: GHOST_TWO,
      targetSuggestions: [],
      targetTerminalDepthM: null,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.suggestions.map(s => [s.depthTopM, s.depthBaseM])).toEqual([
      [0, 3],
      [3, 7],
    ])
    expect(plan.droppedBelowTerminalCount).toBe(0)
  })
})
