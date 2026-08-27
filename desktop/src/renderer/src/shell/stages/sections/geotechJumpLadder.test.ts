// Red-first pins for the section → Parameters jump ladder (spec §2,
// 2026-08-27). Every section jump lands on the most specific node it can
// PROVE, falling back one level at a time — phrased in the ruling's words.
//
// JL1 — a geotech surface with a RESOLVED body → geotech-body (the leaf).
// JL2 — a geotech surface whose body is UNRESOLVED but whose region's litho
//       parent body is UNIQUE → geotech-class (that litho body + the region's
//       NAD class).
// JL3 — still unresolved (no region, or the region spans two litho bodies) →
//       geotech-unit (today's fallback).
// JL4 — a litho surface with a body → litho-body; without → litho-unit.

import { describe, expect, it } from 'vitest'

import { geotechJumpScope, lithoJumpScope } from './geotechJumpLadder'

const LITHO_LAYERS = [
  { id: 'L1', formation_id: 'silt', body_id: 'lb1' },
  { id: 'L2', formation_id: 'silt', body_id: 'lb2' },
]
const GEOTECH_LAYERS = [
  { id: 'g1', formation_id: 'silt-sf', body_id: 'gbA', parent_litho_layer_id: 'L1' },
  { id: 'g2', formation_id: 'silt-sf', body_id: null, parent_litho_layer_id: 'L1' },
  { id: 'g3', formation_id: 'silt-sf', body_id: null, parent_litho_layer_id: 'L2' },
]
const GEOTECH_FORMATIONS = [{ id: 'silt-sf', nad_class: 13 }]

const CTX = {
  lithoLayers: LITHO_LAYERS,
  geotechLayers: GEOTECH_LAYERS,
  geotechFormations: GEOTECH_FORMATIONS,
}

describe('geotechJumpScope — the fallback ladder (spec §2)', () => {
  it('JL1 — a resolved body lands on the geotech-body leaf', () => {
    expect(geotechJumpScope('silt-sf', 'gbA', undefined, CTX)).toEqual({
      kind: 'geotech-body',
      unitId: 'silt-sf',
      bodyId: 'gbA',
    })
  })

  it('JL2 — an unresolved body with a UNIQUE litho parent body lands on geotech-class', () => {
    // The region is one geotech band (g2) whose litho parent (L1) belongs to
    // litho body lb1; its class is 13.
    expect(geotechJumpScope('silt-sf', null, ['g2'], CTX)).toEqual({
      kind: 'geotech-class',
      lithoUnitId: 'silt',
      lithoBodyId: 'lb1',
      nadClass: 13,
    })
  })

  it('JL3 — an unresolved region spanning TWO litho bodies falls back to geotech-unit', () => {
    // g2 → lb1, g3 → lb2: no unique litho parent body, so no class row to land
    // on; the pooled formation view is the honest fallback.
    expect(geotechJumpScope('silt-sf', null, ['g2', 'g3'], CTX)).toEqual({
      kind: 'geotech-unit',
      unitId: 'silt-sf',
    })
  })

  it('JL3b — no region context at all falls back to geotech-unit', () => {
    expect(geotechJumpScope('silt-sf', null, undefined, CTX)).toEqual({
      kind: 'geotech-unit',
      unitId: 'silt-sf',
    })
  })
})

describe('lithoJumpScope — a litho surface jumps as itself (spec §2)', () => {
  it('JL4 — a litho surface with a body lands on litho-body; without, litho-unit', () => {
    expect(lithoJumpScope('silt', 'lb1')).toEqual({
      kind: 'litho-body',
      unitId: 'silt',
      bodyId: 'lb1',
    })
    expect(lithoJumpScope('silt', null)).toEqual({ kind: 'litho-unit', unitId: 'silt' })
  })
})
