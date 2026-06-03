import { describe, expect, it } from 'vitest'

import type { BodyListItem, LithoLayerResponse } from '../api/client'
import { computeBodyBands, type BandColumn } from './bodyBands'

function body(id: string, formationId: string): BodyListItem {
  return { id, formation_id: formationId } as unknown as BodyListItem
}

function layer(
  bodyId: string | null,
  invId: string,
  top: number,
  base: number,
  status = 'accepted',
  formationId = 'f-default',
): LithoLayerResponse {
  return {
    id: `${bodyId}-${invId}`,
    body_id: bodyId,
    formation_id: formationId,
    borehole_id: invId,
    cpt_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status,
  } as unknown as LithoLayerResponse
}

function cols(...entries: [string, number, number][]): Map<string, BandColumn> {
  const m = new Map<string, BandColumn>()
  for (const [inv, along, surf] of entries) {
    m.set(inv, { investigationId: inv, along, surfaceElevM: surf })
  }
  return m
}

describe('computeBodyBands', () => {
  it('returns member columns ordered left → right with absolute elevations', () => {
    // Columns supplied out of along order to prove the helper sorts them.
    const bands = computeBodyBands(
      [body('k', 'KLEI')],
      [layer('k', 'B', 4, 6), layer('k', 'A', 3, 5), layer('k', 'C', 5, 7)],
      cols(['A', 0, 10], ['B', 100, 10], ['C', 200, 10]),
    )

    expect(bands).toHaveLength(1)
    const band = bands[0]
    expect(band.formationId).toBe('KLEI')
    expect(band.members.map(m => m.investigationId)).toEqual(['A', 'B', 'C'])
    // elev = surface(10) - depth.
    expect(band.members.map(m => m.topElev)).toEqual([7, 6, 5])
    expect(band.members.map(m => m.baseElev)).toEqual([5, 4, 3])
  })

  it('carries each member layer’s own formation (for the one-lithology guard)', () => {
    // A mis-grouped body: a KLEI member and a SILT member under one body id.
    const bands = computeBodyBands(
      [body('k', 'f-silt')],
      [
        layer('k', 'A', 3, 5, 'accepted', 'f-klei'),
        layer('k', 'B', 4, 6, 'accepted', 'f-silt'),
      ],
      cols(['A', 0, 10], ['B', 100, 10]),
    )
    expect(bands).toHaveLength(1)
    // The overlay reads each member's OWN formation to colour + guard, so a
    // KLEI member is never painted with the body's nominal SILT colour.
    expect(bands[0].members.map(m => m.formationId)).toEqual(['f-klei', 'f-silt'])
  })

  it('skips a body present on only one on-section column (no gap to fill)', () => {
    const bands = computeBodyBands(
      [body('k', 'KLEI')],
      [layer('k', 'A', 3, 5), layer('k', 'OFF', 3, 5)],
      // Only column A is on the section; OFF is not placed.
      cols(['A', 0, 10]),
    )
    expect(bands).toEqual([])
  })

  it('ignores non-accepted member layers', () => {
    const bands = computeBodyBands(
      [body('k', 'KLEI')],
      [layer('k', 'A', 3, 5), layer('k', 'B', 4, 6, 'pending')],
      cols(['A', 0, 10], ['B', 100, 10]),
    )
    expect(bands).toEqual([])
  })

  it('emits one band per body and respects per-body membership', () => {
    const bands = computeBodyBands(
      [body('k', 'KLEI'), body('z', 'ZAND')],
      [
        layer('k', 'A', 3, 5),
        layer('k', 'B', 4, 6),
        layer('z', 'A', 5, 8),
        layer('z', 'B', 6, 9),
      ],
      cols(['A', 0, 10], ['B', 100, 10]),
    )
    expect(bands.map(b => b.bodyId).sort()).toEqual(['k', 'z'])
  })
})
