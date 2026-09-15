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
    expect(plan).toEqual({ kind: 'split', splits: [{ depthM: 3 }], recomposes: [] })
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
    })
  })

  it('a selection that includes a boundary below the target depth is refused', () => {
    // The deepest selected boundary (6) sits below the target's 5 m column → the
    // whole drop is refused with the existing below-terminal toast.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthsM: [3, 6],
      sourceLayers: SOURCE_THREE,
      targetLayers: [{ id: 'tgt-only', depth_top_m: 0, depth_base_m: 5 }],
      targetTerminalDepthM: 5,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'below_terminal' })
  })
})
