// Owner, on a fresh screenshot (dogfeed 2026-08-15): "fill tone still seems a
// bit off?" — the column cards still do not read as the same paint as the gap
// fill beside them, most visibly on his shallow ("undeep") columns.
//
// Measured on the real project (all 14 sections, either side of every card
// edge): no pixel is painted twice and no two coats differ in opacity, so it is
// not the veil arithmetic. What IS still there is the seam stroke: the fill
// paints THROUGH the cards now, but the stroke pass was never told — its own
// docstring still counts the column strip as "unfilled space", which was true
// before the strips existed. So every gap region draws a self-colour 0.75 px
// stroke down its card edge, and a self-colour stroke over its own translucent
// fill composites darker (0.62 over 0.62). The result is a darker rim on the
// gap side of every card edge, which is exactly "one soil body, two tones".
//
//   SSE1  a gap region whose card edge is covered by the SAME soil's card strip
//         draws no stroke there — the seam is interior to one merged body
//   SSE2  a different soil's card strip is a real boundary: the stroke stays
//   SSE3  the card strips classify only; they are never returned as strokes

import { describe, expect, it } from 'vitest'

import { computeSectionSeamStrokes } from './sectionSeamStrokeElements'

/** Card spans x 30..70; the gap to its right spans x 70..170. */
const cardRect = (formationId: string) => ({
  formationId,
  points: [
    { x: 30, y: 0 },
    { x: 70, y: 0 },
    { x: 70, y: 50 },
    { x: 30, y: 50 },
  ],
})
const gapRect = (formationId: string) => ({
  formationId,
  points: [
    { x: 70, y: 0 },
    { x: 170, y: 0 },
    { x: 170, y: 50 },
    { x: 70, y: 50 },
  ],
})

/** The edge running down the card's right-hand boundary, as the pass writes it. */
const CARD_EDGE = 'M 70.00,50.00 L 70.00,0.00'

describe('computeSectionSeamStrokes', () => {
  it('SSE1 — the card edge carries no stroke when the card holds the same soil', () => {
    const { regions } = computeSectionSeamStrokes([], [gapRect('fSand')], [cardRect('fSand')])
    expect(regions).toHaveLength(1)
    expect(regions[0]).not.toContain(CARD_EDGE)
    // The gap region's other three edges still border unfilled space.
    expect(regions[0]).toContain('M 170.00,0.00 L 170.00,50.00')
  })

  it('SSE2 — a different soil on the card is a real boundary; the stroke stays', () => {
    const { regions } = computeSectionSeamStrokes([], [gapRect('fSand')], [cardRect('fClay')])
    expect(regions[0]).toContain(CARD_EDGE)
  })

  it('SSE3 — card strips classify only and are never returned as strokes', () => {
    const { undercol, regions } = computeSectionSeamStrokes(
      [cardRect('fSand')],
      [gapRect('fSand'), gapRect('fClay')],
      [cardRect('fSand'), cardRect('fClay')],
    )
    expect(undercol).toHaveLength(1)
    expect(regions).toHaveLength(2)
  })
})
