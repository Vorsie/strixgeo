/**
 * Red-first pins for the litho-contact copy planner (installer #35 owner ask,
 * verbatim: *"can't i drag and drop an accepted litho contact onto a new cptm
 * for example. just like the litho boundaries?"* and, on what the drop should
 * create, *"b, both units."*).
 *
 * The planner is the pure decision the Shift-drag makes when an accepted litho
 * boundary at depth z on a source column is dropped on a target column: create
 * BOTH units on an empty target, or SPLIT the spanning layer on a target that
 * already has layers, or refuse a drop below the target's terminal depth. It
 * carries no React and no I/O so the owner's rules are pinned as plain data.
 */

import { describe, expect, it } from 'vitest'

import { planLithoContactCopy } from './planLithoContactCopy'

// A source column with a clay U1 (1..3 m) above a sand U2 (3..7 m); the contact
// between them sits at 3 m below the source collar.
const SOURCE_U1 = { formation_id: 'f-clay', depth_top_m: 1, depth_base_m: 3 }
const SOURCE_U2 = { formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 7 }
const SOURCE_LAYERS = [SOURCE_U1, SOURCE_U2]

describe('planLithoContactCopy', () => {
  it('drag an accepted litho contact onto a new CPT: both units land there', () => {
    // Target CPT has NO accepted litho layers → BOTH units are created: U1 from
    // the target collar (0 m) down to z, U2 from z down to the target terminal,
    // each keeping its source composition (the same litho unit = same
    // formation_id, never a duplicate).
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthM: 3,
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
    expect(plan.depthM).toBe(3)
  })

  it('onto a CPT that already has layers: the layer splits, compositions kept', () => {
    // Target already carries accepted layers covering [0, 12]; z=3 falls inside
    // the top one → the planner SPLITS that layer at z. The split keeps both
    // halves' composition (the plan carries no composition — the split endpoint
    // keeps the original formation on both halves).
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthM: 3,
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [
        { id: 'tgt-top', depth_top_m: 0, depth_base_m: 5 },
        { id: 'tgt-bottom', depth_top_m: 5, depth_base_m: 12 },
      ],
      targetTerminalDepthM: 12,
    })
    expect(plan).toEqual({ kind: 'split', layerId: 'tgt-top', depthM: 3 })
  })

  it('dropped below the terminal depth: refused (empty target)', () => {
    // z=8 but the empty target CPT only reaches 6 m → nothing to anchor U2's
    // base against, so the drop is refused rather than inventing depth.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthM: 8,
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
    // The target column is gap-free to 5 m; z=8 is below its deepest layer, so
    // there is nothing to split — refused, same as the empty case.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthM: 8,
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
      contactDepthM: 3,
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [],
      targetTerminalDepthM: 10,
    })
    expect(plan).toEqual({ kind: 'noop', reason: 'same_column' })
  })

  it('drop where the target already has that exact boundary is a no-op', () => {
    // z=3 coincides with a boundary already present on the target → nothing to
    // split and nothing to create; a silent no-op, not a duplicate boundary.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthM: 3,
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
    // Only the layer below the contact exists (e.g. the surface contact of the
    // first unit) → cannot express "both units", so refuse.
    const plan = planLithoContactCopy({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      contactDepthM: 0,
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
      contactDepthM: 3,
      sourceLayers: SOURCE_LAYERS,
      targetLayers: [],
      targetTerminalDepthM: null,
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'unknown_terminal' })
  })
})
