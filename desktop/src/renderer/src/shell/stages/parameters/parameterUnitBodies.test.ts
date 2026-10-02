// Pins for the surviving body helpers (owner ruling 2026-08-27, verbatim: "a
// body is only a body if it is geometrically connected or if the users says,
// this body is the same as that body").
//
// Row building and header composition moved to ``parameterBodyTree`` /
// ``parameterScopeHeader`` in the body-tree rework (their pins live there);
// what remains here is the label + the jump authority.
//
// PB2 — a body is labelled the way the 3-D legend names bodies: its NAME when
//       the engineer gave one, else "#<ordinal>".
// PB3 — a body the roster does not know reads a loading word — never an id
//       prefix (owner 2026-10-02), never a blank.
// PB13/PB14 — ``bodyHomeUnitId``: a jump that resolved a body reports the
//        body's home formation; no body (or an unknown one) keeps the label.

import { describe, expect, it } from 'vitest'

import { bodyHomeUnitId, bodyLabelOf } from './parameterUnitBodies'

/** A body roster entry the way ``GET .../bodies`` reports one. */
function rosterEntry(name: string | null, ordinal: number) {
  return { name, body_ordinal: ordinal }
}

describe('bodyLabelOf — the legend-consistent body label', () => {
  it("PB2 — the engineer's name wins, else the legend's #ordinal", () => {
    const roster = new Map([
      ['body-A', rosterEntry('  De diepe zandlens ', 2)],
      ['body-B', rosterEntry(null, 5)],
    ])
    expect(bodyLabelOf('body-A', roster)).toBe('De diepe zandlens')
    expect(bodyLabelOf('body-B', roster)).toBe('#5')
  })

  // Owner finding 2026-10-02 REVERSES the old id-prefix fallback: "id-like
  // names (a84343518…) in the tree for a moment before they changed to real
  // names". A body the roster does not know yet reads a loading word, never
  // an id and never a blank.
  it('PB3 — a body the roster does not know reads a loading word, never an id prefix', () => {
    for (const roster of [null, new Map()]) {
      const label = bodyLabelOf('0123456789abcdef', roster)
      expect(label).not.toContain('01234567')
      expect(label).toBe('Loading…')
    }
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
