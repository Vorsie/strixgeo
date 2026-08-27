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

import { describe, expect, it } from 'vitest'

import {
  bodyLabelOf,
  bodyScopedHeaderLabel,
  pooledHeaderLabel,
  unitBodyCount,
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
    expect(unitBodyCount([band('l1', 'u1', 'body-A', 'c1', 'pending')], 'u1')).toBe(0)
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

  it('PB3b — unitBodyCount counts DISTINCT stamped bodies among the accepted layers', () => {
    expect(
      unitBodyCount(
        [
          band('l1', 'u1', 'body-A'),
          band('l2', 'u1', 'body-A', 'c2'),
          band('l3', 'u1', 'body-B', 'c3'),
          band('l4', 'u1', null, 'c4'),
        ],
        'u1',
      ),
    ).toBe(2)
  })
})
