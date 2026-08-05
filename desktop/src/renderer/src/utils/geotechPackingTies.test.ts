/**
 * The packing-tie counter, read in the owner's words.
 *
 * ``makePackingTieCounter`` is the whole of the 2/1/0 bookkeeping the geotech
 * gap fill runs on — "correlate by hand between CPTs, so we can reuse the
 * litho's 2/1/0 ruling" (owner, 2026-08-04 evening). Until this file it was
 * only ever exercised THROUGH ``refineLithoPartition``, where a miscount and a
 * geometry bug look identical from the outside. Review finding (2026-08-05):
 * the counter deserves its own gate, in particular the two paths the geometry
 * suite never reaches — the bottom-tie (``base``/``base``) and the deliberate
 * silence on a mixed top↔base edge.
 *
 * Each case names the rule it reads, not the variable it touches.
 */

import { describe, expect, it } from 'vitest'

import type { CorrelationEdge } from './partitionFill'
import { makePackingTieCounter, type PackingSpanTieKeys } from './geotechPackingTies'

/** A span's three tie keys: its own top, its own base, and the layer beneath it. */
function span(
  topLayerId: string,
  baseLayerId: string,
  belowLayerId: string | null,
): PackingSpanTieKeys {
  return { topLayerId, baseLayerId, belowLayerId }
}

/** The left column's mid-stack span: top A1, base A1, and A2 beneath it. */
const A_MID = span('A1', 'A1', 'A2')
/** The right column's mid-stack span, same shape. */
const B_MID = span('B1', 'B1', 'B2')
/** The left column's DEEPEST span — nothing below it to key a base contact. */
const A_DEEP = span('A2', 'A2', null)
/** The right column's deepest span. */
const B_DEEP = span('B2', 'B2', null)

const top = (a: string, b: string): CorrelationEdge => ({ a, b, aSide: 'top', bSide: 'top' })
const base = (a: string, b: string): CorrelationEdge => ({ a, b, aSide: 'base', bSide: 'base' })

describe('makePackingTieCounter — how many of two spans’ bounding contacts are correlated', () => {
  it('no edges at all → neither contact is correlated', () => {
    expect(makePackingTieCounter([])(A_MID, B_MID)).toBe(0)
  })

  it('the two spans’ own tops tied → one contact (the top)', () => {
    // A top-keyed edge between the spans' own topmost layer ids IS their
    // shared top contact. On its own that is litho's ONE — which the caller
    // treats as none (the deferred onlap), so the count must not read 2.
    expect(makePackingTieCounter([top('A1', 'B1')])(A_MID, B_MID)).toBe(1)
  })

  it('the layers BELOW each span tied → one contact (the base)', () => {
    // A layer id keys the contact at its TOP, so the layer immediately below a
    // span owns that span's BASE contact. Tying A2↔B2 therefore says "these two
    // spans end at the same surface" — nothing about where they start.
    expect(makePackingTieCounter([top('A2', 'B2')])(A_MID, B_MID)).toBe(1)
  })

  it('both bounding contacts tied → two, which is the only outcome that bands', () => {
    const counter = makePackingTieCounter([top('A1', 'B1'), top('A2', 'B2')])
    expect(counter(A_MID, B_MID)).toBe(2)
  })

  it('a bottom tie on the spans themselves supplies the base contact', () => {
    // The deepest layer of a column has NO layer below it, so its base contact
    // can only be stated directly: a base↔base edge on the two spans' own
    // deepest layer ids. Without this path a column's deepest packing span
    // could never reach 2 and could never band.
    const counter = makePackingTieCounter([top('A2', 'B2'), base('A2', 'B2')])
    expect(counter(A_DEEP, B_DEEP)).toBe(2)
  })

  it('a bottom tie alone is one contact, not two', () => {
    // The base↔base edge answers the base only. The deepest spans' own tops
    // are keyed by A2/B2 as well, but through the TOP set — which this edge
    // does not populate, precisely so one gesture cannot count twice.
    expect(makePackingTieCounter([base('A2', 'B2')])(A_DEEP, B_DEEP)).toBe(1)
  })

  it('a mixed top↔base edge counts for NEITHER contact', () => {
    // Litho's mixed tie declares "this unit continues to the tied contact" —
    // a shape with no counterpart in fraction space. Counting it as a top
    // contact would let a base tie make a top look correlated, which is the
    // one thing the three separate edge sets exist to prevent.
    const mixed: CorrelationEdge[] = [
      { a: 'A1', b: 'B1', aSide: 'top', bSide: 'base' },
      { a: 'A2', b: 'B2', aSide: 'base', bSide: 'top' },
    ]
    expect(makePackingTieCounter(mixed)(A_MID, B_MID)).toBe(0)
  })

  it('an edge with no side recorded is read as a TOP tie', () => {
    // Older rows predate the side column. A contact is keyed at its top by
    // definition, so the absent side means top — not "unknown, ignore it",
    // which would silently drop an engineer's accepted correlation.
    const legacy: CorrelationEdge[] = [{ a: 'A1', b: 'B1' }]
    expect(makePackingTieCounter(legacy)(A_MID, B_MID)).toBe(1)
  })

  it('the tie is read in either direction — a↔b or b↔a is the same correlation', () => {
    const counter = makePackingTieCounter([top('B1', 'A1'), top('B2', 'A2')])
    expect(counter(A_MID, B_MID)).toBe(2)
  })

  it('a tie to some THIRD span does not count for this pair', () => {
    // The pair-specific reading is the whole point of this module (review F4):
    // "is A tied to anything" is a different, weaker question than "are A and
    // B tied to each other", and answering the first would band spans the
    // engineer never put beside one another.
    const counter = makePackingTieCounter([top('A1', 'C1'), top('A2', 'C2')])
    expect(counter(A_MID, B_MID)).toBe(0)
  })

  it('a span at the bottom of its column cannot borrow the other side’s below-layer', () => {
    // One side has a layer below, the other does not. There is no base contact
    // they share, so the count may not reach 2 off the top tie plus a
    // half-present base.
    const counter = makePackingTieCounter([top('A1', 'B1'), top('A2', 'B2')])
    expect(counter(span('A1', 'A1', 'A2'), span('B1', 'B1', null))).toBe(1)
  })
})
