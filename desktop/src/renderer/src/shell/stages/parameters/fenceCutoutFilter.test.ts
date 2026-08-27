// Pins for the fence-cutout panel filter under the body scope (owner ruling
// 2026-08-27: the fence cutout showed a disconnected body the engineer did
// not select — "a body is only a body if it is geometrically connected or if
// the users says, this body is the same as that body").
//
// AMENDED 2026-08-27 (owner live-data disproof, CS1): the MD sand's wall was
// CONTINUOUS on the section and all its CPT bands carried one formation twin,
// yet the body-scoped cutout showed gaps INSIDE the wall. The dropped
// segments were killed by ``p.bodyId === scope.bodyId`` — the panel's
// ``bodyId`` is the fill-region LABEL, which the weld mints locally and the
// hierarchical fill can stamp with LITHO frame ids; the label is not the
// identity currency (``regionBodyId.ts``). A panel belongs to the scoped
// body iff its SOURCE LAYERS say so: resolve the panel's ``layerIds``
// through ``litho_layer.body_id``, never through the label.
//
// Pure filter only — Cesium does not run under jsdom, so the scene is pinned
// at the one place the scope acts: which wall panels survive.
//
// FC1 — the pooled scope keeps every panel of the formation (today's filter,
//       byte-identical).
// FC2 — body-scoped, panels whose source layers belong to the OTHER body are
//       excluded.
// FC3 — body-scoped, unattributed paint (no layer resolves to any body) is
//       not the chosen body.
// FC4 — the body scope crosses twin formation rows: a body spanning twin
//       rows yields ALL its panels, whatever formation row labels them.
// FC5 — a null bodyId on the scope is the pooled view, exactly like an
//       absent one.
// FC6 — undefined panels (fence not assembled yet) answer undefined, not an
//       empty cutout.
// FC7 — the CS1 shape: a continuous run of panels over ONE body's layers
//       survives body-scoping INTACT even when mid-run panel bodyId LABELS
//       differ (frame-labelled or weld-minted) — the label never drops a
//       wall segment the layers claim.
// FC8 — a panel whose layers span several bodies is included when ANY source
//       layer belongs to the body: a wall segment shared at a boundary
//       belongs to both sides, and dropping it recreates the gap.

import { describe, expect, it } from 'vitest'

import type { FencePanel } from '../../../utils/fencePanels'
import { fenceCutoutPanels } from './fenceCutoutFilter'

function panel(
  formationId: string,
  bodyId: string | null,
  layerIds?: readonly string[],
): FencePanel {
  return {
    formationId,
    bodyId,
    layerIds,
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, -1],
    ],
    triangles: [[0, 1, 2]],
  }
}

/** ``litho_layer id → body_id`` — the axis's own layer list, the authority. */
const BODY_BY_LAYER: ReadonlyMap<string, string | null> = new Map([
  ['la-1', 'body-A'],
  ['la-2', 'body-A'],
  ['lb-1', 'body-B'],
  ['ln-1', null],
])

const PANELS: FencePanel[] = [
  panel('u1', 'body-A', ['la-1']),
  panel('u1', 'body-B', ['lb-1']),
  panel('u1', null, []),
  panel('u2', 'body-A', ['la-2']),
]

describe('fenceCutoutPanels — the R4 cutout under the body ruling', () => {
  it('FC1 — pooled scope keeps every panel of the formation', () => {
    const out = fenceCutoutPanels(PANELS, { kind: 'geotech', unitId: 'u1' }, BODY_BY_LAYER)
    expect(out!.map(p => p.bodyId)).toEqual(['body-A', 'body-B', null])
  })

  it('FC2 — body-scoped, panels whose layers belong to the other body are excluded', () => {
    const out = fenceCutoutPanels(
      PANELS,
      { kind: 'geotech', unitId: 'u1', bodyId: 'body-A' },
      BODY_BY_LAYER,
    )
    // u1's body-A panel AND the twin row's body-A panel (FC4) — never lb-1's.
    expect(out!.map(p => p.layerIds)).toEqual([['la-1'], ['la-2']])
  })

  it('FC3 — body-scoped, unattributed paint is not the chosen body', () => {
    const out = fenceCutoutPanels(
      [panel('u1', 'body-B', ['lb-1']), panel('u1', null, []), panel('u1', null, undefined)],
      { kind: 'geotech', unitId: 'u1', bodyId: 'body-B' },
      BODY_BY_LAYER,
    )
    expect(out!.map(p => p.layerIds)).toEqual([['lb-1']])
  })

  it('FC4 — a body spanning twin formation rows yields ALL its panels', () => {
    const out = fenceCutoutPanels(
      PANELS,
      { kind: 'geotech', unitId: 'u1', bodyId: 'body-A' },
      BODY_BY_LAYER,
    )
    // The u2 twin's panel is the same body's wall — the formation clause must
    // not hide it under a body scope.
    expect(out!.map(p => p.formationId)).toEqual(['u1', 'u2'])
  })

  it('FC5 — a null bodyId on the scope is the pooled view, exactly like an absent one', () => {
    const out = fenceCutoutPanels(
      PANELS,
      { kind: 'geotech', unitId: 'u1', bodyId: null },
      BODY_BY_LAYER,
    )
    expect(out!).toHaveLength(3)
  })

  it('FC6 — undefined panels (fence not assembled yet) answer undefined, not an empty cutout', () => {
    expect(
      fenceCutoutPanels(undefined, { kind: 'geotech', unitId: 'u1' }, BODY_BY_LAYER),
    ).toBeUndefined()
  })

  it('FC7 — a continuous run over one body survives INTACT despite differing mid-run labels', () => {
    // The CS1 shape: three adjacent wall segments, all painted from body-A's
    // layers, but the middle one labelled by the weld/frame with a foreign id
    // and the last with null. The old label filter dropped 2 of 3 — the gaps
    // the owner saw inside a continuous wall.
    const run = [
      panel('u1', 'body-A', ['la-1']),
      panel('u1', 'litho-frame-body-77', ['la-2']),
      panel('u1', null, ['la-1', 'la-2']),
    ]
    const out = fenceCutoutPanels(
      run,
      { kind: 'geotech', unitId: 'u1', bodyId: 'body-A' },
      BODY_BY_LAYER,
    )
    expect(out).toHaveLength(3)
  })

  it('FC8 — a panel whose layers span several bodies is included when ANY belongs', () => {
    const shared = panel('u1', 'body-A', ['la-1', 'lb-1'])
    const out = fenceCutoutPanels(
      [shared],
      { kind: 'geotech', unitId: 'u1', bodyId: 'body-B' },
      BODY_BY_LAYER,
    )
    expect(out).toHaveLength(1)
  })
})
