// Where the camera goes when something asks the section to reveal a tie.
//
// The caller (the geotech pending-tie chip) names INVESTIGATIONS. This is the
// step that turns them into a screen position, and it runs on the panel's OWN
// column list — the rule that a position or an index must never cross a surface
// boundary, which cost a real bug on the crossing chip when a gap index taken
// from the litho frame's column list was applied to the geotech axis.
//
//   RC1  both columns drawn → centre on the midpoint BETWEEN them
//   RC2  the midpoint is between the RENDERED positions, not the true ones
//   RC3  one column missing → no centre at all, and it is named
//   RC4  both missing → both are named, in the order asked
//   RC5  a single investigation centres on that column
//   RC6  an empty ask centres nothing rather than on NaN

import { describe, expect, it } from 'vitest'

import { resolveColumnReveal } from './resolveColumnReveal'

const COLUMNS = [
  { id: 'cpt-s4', nudgedX: 120 },
  { id: 'cpt-s9', nudgedX: 400 },
  { id: 'bh-b6', nudgedX: 260 },
]

describe('resolveColumnReveal', () => {
  it('RC1: with both ends drawn it centres between them', () => {
    expect(resolveColumnReveal(['cpt-s4', 'cpt-s9'], COLUMNS)).toEqual({
      centreX: 260,
      missingInvestigationIds: [],
    })
  })

  it('RC2: it reads the RENDERED x, so packing and nudging are respected', () => {
    // Same two investigations, columns packed hard left: the centre has to
    // follow where they are DRAWN. Centring on their true along-distance would
    // put the camera where nothing is at column_spacing < 1.
    const packed = [
      { id: 'cpt-s4', nudgedX: 20 },
      { id: 'cpt-s9', nudgedX: 44 },
    ]
    expect(resolveColumnReveal(['cpt-s4', 'cpt-s9'], packed).centreX).toBe(32)
  })

  it('RC3: a missing column means no centring, and it is named', () => {
    // Half-revealing is worse than not revealing: panning to the one end that
    // IS drawn tells the engineer the tie is there when it is not.
    expect(resolveColumnReveal(['cpt-s4', 'bh-gone'], COLUMNS)).toEqual({
      centreX: null,
      missingInvestigationIds: ['bh-gone'],
    })
  })

  it('RC4: both missing → both named, in the order asked', () => {
    expect(
      resolveColumnReveal(['bh-gone', 'cpt-also-gone'], COLUMNS).missingInvestigationIds,
    ).toEqual(['bh-gone', 'cpt-also-gone'])
  })

  it('RC5: one investigation centres on that column', () => {
    expect(resolveColumnReveal(['bh-b6'], COLUMNS).centreX).toBe(260)
  })

  it('RC6: asking for nothing centres nothing — never NaN', () => {
    expect(resolveColumnReveal([], COLUMNS)).toEqual({
      centreX: null,
      missingInvestigationIds: [],
    })
  })
})
