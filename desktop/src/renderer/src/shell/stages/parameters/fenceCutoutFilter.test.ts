// Pins for the fence-cutout panel filter under the body scope (owner ruling
// 2026-08-27: the fence cutout showed a disconnected body the engineer did
// not select — "a body is only a body if it is geometrically connected or if
// the users says, this body is the same as that body").
//
// Pure filter only — Cesium does not run under jsdom, so the scene is pinned
// at the one place the scope acts: which wall panels survive.
//
// FC1 — the pooled scope keeps every panel of the formation (today's filter,
//       byte-identical).
// FC2 — body-scoped, the OTHER body's panels are excluded.
// FC3 — body-scoped, a panel with no body attribution is not the chosen body.
// FC4 — other formations never pass, whatever the body says.

import { describe, expect, it } from 'vitest'

import type { FencePanel } from '../../../utils/fencePanels'
import { fenceCutoutPanels } from './fenceCutoutFilter'

function panel(formationId: string, bodyId: string | null): FencePanel {
  return {
    formationId,
    bodyId,
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, -1],
    ],
    triangles: [[0, 1, 2]],
  }
}

const PANELS: FencePanel[] = [
  panel('u1', 'body-A'),
  panel('u1', 'body-B'),
  panel('u1', null),
  panel('u2', 'body-A'),
]

describe('fenceCutoutPanels — the R4 cutout under the body ruling', () => {
  it('FC1 — pooled scope keeps every panel of the formation', () => {
    const out = fenceCutoutPanels(PANELS, { kind: 'geotech', unitId: 'u1' })
    expect(out!.map(p => p.bodyId)).toEqual(['body-A', 'body-B', null])
  })

  it('FC2 — body-scoped, the other body\'s panels are excluded', () => {
    const out = fenceCutoutPanels(PANELS, { kind: 'geotech', unitId: 'u1', bodyId: 'body-A' })
    expect(out!.map(p => p.bodyId)).toEqual(['body-A'])
  })

  it('FC3 — body-scoped, unattributed paint is not the chosen body', () => {
    const out = fenceCutoutPanels(PANELS, { kind: 'geotech', unitId: 'u1', bodyId: 'body-B' })
    expect(out!.map(p => p.bodyId)).toEqual(['body-B'])
  })

  it('FC4 — other formations never pass, whatever the body says', () => {
    const out = fenceCutoutPanels(PANELS, { kind: 'geotech', unitId: 'u2', bodyId: 'body-A' })
    expect(out!.map(p => p.formationId)).toEqual(['u2'])
  })

  it('FC5 — a null bodyId on the scope is the pooled view, exactly like an absent one', () => {
    const out = fenceCutoutPanels(PANELS, { kind: 'geotech', unitId: 'u1', bodyId: null })
    expect(out!).toHaveLength(3)
  })

  it('FC6 — undefined panels (fence not assembled yet) answer undefined, not an empty cutout', () => {
    expect(fenceCutoutPanels(undefined, { kind: 'geotech', unitId: 'u1' })).toBeUndefined()
  })
})
