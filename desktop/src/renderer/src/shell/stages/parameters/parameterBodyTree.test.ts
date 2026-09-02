// Red-first pins for the Parameters body tree — the owner-ruled four-level
// tree (litho unit ▸ litho body ▸ NAD class ▸ geotech body) and its one
// band-selection authority ``bandsForScope`` (spec §7, 2026-08-27).
//
// Phrased in the rulings' own words, not impl variable names:
//   * "geometrically split all litho bodies first ... the geotech subsplit
//     then lives beneath that" — the four levels.
//   * a class row keys on nad_class, so duplicate geo-label TWIN formation
//     rows "produce no extra rows".
//   * "a body is only a body if it is geometrically connected" — a body-scoped
//     pool takes exactly that body's bands.
//   * a geotech band with no covering litho band (parent NULL) is "never given
//     an invented home" — excluded and counted in the unit's orphan footer.

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../../../api/client'
import type { BodyRosterEntry } from './parameterUnitBodies'
import {
  bandsForScope,
  buildParameterTree,
  type ParameterTreeInput,
  type ParameterTreeNode,
} from './parameterBodyTree'
import { scopeHeaderLabel } from './parameterScopeHeader'

// ── Minimal fixtures ─────────────────────────────────────────────────────────
// Only the fields the tree reads are meaningful; the rest are filled to satisfy
// the response types.

function formation(
  id: string,
  over: Partial<GeologicalFormationResponse>,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'p',
    name: id,
    color: '#888',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    parent_extrapolated: false,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function layer(id: string, over: Partial<LithoLayerResponse>): LithoLayerResponse {
  return {
    id,
    model_id: 'm',
    formation_id: 'f',
    borehole_id: null,
    cpt_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    parent_litho_layer_id: null,
    notes: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as LithoLayerResponse
}

function roster(
  entries: ReadonlyArray<[string, BodyRosterEntry]>,
): ReadonlyMap<string, BodyRosterEntry> {
  return new Map(entries)
}

// The scene:
//   SILT litho unit — two geometrically split litho bodies lb1, lb2
//     lb1 subdivided into NAD 13 (two twin geotech formations sf-A / sf-B →
//         two geotech bodies gbA, gbB) and NAD 14 (one geotech body gbMF)
//     lb2 subdivided into NAD 13 only (one geotech body gb2)
//   plus one orphan geotech band (no covering litho band) sourced to SILT
//   CLAY litho unit — one litho body, no geotech subdivision
function makeScene(): ParameterTreeInput {
  const lithoFormations = [
    formation('silt-unit', { name: 'SILT', display_order: 0, litho_main_soil_code: 'SILT' }),
    formation('clay-unit', { name: 'CLAY', display_order: 1, litho_main_soil_code: 'KLEI' }),
  ]
  const geotechFormations = [
    // TWIN rows: same soil + nad_class, different geo-label — the duplicate
    // formation rows the tree must fold to one class row.
    formation('silt-sf-A', { nad_class: 13, source_litho_formation_id: 'silt-unit' }),
    formation('silt-sf-B', { nad_class: 13, source_litho_formation_id: 'silt-unit' }),
    formation('silt-mf', { nad_class: 14, source_litho_formation_id: 'silt-unit' }),
    formation('clay-geo', { nad_class: 21, source_litho_formation_id: 'clay-unit' }),
  ]
  const lithoLayers = [
    layer('L1', { formation_id: 'silt-unit', body_id: 'lb1', cpt_id: 'c1' }),
    layer('L2', { formation_id: 'silt-unit', body_id: 'lb2', cpt_id: 'c2' }),
    layer('LC', { formation_id: 'clay-unit', body_id: 'lbC', cpt_id: 'c1' }),
  ]
  const geotechLayers = [
    layer('g1', { formation_id: 'silt-sf-A', parent_litho_layer_id: 'L1', body_id: 'gbA', cpt_id: 'c1' }),
    layer('g2', { formation_id: 'silt-sf-B', parent_litho_layer_id: 'L1', body_id: 'gbB', cpt_id: 'c1' }),
    layer('g3', { formation_id: 'silt-mf', parent_litho_layer_id: 'L1', body_id: 'gbMF', cpt_id: 'c1' }),
    layer('g4', { formation_id: 'silt-sf-A', parent_litho_layer_id: 'L2', body_id: 'gb2', cpt_id: 'c2' }),
    // orphan — no covering litho band; sourced to SILT via its formation.
    layer('gOrphan', { formation_id: 'silt-sf-A', parent_litho_layer_id: null, body_id: null, cpt_id: 'c1' }),
  ]
  const lithoBodies = roster([
    ['lb1', { name: null, body_ordinal: 0, formation_id: 'silt-unit' }],
    ['lb2', { name: null, body_ordinal: 1, formation_id: 'silt-unit' }],
    ['lbC', { name: null, body_ordinal: 0, formation_id: 'clay-unit' }],
  ])
  const geotechBodies = roster([
    ['gbA', { name: null, body_ordinal: 0, formation_id: 'silt-sf-A' }],
    ['gbB', { name: null, body_ordinal: 1, formation_id: 'silt-sf-B' }],
    ['gbMF', { name: null, body_ordinal: 0, formation_id: 'silt-mf' }],
    ['gb2', { name: null, body_ordinal: 2, formation_id: 'silt-sf-A' }],
  ])
  return { lithoFormations, geotechFormations, lithoLayers, geotechLayers, lithoBodies, geotechBodies }
}

function childKinds(node: ParameterTreeNode): string[] {
  return node.children.map(c => c.scope.kind)
}

describe('parameterBodyTree — the owner-ruled body tree (spec §7)', () => {
  it('PT1 — a two-twin, multi-body scene: litho unit ▸ litho bodies ▸ class rows ▸ geotech bodies; twins fold to one class row', () => {
    const tree = buildParameterTree(makeScene())

    // Top level is litho units, roster order.
    expect(tree.map(n => n.scope.kind)).toEqual(['litho-unit', 'litho-unit'])
    const silt = tree[0]
    expect(silt.scope).toMatchObject({ kind: 'litho-unit', unitId: 'silt-unit' })

    // SILT has its two geometrically split litho bodies.
    expect(childKinds(silt)).toEqual(['litho-body', 'litho-body'])
    const lb1 = silt.children[0]
    expect(lb1.scope).toMatchObject({ kind: 'litho-body', unitId: 'silt-unit', bodyId: 'lb1' })

    // lb1's class rows key on nad_class — the two TWIN formation rows (sf-A,
    // sf-B) both class 13 produce ONE class row, not two.
    expect(childKinds(lb1)).toEqual(['geotech-class', 'geotech-class'])
    const class13 = lb1.children[0]
    expect(class13.scope).toMatchObject({
      kind: 'geotech-class',
      lithoUnitId: 'silt-unit',
      lithoBodyId: 'lb1',
      nadClass: 13,
    })
    // ...and under that one class row sit BOTH twin geotech bodies.
    expect(childKinds(class13)).toEqual(['geotech-body', 'geotech-body'])
    expect(class13.children.map(c => (c.scope as { bodyId: string }).bodyId)).toEqual(['gbA', 'gbB'])
    expect(class13.children.every(c => c.children.length === 0)).toBe(true)
  })

  it('PT2 — single-child collapse drops the geotech-body ordinal and the empty-unit level, but NEVER the single packing-class label (owner ruling 2026-09-02)', () => {
    const tree = buildParameterTree(makeScene())
    const silt = tree[0]

    // NAD 14 under lb1 has ONE geotech body → the geotech-body ordinal row
    // collapses; the class row itself (with its pakkingsdichtheid label) stays.
    const class14 = silt.children[0].children[1]
    expect(class14.scope).toMatchObject({ kind: 'geotech-class', nadClass: 14 })
    expect(class14.children).toEqual([])

    // lb2 has ONE packing class (NAD 13) with ONE geotech body. Owner ruling
    // 2026-09-02 — "don't collapse because the pakkingsdichtheid label
    // disappears": the lone class is NO LONGER collapsed away. lb2 keeps a class
    // node whose pakkingsdichtheid label is present, so the body stays openable.
    const lb2 = silt.children[1]
    expect(lb2.scope).toMatchObject({ kind: 'litho-body', bodyId: 'lb2' })
    expect(lb2.children).toHaveLength(1)
    const lb2Class = lb2.children[0]
    expect(lb2Class.scope).toMatchObject({ kind: 'geotech-class', nadClass: 13 })
    expect(lb2Class.label).toBe('SILT, slightly firm')
    // ...but the class row's own single geotech body still collapses (that
    // drops only the #ordinal, not the pakkingsdichtheid label).
    expect(lb2Class.children).toEqual([])

    // CLAY unit has ONE litho body with NO packing class at all → there is no
    // pakkingsdichtheid label to lose, so the empty-unit collapse still fires.
    const clay = tree[1]
    expect(clay.scope).toMatchObject({ kind: 'litho-unit', unitId: 'clay-unit' })
    expect(clay.children).toEqual([])
  })

  it('PT3 — a geotech band with no covering litho band is excluded and counted in the unit orphan footer, never given an invented home', () => {
    const tree = buildParameterTree(makeScene())
    const silt = tree[0]

    // The orphan is counted once on its source litho unit...
    expect(silt.orphanCount).toBe(1)
    // ...and does NOT appear as a class row or geotech body anywhere in SILT.
    const allScopes: string[] = []
    const walk = (n: ParameterTreeNode): void => {
      allScopes.push(JSON.stringify(n.scope))
      n.children.forEach(walk)
    }
    tree.forEach(walk)
    // gOrphan's body is null, so no geotech-body node can carry it — assert no
    // node's bandsForScope contains it.
    const scene = makeScene()
    const orphanInAnyNode = allScopes.some(s => {
      const scope = JSON.parse(s) as Parameters<typeof bandsForScope>[0]
      return bandsForScope(scope, scene).some(b => b.id === 'gOrphan')
    })
    expect(orphanInAnyNode).toBe(false)
  })

  it('PT4 — bandsForScope selects exactly the node kind ground', () => {
    const scene = makeScene()
    const ids = (scope: Parameters<typeof bandsForScope>[0]): string[] =>
      bandsForScope(scope, scene).map(b => b.id).sort()

    // litho-unit = all its accepted litho bands.
    expect(ids({ kind: 'litho-unit', unitId: 'silt-unit' })).toEqual(['L1', 'L2'])
    // litho-body = the body's litho bands (body IS the scope).
    expect(ids({ kind: 'litho-body', unitId: 'silt-unit', bodyId: 'lb1' })).toEqual(['L1'])
    // geotech-class = geotech bands of that nadClass whose litho parent band
    // belongs to the litho body — the twins fold in, the wrong litho body drops.
    expect(
      ids({ kind: 'geotech-class', lithoUnitId: 'silt-unit', lithoBodyId: 'lb1', nadClass: 13 }),
    ).toEqual(['g1', 'g2'])
    // geotech-body = the body's bands.
    expect(ids({ kind: 'geotech-body', unitId: 'silt-sf-A', bodyId: 'gbA' })).toEqual(['g1'])
    // geotech-unit = the formation row's bands (fallback), orphan included.
    expect(ids({ kind: 'geotech-unit', unitId: 'silt-sf-A' })).toEqual(['g1', 'g4', 'gOrphan'])
  })

  it('PT5 — counts per node are N bands · M with cone over exactly bandsForScope', () => {
    const scene = makeScene()
    const tree = buildParameterTree(scene)
    const silt = tree[0]

    // litho-unit SILT: its accepted litho bands L1, L2 — both CPT-anchored.
    expect(silt.bandCount).toBe(2)
    expect(silt.coneBandCount).toBe(2)

    // class 13 under lb1: g1, g2 — both cone bands.
    const class13 = silt.children[0].children[0]
    expect(class13.bandCount).toBe(2)
    expect(class13.coneBandCount).toBe(2)

    // geotech body gbA: one band g1.
    const gbA = class13.children[0]
    expect(gbA.bandCount).toBe(1)
    expect(gbA.coneBandCount).toBe(1)
  })

  it('PT6 — scopeHeaderLabel names the path from the litho unit down (spec §3)', () => {
    const scene = makeScene()
    // A class row: "SILT › #1 › SILT, slightly firm — pooled across 2 bodies".
    const classHeader = scopeHeaderLabel(
      { kind: 'geotech-class', lithoUnitId: 'silt-unit', lithoBodyId: 'lb1', nadClass: 13 },
      scene,
    )
    expect(classHeader).toContain('SILT · #0')
    expect(classHeader).toContain('SILT, slightly firm')
    expect(classHeader).toContain('pooled across 2 bodies')

    // A leaf geotech body reads the full path, ending in its own label — the
    // UNIFIED geotech-body vocabulary "SILT · SF #0" (soil + packing + ordinal),
    // never the packing-only "SF #0" that read like the litho body (owner
    // dogfeed 2026-09-01).
    const bodyHeader = scopeHeaderLabel({ kind: 'geotech-body', unitId: 'silt-sf-A', bodyId: 'gbA' }, scene)
    expect(bodyHeader).toContain('SILT · #0')
    expect(bodyHeader).toContain('SILT · SF #0')

    // A litho unit says it spans the whole unit (R1 wording).
    expect(scopeHeaderLabel({ kind: 'litho-unit', unitId: 'silt-unit' }, scene)).toContain(
      'whole litho unit, all packing classes',
    )
  })
})

// Guard (moved from unitStatistics BS4, now bandsForScope's authority): a
// resolver body can span two duplicate (twin) formation rows; a body scope
// pools the WHOLE body, so the formation filter must NOT survive.
describe('bandsForScope — a body spans twin formation rows (F2)', () => {
  it('BT1 — a litho-body scope pools every band of the body across twin formation rows', () => {
    const scene: ParameterTreeInput = {
      lithoFormations: [formation('twin-A', { name: 'A', display_order: 0 }), formation('twin-B', { name: 'B', display_order: 1 })],
      geotechFormations: [],
      lithoLayers: [
        layer('t1', { formation_id: 'twin-A', body_id: 'body-X', cpt_id: 'c1' }),
        layer('t2', { formation_id: 'twin-B', body_id: 'body-X', cpt_id: 'c2' }),
        layer('t3', { formation_id: 'twin-A', body_id: 'body-Y', cpt_id: 'c3' }),
      ],
      geotechLayers: [],
      lithoBodies: new Map(),
      geotechBodies: new Map(),
    }
    const ids = bandsForScope({ kind: 'litho-body', unitId: 'twin-A', bodyId: 'body-X' }, scene)
      .map(b => b.id)
      .sort()
    expect(ids).toEqual(['t1', 't2'])
  })
})
