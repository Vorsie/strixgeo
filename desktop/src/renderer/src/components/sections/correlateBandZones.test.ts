/**
 * Correlate-mode band zones — "the boundary line always wins".
 *
 * Two owner mis-click dogfeeds pull the thin-band click in opposite
 * directions, and this rule is the reconciliation:
 *  - 2026-08-04/05 (debt #158): aiming at a ~10 px band's TOP line but
 *    striking its lower half armed the boundary BELOW — one band low, twice
 *    in a week. So a thin band's INTERIOR arms its own top.
 *  - 2026-08-07: "I click the bottom of a clay unit but the correlation drew
 *    from the top." So clicking ON (within a few px of) the BASE line must
 *    arm the base — the whole-band-arms-top rule had erased base-targeting
 *    on every band under 28 px.
 *
 * The rule: a click right at a boundary LINE arms that boundary; a click in
 * the band interior arms the band's own top (thin bands) or nothing (the
 * inert middle of tall bands). Zones are expressed as two cut y's:
 * [top, topEnd) arms the top contact, [botStart, bot] arms the boundary
 * below (or the unit BASE on the deepest band), and any space between is
 * inert.
 */

import { describe, expect, it } from 'vitest'

import {
  BASE_LINE_GRAB_PX,
  CONTACT_SELECT_NEAR_PX,
  correlateBandZones,
} from './correlationEdgesHelpers'

describe('correlateBandZones', () => {
  it('CZ1 — a tall band keeps its near-boundary zones and inert middle', () => {
    // height 60 ≥ 2×NEAR: click near a boundary arms it, mid-band is inert.
    const z = correlateBandZones(100, 160, true)
    expect(z.topEnd).toBe(100 + CONTACT_SELECT_NEAR_PX)
    expect(z.botStart).toBe(160 - CONTACT_SELECT_NEAR_PX)
    expect(z.botStart).toBeGreaterThan(z.topEnd) // the inert gap exists
  })

  it('CZ2 — a thin band interior arms its own top (the 2026-08-05 protection)', () => {
    // A 10 px band: striking a few px below the aimed-at top line still lands
    // in the top zone — the mis-click that armed "one band low" cannot recur
    // from an interior strike.
    const z = correlateBandZones(100, 110, true)
    expect(z.topEnd).toBeGreaterThanOrEqual(105) // at least the upper half
    expect(z.topEnd).toBe(z.botStart) // no inert gap on a thin band
  })

  it('CZ3 — clicking the bottom of a thin band arms the base, not the top', () => {
    // The 2026-08-07 complaint: a 20 px clay band's base line must be
    // targetable. The bottom BASE_LINE_GRAB_PX arms the boundary below.
    const z = correlateBandZones(100, 120, true)
    expect(z.botStart).toBe(120 - BASE_LINE_GRAB_PX)
    expect(z.topEnd).toBe(z.botStart) // interior above the grab arms the top
  })

  it('CZ4 — a thin DEEPEST band keeps its generous midpoint split for the base tie', () => {
    // No deeper band exists, so the base tie has no twin target below —
    // the lower HALF stays the base zone (CE-THIN-DEEPEST precedent).
    const z = correlateBandZones(100, 110, false)
    expect(z.topEnd).toBe(105)
    expect(z.botStart).toBe(105)
  })

  it('CZ5 — a sub-8px band never gives the base more than half its height', () => {
    // Degenerate thin band: the base grab shrinks so the top zone keeps at
    // least half — an interior strike still means the band, not its base.
    const z = correlateBandZones(100, 106, true)
    expect(z.botStart).toBe(103)
    expect(z.topEnd).toBe(103)
  })
})
