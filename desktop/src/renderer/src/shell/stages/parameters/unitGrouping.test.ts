// Pure pins for the Parameters-pane grouping helpers (the right-pane "Group" /
// "Ungroup" gesture, owner finding 2026-09-03: "ik wil ook kunnen groeperen in
// de right hand pane van de parameter stage").
//
// The gesture reuses the section-canvas Join client method verbatim; these pins
// cover the pure glue the pane adds around it: which anchor layer stands for a
// body, which layer pairs one POST-per-pair chain needs to link N bodies into
// ONE group, the same-class guard (a group is one mass), and which union rows an
// "Ungroup" must lift to remove a body from its group.

import { describe, expect, it } from 'vitest'

import type { BodyUnionListItem } from '../../../api/client'
import {
  anchorLayersForBodies,
  bodyNadClassMap,
  groupGuardStatus,
  groupUnionPairs,
  unionIdsAnchoringBody,
} from './unitGrouping'

function layer(id: string, over: Record<string, unknown>) {
  return {
    id,
    formation_id: 'f',
    cpt_id: 'c1',
    borehole_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    body_id: null,
    parent_litho_layer_id: null,
    ...over,
  } as never
}

function formation(id: string, nadClass: number | null) {
  return { id, name: id, display_order: 0, nad_class: nadClass } as never
}

const FORMATIONS = [formation('silt-sf', 13), formation('silt-mf', 14)]
const LAYERS = [
  layer('g1', { formation_id: 'silt-sf', body_id: 'gbA' }),
  layer('g2', { formation_id: 'silt-sf', body_id: 'gbB' }),
  layer('g3', { formation_id: 'silt-mf', body_id: 'gbMF' }),
  // pending band — never an anchor, never a class source.
  layer('gp', { formation_id: 'silt-sf', body_id: 'gbP', status: 'pending' }),
]

function union(id: string, aBody: string | null, bBody: string | null): BodyUnionListItem {
  return {
    id,
    model_id: 'geo-1',
    layer_a_id: `${aBody}-L`,
    layer_b_id: `${bBody}-L`,
    anchor_a: { layer_id: `${aBody}-L`, body_id: aBody, body_name: null, body_ordinal: 0, formation_id: 'silt-sf' },
    anchor_b: { layer_id: `${bBody}-L`, body_id: bBody, body_name: null, body_ordinal: 1, formation_id: 'silt-sf' },
    created_at: '',
  }
}

describe('unitGrouping — bodyNadClassMap', () => {
  it('maps each accepted body to its formation nad_class, skipping pending bands', () => {
    const m = bodyNadClassMap(LAYERS, FORMATIONS)
    expect(m.get('gbA')).toBe(13)
    expect(m.get('gbB')).toBe(13)
    expect(m.get('gbMF')).toBe(14)
    // gbP's only band is pending → not a class source.
    expect(m.has('gbP')).toBe(false)
  })
})

describe('unitGrouping — anchorLayersForBodies', () => {
  it('resolves each body to its FIRST accepted stamped layer (the join anchor rule)', () => {
    const anchors = anchorLayersForBodies(['gbA', 'gbB'], LAYERS)
    expect(anchors.get('gbA')).toBe('g1')
    expect(anchors.get('gbB')).toBe('g2')
  })

  it('omits a body with no accepted stamped band (never invents an anchor)', () => {
    const anchors = anchorLayersForBodies(['gbP'], LAYERS)
    expect(anchors.has('gbP')).toBe(false)
  })
})

describe('unitGrouping — groupUnionPairs', () => {
  it('links N bodies into ONE group by star-pairing the first anchor with each other', () => {
    const anchors = new Map([
      ['gbA', 'g1'],
      ['gbB', 'g2'],
      ['gbMF', 'g3'],
    ])
    // Three bodies → two POSTs: (g1,g2) and (g1,g3) — one connected component.
    expect(groupUnionPairs(['gbA', 'gbB', 'gbMF'], anchors)).toEqual([
      ['g1', 'g2'],
      ['g1', 'g3'],
    ])
  })

  it('a lone body yields no pair (grouping needs at least two)', () => {
    expect(groupUnionPairs(['gbA'], new Map([['gbA', 'g1']]))).toEqual([])
  })
})

describe('unitGrouping — groupGuardStatus (a group is one mass: same NAD class)', () => {
  const classByBody = new Map([
    ['gbA', 13],
    ['gbB', 13],
    ['gbMF', 14],
  ])

  it('two same-class bodies can be grouped', () => {
    expect(groupGuardStatus(['gbA', 'gbB'], classByBody)).toBe('ok')
  })

  it('bodies of different class cannot be grouped together', () => {
    expect(groupGuardStatus(['gbA', 'gbMF'], classByBody)).toBe('cross-class')
  })

  it('fewer than two selected is not yet a group', () => {
    expect(groupGuardStatus(['gbA'], classByBody)).toBe('need-two')
  })
})

describe('unitGrouping — unionIdsAnchoringBody (the Ungroup delete set)', () => {
  it('collects every union that anchors the body, de-duplicated', () => {
    const unions = [union('u1', 'gbA', 'gbB'), union('u2', 'gbA', 'gbMF'), union('u3', 'gbB', 'gbMF')]
    // gbA sits in u1 and u2 → both lift to remove it from the group.
    expect(unionIdsAnchoringBody('gbA', unions).sort()).toEqual(['u1', 'u2'])
    // gbMF sits in u2 and u3.
    expect(unionIdsAnchoringBody('gbMF', unions).sort()).toEqual(['u2', 'u3'])
  })

  it('a body in no union has nothing to lift', () => {
    expect(unionIdsAnchoringBody('gbA', [union('u1', 'gbB', 'gbMF')])).toEqual([])
  })
})
