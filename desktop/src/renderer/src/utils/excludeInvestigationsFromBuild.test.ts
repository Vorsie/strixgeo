/**
 * "Just plain ignore them" — what an excluded test must leave behind: nothing.
 *
 * XI1  its column goes
 * XI2  its layers go
 * XI3  every correlation edge that touched one of its layers goes — the residue
 *      that would otherwise state "these two units are one body" across a
 *      column that is no longer drawn
 * XI4  edges between tests that STAY are untouched
 * XI5  an empty exclusion set is a no-op, by reference
 */

import { describe, expect, it } from 'vitest'

import { excludeInvestigationsFromBuild } from './excludeInvestigationsFromBuild'
import type { BuildInputSlice } from './excludeInvestigationsFromBuild'
import type { LithoLayerLike } from './assembleLithoSectionInputs'

function layer(id: string, investigationId: string, isBorehole = false): LithoLayerLike {
  return {
    id,
    cpt_id: isBorehole ? null : investigationId,
    borehole_id: isBorehole ? investigationId : null,
    formation_id: 'f-1',
    body_id: null,
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  }
}

function slice(): BuildInputSlice {
  return {
    investigations: [
      { id: 'S1', location_x: 0, location_y: 0, elevation_m: 5 },
      { id: 'S2', location_x: 50, location_y: 0, elevation_m: 5 },
      { id: 'B12', location_x: 100, location_y: 0, elevation_m: 5 },
    ],
    layers: [layer('l-s1', 'S1'), layer('l-s2', 'S2'), layer('l-b12', 'B12', true)],
    edgesBySectionId: new Map([
      [
        'sec-1',
        [
          { a: 'l-s1', b: 'l-s2' },
          { a: 'l-s2', b: 'l-b12', aSide: 'base' as const, bSide: 'base' as const },
        ],
      ],
    ]),
  }
}

describe('excludeInvestigationsFromBuild', () => {
  it('XI1 — the excluded test is no longer available to project as a column', () => {
    const out = excludeInvestigationsFromBuild(slice(), new Set(['B12']))
    expect(out.investigations.map(i => i.id)).toEqual(['S1', 'S2'])
  })

  it('XI2 — its layers go with it, borehole anchor as well as CPT anchor', () => {
    const out = excludeInvestigationsFromBuild(slice(), new Set(['B12']))
    expect(out.layers.map(l => l.id)).toEqual(['l-s1', 'l-s2'])
  })

  it('XI3 — an edge anchored on one of its layers goes too', () => {
    const out = excludeInvestigationsFromBuild(slice(), new Set(['B12']))
    expect(out.edgesBySectionId.get('sec-1')).toEqual([{ a: 'l-s1', b: 'l-s2' }])
  })

  it('XI4 — edges between tests that stay are carried through untouched', () => {
    const out = excludeInvestigationsFromBuild(slice(), new Set(['S1']))
    expect(out.edgesBySectionId.get('sec-1')).toEqual([
      { a: 'l-s2', b: 'l-b12', aSide: 'base', bSide: 'base' },
    ])
  })

  it('XI5 — excluding nothing changes nothing, by reference', () => {
    const input = slice()
    expect(excludeInvestigationsFromBuild(input, new Set())).toBe(input)
  })
})
