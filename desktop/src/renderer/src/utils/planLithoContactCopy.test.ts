/**
 * Red-first pins for the litho-contact copy planner.
 *
 * Installer #35 (verbatim: *"can't i drag and drop an accepted litho contact onto
 * a new cptm for example. just like the litho boundaries?"* / *"b, both units."*)
 * shipped the single-boundary drop. Installer #40 (verbatim: *"the shift drag is
 * not ok, it does split the column where i drag but for example when i select two
 * boundaries, it should put both on the column i drag onto and also the litho body
 * in between"*) extended it to a MULTI-boundary selection.
 *
 * The planner is the pure decision the Shift-drag makes when accepted litho
 * boundaries at depths z1 < … < zk on a source column are dropped on a target
 * column: create the full copied stack on an empty target, or split at each
 * boundary + recompose the units between on a target that already has layers, or
 * refuse a drop below the target's terminal depth. It carries no React and no I/O.
 */

import { describe, expect, it } from 'vitest'

import { planLithoContactCopy } from './planLithoContactCopy'

// A source column with a clay U1 (1..3 m) above a sand U2 (3..7 m); the contact
// between them sits at 3 m below the source collar.
const SOURCE_U1 = { formation_id: 'f-clay', depth_top_m: 1, depth_base_m: 3 }
const SOURCE_U2 = { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 7 }
const SOURCE_LAYERS = [SOURCE_U1, SOURCE_U2]

// A three-unit source for the multi-boundary cases: clay 0..3 / sand 3..6 / silt
// 6..10. The boundaries at 3 and 6 bracket the sand "body in between".
const SOURCE_THREE = [
  { formation_id: 'f-clay', depth_top_m: 0, depth_base_m: 3 },
  { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 6 },
  { formation_id: 'f-silt', depth_top_m: 6, depth_base_m: 10 },
]

describe('planLithoContactCopy — single boundary', () => {
  it('drag an accepted litho contact onto a new CPT: both units land there', () => {
    // Target CPT has NO accepted litho layers → BOTH units are created: U1 from
    // the target collar (0 m) down to z, U2 from z down to the target terminal.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3],
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [],
      targetTerminalDepthM: 10,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') throw new Error('unreachable')
    expect(plan.items).toEqual([
      { formation_id: 'f-clay', depth_top_m: 0, depth_base_m: 3 },
      { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 10 },
    ])
    expect(plan.depthsM).toEqual([3])
  })

  it('onto a CPT that already has layers: the layer splits, no recompose', () => {
    // z=3 falls inside the top target layer → one split, and (single boundary) no
    // between-unit to recompose, so compositions are kept.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3],
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [
        { id: 'tgt-top', depth_top_m: 0, depth_base_m: 5 },
        { id: 'tgt-bottom', depth_top_m: 5, depth_base_m: 12 },
      ],
      targetTerminalDepthM: 12,
    })
    expect(plan).toEqual({
      kind: 'split',
      splits: [{ depthM: 3 }],
      recomposes: [],
      droppedBelowTerminalCount: 0,
    })
  })

  it('dropped below the terminal depth: refused (empty target)', () => {
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [8],
      sourceLayers: [
        { formation_id: 'f-clay', depth_top_m: 5, depth_base_m: 8 },
        { formation_id: 'f-sand', depth_top_m: 8, depth_base_m: 12 },
      ],
      targetLayers: [],
      targetTerminalDepthM: 6,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'below_terminal' })
  })

  it('dropped below the terminal depth: refused (target that already has layers)', () => {
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [8],
      sourceLayers: [
        { formation_id: 'f-clay', depth_top_m: 5, depth_base_m: 8 },
        { formation_id: 'f-sand', depth_top_m: 8, depth_base_m: 12 },
      ],
      targetLayers: [{ id: 'tgt-only', depth_top_m: 0, depth_base_m: 5 }],
      targetTerminalDepthM: 5,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'below_terminal' })
  })

  it('drop on the source column itself is a no-op', () => {
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-a',
      contactDepthsM: [3],
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [],
      targetTerminalDepthM: 10,
    })
    expect(plan).toEqual({ kind: 'noop', reason: 'same_column' })
  })

  it('drop where the target already has that exact boundary is a no-op', () => {
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3],
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [
        { id: 'tgt-top', depth_top_m: 0, depth_base_m: 3 },
        { id: 'tgt-bottom', depth_top_m: 3, depth_base_m: 12 },
      ],
      targetTerminalDepthM: 12,
    })
    expect(plan).toEqual({ kind: 'noop', reason: 'boundary_exists' })
  })

  it('refuses when the dragged contact is not between two accepted units', () => {
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [0],
      sourceLayers: [{ formation_id: 'f-sand', depth_top_m: 0, depth_base_m: 7 }],
      targetLayers: [],
      targetTerminalDepthM: 10,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'no_source_boundary' })
  })

  it('refuses an empty target whose terminal depth is unknown', () => {
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3],
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [],
      targetTerminalDepthM: null,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'unknown_terminal' })
  })
})

describe('planLithoContactCopy — multiple boundaries (installer #40)', () => {
  it('two selected boundaries land on the target with the litho body in between', () => {
    // Empty target: boundaries at 3 and 6 both land, and the sand unit BETWEEN
    // them (3..6, its source composition) lands as its own unit — the "litho body
    // in between". The clay above lands from the collar, the silt below to the
    // terminal.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3, 6],
      sourceLayers: SOURCE_THREE,
      targetLayers: [],
      targetTerminalDepthM: 12,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') throw new Error('unreachable')
    expect(plan.items).toEqual([
      { formation_id: 'f-clay', depth_top_m: 0, depth_base_m: 3 },
      { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 6 },
      { formation_id: 'f-silt', depth_top_m: 6, depth_base_m: 12 },
    ])
    expect(plan.depthsM).toEqual([3, 6])
  })

  it('unsorted selection order does not matter — the boundaries sort by depth', () => {
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [6, 3],
      sourceLayers: SOURCE_THREE,
      targetLayers: [],
      targetTerminalDepthM: 12,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') throw new Error('unreachable')
    expect(plan.items.map((i) => i.formation_id)).toEqual(['f-clay', 'f-sand', 'f-silt'])
  })

  it('on a target with layers the units between the copied boundaries take the source composition', () => {
    // Target already has one deep layer [0, 12]. Both boundaries split it, and the
    // between-unit [3, 6] is recomposed to the SOURCE sand (f-sand) — its litho body.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3, 6],
      sourceLayers: SOURCE_THREE,
      targetLayers: [{ id: 'tgt-only', depth_top_m: 0, depth_base_m: 12 }],
      targetTerminalDepthM: 12,
    })
    expect(plan).toEqual({
      kind: 'split',
      splits: [{ depthM: 3 }, { depthM: 6 }],
      recomposes: [{ formation_id: 'f-sand', depthTopM: 3, depthBaseM: 6 }],
      droppedBelowTerminalCount: 0,
    })
  })

  it('on a target with layers, a boundary below the target depth is dropped and the rest split (owner 2026-09-16)', () => {
    // The target column is only 5 m deep. The 6 m boundary sits below it and is
    // DROPPED; the 3 m boundary still splits the layer. No refusal for the fitting
    // part — the owner: "it should just work".
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3, 6],
      sourceLayers: SOURCE_THREE,
      targetLayers: [{ id: 'tgt-only', depth_top_m: 0, depth_base_m: 5 }],
      targetTerminalDepthM: 5,
    })
    expect(plan).toEqual({
      kind: 'split',
      splits: [{ depthM: 3 }],
      recomposes: [],
      droppedBelowTerminalCount: 1,
    })
  })
})

// Owner dogfeed 2026-09-16 (installer #41), verbatim: "when trying to drag litho
// contacts onto a cptm i get a toast that it couldn't be done" and "how do i copy
// the lowest litho on a column? I only have one contact to drag?". His CPTMs are
// SHALLOW (3.3 to 13.8 m) and his source CPTs are 15 m deep, so a boundary below
// the target's own depth used to refuse the WHOLE copy. Decision (session main):
// CLIP instead of refuse — the boundaries that fit land, the lowest fitting unit is
// cut at the target's depth, and only a copy where NO boundary fits is refused.
describe('planLithoContactCopy — clip onto a shallow test instead of refusing (owner 2026-09-16)', () => {
  // A four-unit source 15 m deep: clay 0..3 / sand 3..6 / silt 6..10 / peat 10..15.
  const SOURCE_FOUR = [
    { formation_id: 'f-clay', depth_top_m: 0, depth_base_m: 3 },
    { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 6 },
    { formation_id: 'f-silt', depth_top_m: 6, depth_base_m: 10 },
    { formation_id: 'f-peat', depth_top_m: 10, depth_base_m: 15 },
  ]

  it('a boundary below a shallow CPTM’s depth is dropped and the units above still land, cut at its depth', () => {
    // Empty CPTM only 8 m deep. Boundaries at 3, 6, 10 — the 10 m boundary is below
    // the CPTM and drops; the units above land, and the lowest fitting unit (silt)
    // runs from 6 down to the CPTM's own 8 m depth.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cptm-b',
      contactDepthsM: [3, 6, 10],
      sourceLayers: SOURCE_FOUR,
      targetLayers: [],
      targetTerminalDepthM: 8,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') throw new Error('unreachable')
    expect(plan.items).toEqual([
      { formation_id: 'f-clay', depth_top_m: 0, depth_base_m: 3 },
      { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 6 },
      { formation_id: 'f-silt', depth_top_m: 6, depth_base_m: 8 },
    ])
    expect(plan.depthsM).toEqual([3, 6])
    expect(plan.droppedBelowTerminalCount).toBe(1)
  })

  it('dragging a column’s only contact onto a test deeper than it copies both units', () => {
    // The source's only contact (3 m) is the top of its lowest unit. Dropped on a
    // DEEPER empty test, both units land and the lowest runs to the target terminal.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3],
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [],
      targetTerminalDepthM: 12,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') throw new Error('unreachable')
    expect(plan.items).toEqual([
      { formation_id: 'f-clay', depth_top_m: 0, depth_base_m: 3 },
      { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 12 },
    ])
    expect(plan.droppedBelowTerminalCount).toBe(0)
  })

  it('when every boundary is below the test’s depth nothing is copied', () => {
    // Every selected boundary (10, 12) sits below the 6 m target → the whole drop
    // is refused (the existing below-terminal toast handles the message).
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cptm-b',
      contactDepthsM: [10, 12],
      sourceLayers: [
        { formation_id: 'f-silt', depth_top_m: 8, depth_base_m: 10 },
        { formation_id: 'f-sand', depth_top_m: 10, depth_base_m: 13 },
        { formation_id: 'f-peat', depth_top_m: 12, depth_base_m: 15 },
      ],
      targetLayers: [],
      targetTerminalDepthM: 6,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'below_terminal' })
  })
})
