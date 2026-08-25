// What the "N pending here" chip has to be able to SAY when it is pressed.
//
// Owner dogfeed 2026-08-25:
//
//   > "now i get a one pending notification but i don't see any pending ties?
//   > Why don't we make that clickable so it highlights the tie?"
//
// The count was honest and the canvas was empty: the count is per SECTION, the
// canvas draws per RENDERED COLUMN, and a tie whose endpoint column is not being
// drawn renders nothing at all. So the press has to answer the count either way —
// centre and highlight the tie when it can be drawn, and NAME both ends and the
// reason when it cannot.
//
//   PTR1  only ties still waiting are on the list — an accepted one is not
//   PTR2  another section's ties are not on this section's list
//   PTR3  the order is stable, so a second press visits a different tie
//   PTR4  a tie whose band cannot be found is dropped — it cannot be explained
//   PTR5  each end carries the investigation it stands on and its band depths
//   PTR6  the first gate that fires is the one reported
//   PTR7  every reason reads as a sentence the engineer can act on
//   PTR8  the callout names BOTH ends, their depths, and what is missing
//   PTR9  when both ends are missing, both are named
//   PTR10 the callout never claims a reason it was not given

import { describe, expect, it } from 'vitest'

import type { LithoContactCorrelationEdge } from '../api/clients/geology.types'
import { makeLithoLayer } from '../shell/stages/sections/__fixtures__/lithoLayer'
import {
  columnAbsenceClause,
  columnAbsenceCode,
  describeUndrawableTie,
  sectionPendingTies,
} from './pendingTieReveal'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function edge(
  id: string,
  aId: string,
  bId: string,
  over: Partial<LithoContactCorrelationEdge> = {},
): LithoContactCorrelationEdge {
  return {
    id,
    layer_a_id: aId,
    layer_b_id: bId,
    layer_a_side: 'top',
    layer_b_side: 'top',
    model_id: 'geotech-model-1',
    section_id: 'sec-1',
    source: 'auto',
    user_approved: false,
    created_at: '2026-08-20T10:00:00Z',
    ...over,
  }
}

/** A packing band on a CPT, at the depths the callout has to print. */
const bandS4 = makeLithoLayer({
  id: 'band-s4',
  cpt_id: 'cpt-s4',
  borehole_id: null,
  depth_top_m: 18.29,
  depth_base_m: 18.52,
})

/** The band on the borehole the section is not drawing. */
const bandB6 = makeLithoLayer({
  id: 'band-b6',
  cpt_id: null,
  borehole_id: 'bh-b6',
  depth_top_m: 13.9,
  depth_base_m: 18.05,
})

const LAYERS = [bandS4, bandB6]

// ---------------------------------------------------------------------------
// PTR1-PTR5 — which ties the press walks
// ---------------------------------------------------------------------------

describe('sectionPendingTies — the ties the chip is counting', () => {
  it('PTR1: an accepted tie is not one of the pending ones', () => {
    const ties = sectionPendingTies(
      [
        edge('e-pending', 'band-s4', 'band-b6'),
        edge('e-accepted', 'band-s4', 'band-b6', { id: 'e-accepted', user_approved: true }),
      ],
      LAYERS,
      'sec-1',
    )
    expect(ties.map(t => t.edgeId)).toEqual(['e-pending'])
  })

  it('PTR2: a tie belonging to another section is not on this list', () => {
    const ties = sectionPendingTies(
      [
        edge('e-here', 'band-s4', 'band-b6'),
        edge('e-elsewhere', 'band-s4', 'band-b6', { section_id: 'sec-2' }),
      ],
      LAYERS,
      'sec-1',
    )
    expect(ties.map(t => t.edgeId)).toEqual(['e-here'])
  })

  it('PTR3: the order is the same however the server sent them', () => {
    // A second press must land on a DIFFERENT tie than the first. If the order
    // followed the response array, a refetch between two presses could re-show
    // the tie just visited and hide the one that was next.
    const older = edge('e-older', 'band-s4', 'band-b6', { created_at: '2026-08-01T00:00:00Z' })
    const newer = edge('e-newer', 'band-s4', 'band-b6', { created_at: '2026-08-09T00:00:00Z' })
    expect(sectionPendingTies([newer, older], LAYERS, 'sec-1').map(t => t.edgeId)).toEqual([
      'e-older',
      'e-newer',
    ])
    expect(sectionPendingTies([older, newer], LAYERS, 'sec-1').map(t => t.edgeId)).toEqual([
      'e-older',
      'e-newer',
    ])
  })

  it('PTR4: a tie whose band is unknown is dropped, not half-described', () => {
    const ties = sectionPendingTies([edge('e-orphan', 'band-s4', 'band-gone')], LAYERS, 'sec-1')
    expect(ties).toEqual([])
  })

  it('PTR5: each end names its investigation and the depths of its band', () => {
    const [tie] = sectionPendingTies([edge('e', 'band-s4', 'band-b6')], LAYERS, 'sec-1')
    expect(tie.a).toEqual({
      layerId: 'band-s4',
      investigationId: 'cpt-s4',
      kind: 'cpt',
      depthTopM: 18.29,
      depthBaseM: 18.52,
    })
    expect(tie.b).toEqual({
      layerId: 'band-b6',
      investigationId: 'bh-b6',
      kind: 'borehole',
      depthTopM: 13.9,
      depthBaseM: 18.05,
    })
  })

  it('PTR5b: with no section open there is nothing to walk', () => {
    expect(sectionPendingTies([edge('e', 'band-s4', 'band-b6')], LAYERS, null)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// PTR6-PTR7 — why a column is not on screen
// ---------------------------------------------------------------------------

describe('columnAbsenceCode — which gate dropped the column', () => {
  const drawn = {
    knownToProject: true,
    hiddenFromProject: false,
    visibleInProject: true,
    excludedFromModel: false,
    excludedFromSection: false,
    projectsOntoSection: true,
    columnFocusOn: false,
  }

  it('PTR6: the FIRST gate that fires is the one reported', () => {
    // A test the project has already dropped is also, trivially, "not
    // projected" — every later check reads off a list it was removed from
    // upstream. Reporting the last one would send the engineer to widen a
    // corridor that is fine.
    const gone = { projectsOntoSection: false, visibleInProject: false }
    expect(columnAbsenceCode({ ...drawn, ...gone, knownToProject: false })).toBe(
      'unknown-investigation',
    )
    expect(columnAbsenceCode({ ...drawn, ...gone, hiddenFromProject: true })).toBe(
      'hidden-from-project',
    )
    expect(columnAbsenceCode({ ...drawn, ...gone })).toBe('not-in-project-file')
    expect(
      columnAbsenceCode({ ...drawn, projectsOntoSection: false, excludedFromModel: true }),
    ).toBe('excluded-from-model')
    expect(
      columnAbsenceCode({ ...drawn, projectsOntoSection: false, excludedFromSection: true }),
    ).toBe('excluded-from-section')
    expect(columnAbsenceCode({ ...drawn, projectsOntoSection: false })).toBe('outside-corridor')
    expect(columnAbsenceCode({ ...drawn, columnFocusOn: true })).toBe('column-focus')
  })

  it('PTR6b: every gate open and the column still absent is reported as unknown', () => {
    // Never invent a reason. An unexplained absence says so, which is a bug
    // report the engineer can forward, not a wrong instruction.
    expect(columnAbsenceCode(drawn)).toBe('unknown')
  })

  it('PTR7: every reason reads as a sentence, never as a bare code', () => {
    const codes = [
      'unknown-investigation',
      'not-in-project-file',
      'hidden-from-project',
      'excluded-from-model',
      'excluded-from-section',
      'outside-corridor',
      'column-focus',
      'unknown',
    ] as const
    for (const code of codes) {
      const clause = columnAbsenceClause(code)
      expect(clause.split(' ').length).toBeGreaterThan(3)
      expect(clause).not.toContain(code)
    }
  })
})

// ---------------------------------------------------------------------------
// PTR8-PTR10 — the sentence the press shows
// ---------------------------------------------------------------------------

describe('describeUndrawableTie — the answer the count owes the engineer', () => {
  const tie = sectionPendingTies([edge('e', 'band-s4', 'band-b6')], LAYERS, 'sec-1')[0]

  it('PTR8: it names both ends with their depths, and what is missing', () => {
    const msg = describeUndrawableTie({
      tie,
      labels: { 'cpt-s4': 'GEO-10/170-S4', 'bh-b6': '1411-GEO-23/126-B6' },
      absences: [{ investigationId: 'bh-b6', code: 'hidden-from-project' }],
    })
    expect(msg).toContain('GEO-10/170-S4')
    expect(msg).toContain('18.29')
    expect(msg).toContain('18.52')
    expect(msg).toContain('1411-GEO-23/126-B6')
    expect(msg).toContain('13.90')
    expect(msg).toContain('18.05')
    // The missing end is named again beside its reason — the pair alone does
    // not say WHICH of the two is the problem.
    expect(msg).toContain(columnAbsenceClause('hidden-from-project'))
    expect(msg.indexOf('1411-GEO-23/126-B6', msg.indexOf('↔'))).toBeGreaterThan(-1)
  })

  it('PTR9: when neither end is drawn, both are named', () => {
    const msg = describeUndrawableTie({
      tie,
      labels: { 'cpt-s4': 'GEO-10/170-S4', 'bh-b6': '1411-GEO-23/126-B6' },
      absences: [
        { investigationId: 'cpt-s4', code: 'outside-corridor' },
        { investigationId: 'bh-b6', code: 'excluded-from-model' },
      ],
    })
    expect(msg).toContain(columnAbsenceClause('outside-corridor'))
    expect(msg).toContain(columnAbsenceClause('excluded-from-model'))
  })

  it('PTR10: an unnamed investigation falls back to its id, never to blank', () => {
    const msg = describeUndrawableTie({
      tie,
      labels: {},
      absences: [{ investigationId: 'bh-b6', code: 'unknown' }],
    })
    expect(msg).toContain('bh-b6')
    expect(msg).toContain('cpt-s4')
  })
})
