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

// The manual-group tag (D1) + the group pooling scope (D2), owner ruling
// 2026-09-02: "grouping is just for lumping things that are similar together, so
// we have more data" — a grouped body keeps its own id AND stays selectable, and
// selecting it pools every member's bands.
describe('parameterBodyTree — manual groups (debt #278 D1/D2)', () => {
  it('PT-G1 — a geotech-body leaf carries its group number from groupByBodyId', () => {
    // gbA + gbB are two same-class (NAD 13) bodies under litho body lb1 — the
    // Join makes them one group. Both leaves must show "(group 1)".
    const tree = buildParameterTree({ ...makeScene(), groupByBodyId: new Map([['gbA', 1], ['gbB', 1]]) })
    const class13 = tree[0].children[0].children[0]
    expect(class13.children.map(c => (c.scope as { bodyId: string }).bodyId)).toEqual(['gbA', 'gbB'])
    expect(class13.children.map(c => c.groupNumber)).toEqual([1, 1])
  })

  it('PT-G2 — "i don\'t need another hierarchical deeper level": grouping a sole-body class row adds NO child, the row itself puts the group name behind the level (owner dogfeed 2026-09-11)', () => {
    // lb2 has ONE geotech body (gb2), so its class row is already a leaf (PT2).
    // Joining that body into a group used to grow a geotech-body child under it
    // — "instead of just lumping and putting the group name behind the level, it
    // created a level even deeper which i can then group again". The row the
    // owner already sees stays the leaf AND carries the tag.
    const tree = buildParameterTree({ ...makeScene(), groupByBodyId: new Map([['gb2', 1]]) })
    const lb2Class = tree[0].children[1].children[0]
    expect(lb2Class.scope).toMatchObject({ kind: 'geotech-class', nadClass: 13 })
    expect(lb2Class.children).toEqual([])
    // "directly see which are grouped" — the tag rides the row the user sees.
    expect(lb2Class.groupNumber).toBe(1)
    // ...and the row stays that body's checkbox, so it can still be un-joined.
    expect(lb2Class.groupableBodyId).toBe('gb2')
  })

  it('PT-G2b — a sole-body class row names the geotech unit of its body, so a click on it can pool the whole group', () => {
    // The row stands for exactly one geotech body; the group scope a click
    // selects needs that body's formation id (the scope's ``unitId``), and no
    // geotech-body child is left to supply it once the row is a leaf.
    const tree = buildParameterTree({ ...makeScene(), groupByBodyId: new Map([['gb2', 1]]) })
    const lb2Class = tree[0].children[1].children[0]
    expect(lb2Class.groupableBodyUnitId).toBe('silt-sf-A')
    // A geotech-body LEAF carries the same pair (its own scope's unit + body).
    const gbALeaf = tree[0].children[0].children[0].children[0]
    expect(gbALeaf.groupableBodyId).toBe('gbA')
    expect(gbALeaf.groupableBodyUnitId).toBe('silt-sf-A')
    // A multi-body class row groups its children individually — no pair of its own.
    expect(tree[0].children[0].children[0].groupableBodyUnitId).toBeUndefined()
  })

  it('PT-G3 — an ungrouped geotech-body leaf carries a null group number', () => {
    const tree = buildParameterTree(makeScene())
    const gbALeaf = tree[0].children[0].children[0].children[0]
    expect(gbALeaf.scope).toMatchObject({ kind: 'geotech-body', bodyId: 'gbA' })
    expect(gbALeaf.groupNumber ?? null).toBeNull()
  })

  it('BS-G — a geotech-group scope pools EVERY member body’s accepted bands', () => {
    // Group {gbA (under lb1), gb2 (under lb2)} — two disjoint SF bodies in two
    // different litho bodies. Pooling gives gbA’s band g1 + gb2’s band g4.
    const ids = bandsForScope(
      { kind: 'geotech-group', unitId: 'silt-sf-A', groupNumber: 1, memberBodyIds: ['gbA', 'gb2'] },
      makeScene(),
    )
      .map(b => b.id)
      .sort()
    expect(ids).toEqual(['g1', 'g4'])
  })

  it('PT-G4 — a collapsed SOLE-body class row exposes groupableBodyId so it is checkable across parents (owner finding 2026-09-04)', () => {
    // lb2 has ONE geotech body (gb2), so its class row collapses (PT2). The
    // collapsed row must still expose the sole body id, so the owner can tick it
    // and group it with a same-class body under ANOTHER litho parent — "i can't
    // group loose sand in Zand #0 with loose Zand in Zand #2".
    const tree = buildParameterTree(makeScene())
    const lb2Class = tree[0].children[1].children[0]
    expect(lb2Class.children).toEqual([]) // still collapsed — the row IS the body
    expect(lb2Class.groupableBodyId).toBe('gb2')
  })

  it('PT-G5 — a geotech-body leaf exposes its own id; a multi-body class row exposes none', () => {
    const tree = buildParameterTree(makeScene())
    const class13 = tree[0].children[0].children[0] // lb1 ▸ NAD 13 (two bodies)
    expect(class13.children.map(c => c.groupableBodyId)).toEqual(['gbA', 'gbB'])
    // A multi-body class row is a plain expandable parent — no own checkbox.
    expect(class13.groupableBodyId).toBeUndefined()
  })

  it('PT-G6 — a collapsed SOLE-body class row carries its litho-parent label so its checkbox name is unambiguous across parents (ux-reviewer 2026-09-04)', () => {
    // A collapsed class row's own label is just the packing class ("SILT,
    // slightly firm") — identical for the same class under two litho bodies. The
    // checkbox must be disambiguated by the owning litho body, or two rows under
    // "Zand #0" and "Zand #2" read the same to AT and to a scrolled user.
    const tree = buildParameterTree(makeScene())
    const lb2Class = tree[0].children[1].children[0]
    expect(lb2Class.groupableBodyId).toBe('gb2')
    expect(lb2Class.groupableBodyParentLabel).toBe('SILT · #1')
    // A geotech-body LEAF needs no parent qualifier (its own label is unique).
    const gbALeaf = tree[0].children[0].children[0].children[0]
    expect(gbALeaf.groupableBodyParentLabel).toBeUndefined()
  })

  it('PT-G7 — a group spanning TWO litho parents tags BOTH members under their own parents (owner finding 2026-09-04)', () => {
    // gbA sits under litho body lb1, gb2 under lb2 — the exact "loose sand in
    // Zand #0 grouped with loose sand in Zand #2" case. Each member must keep its
    // own body id AND render "(group 1)" under its OWN litho parent (the header's
    // both-litho-bodies provenance is pinned separately by HG2).
    const tree = buildParameterTree({ ...makeScene(), groupByBodyId: new Map([['gbA', 1], ['gb2', 1]]) })
    // gbA shares its class row with gbB, so it renders as its own leaf...
    const gbAUnderLb1 = tree[0].children[0].children[0].children.find(
      c => (c.scope as { bodyId?: string }).bodyId === 'gbA',
    )
    // ...while gb2 is the only body of its class, so ITS row is the class row
    // itself (no deeper level, owner dogfeed 2026-09-11).
    const gb2UnderLb2 = tree[0].children[1].children[0]
    expect(gbAUnderLb1?.groupNumber).toBe(1)
    expect(gb2UnderLb2.groupableBodyId).toBe('gb2')
    expect(gb2UnderLb2.groupNumber).toBe(1)
  })
})

// Owner dogfeed 2026-09-16 (installer #41), verbatim: "So is that Zand (GL:|KL:)
// without dropdown, i thought we were moving the geotech packings to that dropdown
// instead of beneath SAND?" and, asked to confirm: "parameters tree, yeah it is a
// separate litho unit, so gets a separate dropdown."
//
// An admixture VARIANT (e.g. ZAND (GL|KL) — glauconitic, clayey sand) is its own
// litho FORMATION row, distinct from the plain ZAND, and — owner 2026-10-03, "a
// zand and zand/matig siltig are 2 different lithologies, never weld those" — its
// own bodies: the two never share a body_id, each body is homed on its own unit,
// and a body is listed under that home unit only.
describe('parameterBodyTree — an admixture variant is its own unit node (owner 2026-09-16)', () => {
  // ZAND and ZAND (GL|KL) are two litho FORMATIONS with a body each ('zb0' homed on
  // ZAND, 'gb0' homed on the variant, both #0). Each formation is subdivided to
  // NAD 6 (one geotech body each): the plain sand's packing is 'gzMd', the
  // variant's is 'ggMd'.
  function makeVariantScene(): ParameterTreeInput {
    const lithoFormations = [
      formation('zand', { name: 'ZAND', display_order: 0, litho_main_soil_code: 'ZAND' }),
      formation('zand-glkl', { name: 'ZAND (GL|KL)', display_order: 1, litho_main_soil_code: 'ZAND' }),
    ]
    const geotechFormations = [
      formation('zand-md', { nad_class: 6, source_litho_formation_id: 'zand' }),
      formation('zandglkl-md', { nad_class: 6, source_litho_formation_id: 'zand-glkl' }),
    ]
    const lithoLayers = [
      layer('Lz', { formation_id: 'zand', body_id: 'zb0', cpt_id: 'c1' }),
      layer('Lg', { formation_id: 'zand-glkl', body_id: 'gb0', cpt_id: 'c1' }),
    ]
    const geotechLayers = [
      layer('gz', { formation_id: 'zand-md', parent_litho_layer_id: 'Lz', body_id: 'gzMd', cpt_id: 'c1' }),
      layer('gg', { formation_id: 'zandglkl-md', parent_litho_layer_id: 'Lg', body_id: 'ggMd', cpt_id: 'c1' }),
    ]
    // Each unit numbers its own bodies from #0 (owner 2026-10-03).
    const lithoBodies = roster([
      ['zb0', { name: null, body_ordinal: 0, formation_id: 'zand' }],
      ['gb0', { name: null, body_ordinal: 0, formation_id: 'zand-glkl' }],
    ])
    const geotechBodies = roster([
      ['gzMd', { name: null, body_ordinal: 0, formation_id: 'zand-md' }],
      ['ggMd', { name: null, body_ordinal: 0, formation_id: 'zandglkl-md' }],
    ])
    return { lithoFormations, geotechFormations, lithoLayers, geotechLayers, lithoBodies, geotechBodies }
  }

  const unitNode = (tree: ParameterTreeNode[], unitId: string): ParameterTreeNode | undefined =>
    tree.find(n => (n.scope as { unitId?: string }).unitId === unitId)

  // The collapsed sole-body class row that stands for a unit's single packing body:
  // litho unit ▸ litho body ▸ class row (its ``groupableBodyId`` IS the body).
  const packingRow = (tree: ParameterTreeNode[], unitId: string): ParameterTreeNode | undefined =>
    unitNode(tree, unitId)?.children[0]?.children[0]

  it('PT-V1 — "ZAND (GL|KL) is its own unit node with a dropdown"', () => {
    const tree = buildParameterTree(makeVariantScene())
    const variant = unitNode(tree, 'zand-glkl')
    expect(variant).toBeDefined()
    expect(variant!.scope.kind).toBe('litho-unit')
    // A dropdown = it carries children (a litho body holding its packing), not a leaf.
    expect(variant!.children.length).toBeGreaterThan(0)
    expect(variant!.children[0].scope.kind).toBe('litho-body')
  })

  it('PT-V2 — "its packing bodies sit under it, not beneath SAND"', () => {
    const scene = makeVariantScene()
    const tree = buildParameterTree(scene)
    // The variant's packing (ggMd) sits under ZAND (GL|KL)...
    expect(packingRow(tree, 'zand-glkl')?.groupableBodyId).toBe('ggMd')
    // ...and the plain sand carries only its OWN packing (gzMd), never the variant's.
    expect(packingRow(tree, 'zand')?.groupableBodyId).toBe('gzMd')

    // The variant's class row pools the variant band 'gg' alone; the plain sand's
    // pools 'gz' alone — the packing is homed by source formation, not the welded body.
    const variantBands = bandsForScope(packingRow(tree, 'zand-glkl')!.scope, scene)
      .map(b => b.id)
      .sort()
    expect(variantBands).toEqual(['gg'])
    const plainBands = bandsForScope(packingRow(tree, 'zand')!.scope, scene)
      .map(b => b.id)
      .sort()
    expect(plainBands).toEqual(['gz'])
  })

  it('PT-V4 — "a body is listed under its home unit only" (owner 2026-10-03)', () => {
    // A stale body stamped before the ruling (one body id over a ZAND band and a
    // ZAND (GL|KL) band, homed on ZAND) shows under ZAND and NOT under the variant:
    // the 2026-09-16 "under every unit it carries bands of" path is retired.
    const scene = makeVariantScene()
    const stale: ParameterTreeInput = {
      ...scene,
      lithoLayers: [
        layer('Lz', { formation_id: 'zand', body_id: 'zbW', cpt_id: 'c1' }),
        layer('Lg', { formation_id: 'zand-glkl', body_id: 'zbW', cpt_id: 'c1' }),
      ],
      lithoBodies: roster([['zbW', { name: null, body_ordinal: 4, formation_id: 'zand' }]]),
    }
    const tree = buildParameterTree(stale)
    const bodiesUnder = (unitId: string): string[] =>
      (unitNode(tree, unitId)?.children ?? [])
        .filter(n => n.scope.kind === 'litho-body')
        .map(n => (n.scope as { bodyId: string }).bodyId)
    expect(bodiesUnder('zand')).toContain('zbW')
    expect(bodiesUnder('zand-glkl')).not.toContain('zbW')
  })

  it('PT-V3 — "a join across two litho parents still shows the group on both members"', () => {
    const tree = buildParameterTree({
      ...makeVariantScene(),
      groupByBodyId: new Map([['gzMd', 1], ['ggMd', 1]]),
    })
    expect(packingRow(tree, 'zand')?.groupNumber).toBe(1)
    expect(packingRow(tree, 'zand-glkl')?.groupNumber).toBe(1)
  })
})
