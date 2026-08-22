/**
 * Owner dogfeed, 2026-08-22 (the greener silt quad left of
 * 1411-GEO-23/126-B3, real CS1 gap 11): a one-sided gap — one whose two
 * frame columns are not bracketed by any run of this family's banded tests
 * — used to let EVERY banded column of the family, anywhere in the section,
 * both draw its own levels as horizontals across the gap and answer its
 * ground. On his model that handed a 16 cm sliver at +11.73..+11.89 to
 * GEO-23/125-S7's SILT·MF band standing **144 m away**, purely because
 * ``pickDominant``'s top-priority ``ownsLevel`` rank (correct, and
 * deliberately above distance) found no NEARER band whose own window
 * contained that elevation — B3's own silt stops at +11.98 and
 * GEO-23/125-S9's starts at +11.73.
 *
 * Only the nearest carrying test on each side speaks for the ground beside
 * it. This module is that selection, alone.
 */
import { describe, expect, it } from 'vitest'

import { nearestFamilyColumns } from './nearestFamilyColumns'
import type { RunColumn } from './constructs'

const col = (ci: number): RunColumn => ({ ci, x: ci * 10, bands: [] })

/** Just the ci values, in the order returned. */
const cis = (out: readonly RunColumn[]): number[] => out.map((c) => c.ci)

describe('nearestFamilyColumns', () => {
  it('NF1 — the family lies entirely RIGHT of the gap: only its nearest column answers', () => {
    // The real CS1 shape: gap 11 (frame columns 11|12), the silt family
    // banded at ci 12, 13 and 18. B3 (ci 12) is the gap's own right flank;
    // GEO-23/125-S7 (ci 18) is 144 m away and must not speak here.
    expect(cis(nearestFamilyColumns([col(12), col(13), col(18)], 11))).toEqual([12])
  })

  it('NF2 — the family lies entirely LEFT of the gap: only its nearest column answers', () => {
    expect(cis(nearestFamilyColumns([col(3), col(7)], 11))).toEqual([7])
  })

  it('NF3 — columns on both sides: the nearest on EACH side, left first', () => {
    expect(cis(nearestFamilyColumns([col(2), col(4), col(7), col(9)], 5))).toEqual([4, 7])
  })

  it('NF4 — a column sitting exactly ON the gap edges is that side flank', () => {
    // ci === gapIndex is the left frame column; ci === gapIndex + 1 the right.
    expect(cis(nearestFamilyColumns([col(5), col(6)], 5))).toEqual([5, 6])
  })

  it('NF5 — no columns at all: nothing answers', () => {
    expect(cis(nearestFamilyColumns([], 5))).toEqual([])
  })

  it('NF6 — input order does not matter; nearest still wins on each side', () => {
    expect(cis(nearestFamilyColumns([col(18), col(13), col(12)], 11))).toEqual([12])
  })
})
