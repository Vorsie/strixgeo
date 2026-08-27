// Pins for the body level of the Parameters unit scope (owner ruling
// 2026-08-27, verbatim: "a body is only a body if it is geometrically
// connected or if the users says, this body is the same as that body").
//
// The unit rows are (soil, NAD-class, geo-label) formation rows that LUMP many
// resolver bodies — 32 rows carried 175 bodies on the live model. These pins
// hold the pure arithmetic behind the two-level list, the honest header and
// the body labels.
//
// PB1 — a unit's body rows group its accepted layers by body, with band + CPT counts.
// PB2 — a body row is labelled the way the 3-D legend names bodies: its NAME
//       when the engineer gave one, else "#<ordinal>".
// PB3 — a body the roster does not know keeps a stable id-prefix label, never a blank.
// PB4 — the pooled header states "pooled across N bodies" (the ruling's point:
//       the lumped view says it lumps).
// PB5 — the body-scoped header names the body: "<unit name> — body <label>".
// PB6 — a layer the resolver never stamped forms NO body row (it pools only in
//       the lumped view).
// PB7 — a pending layer is not ground; it joins no body row and no count.
// PB8 — body rows order by the roster's ordinal, unknown bodies after.
// PB9 — a body spanning TWO twin formation rows is ONE row, under its HOME
//       formation (the roster's ``formation_id``), counting ALL its layers —
//       the owner's "0-CPT silt" was one body rendered as two half-counted
//       rows under twin rows.
// PB10 — a body the roster lacks falls back to per-layer attribution (today's
//        grouping), never to a guessed home.
// PB11/PB12 — ``pooledBodyCount`` counts only bodies CONTRIBUTING to the pool
//        (accepted CPT bands on member holes): borehole-only bodies and
//        off-section CPYs add nothing to "pooled across N bodies".
// PB13/PB14 — ``bodyHomeUnitId``: a jump that resolved a body reports the
//        body's home formation; no body (or an unknown one) keeps the label.

import { describe, expect, it } from 'vitest'

import {
  bodyHomeUnitId,
  bodyLabelOf,
  bodyScopedHeaderLabel,
  pooledBodyCount,
  pooledHeaderLabel,
  unitBodyRows,
} from './parameterUnitBodies'

/** An accepted CPT band of ``unitId`` in ``bodyId``. */
function band(
  id: string,
  unitId: string,
  bodyId: string | null,
  cptId: string | null = 'c1',
  status = 'accepted',
) {
  return {
    id,
    formation_id: unitId,
    cpt_id: cptId,
    borehole_id: cptId === null ? 'bh-1' : null,
    depth_top_m: 0,
    depth_base_m: 1,
    status,
    body_id: bodyId,
  }
}

/** A body roster entry the way ``GET .../bodies`` reports one. */
function rosterEntry(name: string | null, ordinal: number) {
  return { name, body_ordinal: ordinal }
}

describe('unitBodyRows — the bodies a unit row lumps', () => {
  it('PB1 — groups the unit\'s accepted layers by body, with band + CPT counts', () => {
    const rows = unitBodyRows(
      [
        band('l1', 'u1', 'body-A', 'c1'),
        band('l2', 'u1', 'body-A', 'c2'),
        band('l3', 'u1', 'body-A', 'c2'),
        band('l4', 'u1', 'body-B', 'c3'),
        // A borehole band counts as a band of its body, never as a CPT.
        band('l5', 'u1', 'body-B', null),
        // Another unit's layer says nothing about this one.
        band('x1', 'u2', 'body-C', 'c9'),
      ],
      'u1',
      null,
    )
    expect(rows.map(r => ({ bodyId: r.bodyId, bandCount: r.bandCount, cptCount: r.cptCount }))).toEqual([
      { bodyId: 'body-A', bandCount: 3, cptCount: 2 },
      { bodyId: 'body-B', bandCount: 2, cptCount: 1 },
    ])
  })

  it('PB6 — a layer the resolver never stamped forms no body row', () => {
    const rows = unitBodyRows([band('l1', 'u1', null)], 'u1', null)
    expect(rows).toEqual([])
  })

  it('PB7 — a pending layer is not ground: no row, no count', () => {
    const rows = unitBodyRows([band('l1', 'u1', 'body-A', 'c1', 'pending')], 'u1', null)
    expect(rows).toEqual([])
    expect(pooledBodyCount([band('l1', 'u1', 'body-A', 'c1', 'pending')], 'u1', null)).toBe(0)
  })

  it('PB8 — rows order by the roster ordinal; bodies the roster does not know come after', () => {
    const roster = new Map([
      ['body-B', rosterEntry(null, 0)],
      ['body-A', rosterEntry(null, 3)],
    ])
    const rows = unitBodyRows(
      [band('l1', 'u1', 'body-A'), band('l2', 'u1', 'body-Z', 'c2'), band('l3', 'u1', 'body-B', 'c3')],
      'u1',
      roster,
    )
    expect(rows.map(r => r.bodyId)).toEqual(['body-B', 'body-A', 'body-Z'])
  })

  it('PB2 — labels come from the roster: the engineer\'s name wins, else the legend\'s #ordinal', () => {
    const roster = new Map([
      ['body-A', rosterEntry('  De diepe zandlens ', 2)],
      ['body-B', rosterEntry(null, 5)],
    ])
    expect(bodyLabelOf('body-A', roster)).toBe('De diepe zandlens')
    expect(bodyLabelOf('body-B', roster)).toBe('#5')
  })

  it('PB3 — a body the roster does not know keeps a stable id-prefix label', () => {
    expect(bodyLabelOf('0123456789abcdef', null)).toBe('01234567')
    expect(bodyLabelOf('0123456789abcdef', new Map())).toBe('01234567')
  })

  // The live shape (audit 2026-08-27): a resolver body spanning TWO duplicate
  // formation rows (same name/class/soil, different derived geo-label — 32 of
  // 175 bodies do) rendered as two rows with the same "#ordinal" label, each
  // scoping a FRACTION of the body. Worst case: body #0 read "1 band · 0 CPTs"
  // under one silt row and "7 bands · 4 CPTs" under its twin.
  it('PB9 — a body under twin rows is ONE row, under its HOME formation, with the FULL counts', () => {
    const roster = new Map([['body-X', { name: null, body_ordinal: 0, formation_id: 'u-twin-B' }]])
    const layers = [
      // The "1 band · 0 CPTs" twin: one borehole band labelled u-twin-A.
      band('l1', 'u-twin-A', 'body-X', null),
      // The "7 bands · 4 CPTs" twin, shortened to 2 bands on 2 CPTs.
      band('l2', 'u-twin-B', 'body-X', 'c1'),
      band('l3', 'u-twin-B', 'body-X', 'c2'),
    ]
    // The home row lists the body ONCE, counting ALL its accepted layers.
    expect(unitBodyRows(layers, 'u-twin-B', roster)).toEqual([
      expect.objectContaining({ bodyId: 'body-X', bandCount: 3, cptCount: 2 }),
    ])
    // The twin lists NOTHING for it — one body, one row.
    expect(unitBodyRows(layers, 'u-twin-A', roster)).toEqual([])
  })

  it('PB10 — a body the roster lacks keeps per-layer attribution (no guessed home)', () => {
    const roster = new Map<string, { name: string | null; body_ordinal: number }>()
    const layers = [
      band('l1', 'u-twin-A', 'body-X', 'c1'),
      band('l2', 'u-twin-B', 'body-X', 'c2'),
    ]
    expect(unitBodyRows(layers, 'u-twin-A', roster)).toEqual([
      expect.objectContaining({ bodyId: 'body-X', bandCount: 1 }),
    ])
    expect(unitBodyRows(layers, 'u-twin-B', roster)).toEqual([
      expect.objectContaining({ bodyId: 'body-X', bandCount: 1 }),
    ])
  })
})

describe('the honest header (owner ruling 2026-08-27)', () => {
  it('PB4 — the pooled view states "pooled across N bodies"', () => {
    expect(pooledHeaderLabel('SAND, medium dense', 10)).toBe(
      'SAND, medium dense — pooled across 10 bodies',
    )
    expect(pooledHeaderLabel('SAND, medium dense', 1)).toBe(
      'SAND, medium dense — pooled across 1 body',
    )
  })

  it('PB4b — with no stamped bodies there is nothing to pool across; the base label stands', () => {
    expect(pooledHeaderLabel('SAND, medium dense', 0)).toBe('SAND, medium dense')
  })

  it('PB5 — the body-scoped view names the one body', () => {
    const roster = new Map([['body-A', rosterEntry(null, 4)]])
    expect(bodyScopedHeaderLabel('SAND, medium dense', 'body-A', roster)).toBe(
      'SAND, medium dense — body #4',
    )
  })

  it('PB3b — pooledBodyCount counts DISTINCT stamped bodies among the pooled bands', () => {
    expect(
      pooledBodyCount(
        [
          band('l1', 'u1', 'body-A'),
          band('l2', 'u1', 'body-A', 'c2'),
          band('l3', 'u1', 'body-B', 'c3'),
          band('l4', 'u1', null, 'c4'),
        ],
        'u1',
        null,
      ),
    ).toBe(2)
  })

  // The header honesty half (audit 2026-08-27): "pooled across N bodies"
  // counted bodies contributing NOTHING to the pool — worst live case said 16
  // where only 9 contributed. N counts only bodies with at least one band the
  // pool actually reads: accepted, CPT-anchored, on a member hole.
  it('PB11 — a borehole-only body contributes nothing and is not counted', () => {
    expect(
      pooledBodyCount(
        [band('l1', 'u1', 'body-A', 'c1'), band('l2', 'u1', 'body-BH', null)],
        'u1',
        null,
      ),
    ).toBe(1)
  })

  it('PB12 — a body whose only CPT is off the member set is not counted', () => {
    expect(
      pooledBodyCount(
        [band('l1', 'u1', 'body-A', 'c1'), band('l2', 'u1', 'body-B', 'c-off')],
        'u1',
        new Set(['c1']),
      ),
    ).toBe(1)
  })
})

// F10 — the fill-region jump's unit authority: when a body resolved, the
// reported unit is the BODY's home formation (the same roster the pane groups
// by), never the region label; with no body (or an unknown one) the label
// stands.
describe('bodyHomeUnitId — the jump authority (welded-across-twins)', () => {
  it('PB13 — a resolved body reports its HOME formation, not the region label', () => {
    const roster = new Map([['body-X', { name: null, body_ordinal: 0, formation_id: 'u-twin-B' }]])
    expect(bodyHomeUnitId('u-twin-A', 'body-X', roster)).toBe('u-twin-B')
  })

  it('PB14 — no body, or a body the roster lacks, keeps the label', () => {
    const roster = new Map([['body-X', { name: null, body_ordinal: 0, formation_id: 'u2' }]])
    expect(bodyHomeUnitId('u1', null, roster)).toBe('u1')
    expect(bodyHomeUnitId('u1', 'body-unknown', roster)).toBe('u1')
    expect(bodyHomeUnitId('u1', 'body-X', null)).toBe('u1')
  })
})
