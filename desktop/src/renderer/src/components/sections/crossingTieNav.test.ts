/**
 * Cycling through crossing-tie conflicts from the warning chip.
 *
 * Owner ask 2026-08-23: *"I also get two crossing correlations ties, make that
 * clickable so it zooms to the first one, and then when it is resolved it takes
 * the second one."*
 *
 * The chip has been passive since it shipped (``pointerEvents: 'none'``), so
 * the count was visible but the conflicts were not findable — on a wide section
 * a crossing can sit far outside the viewport.
 */
import { describe, expect, it } from 'vitest'

import { nextConflictIndex } from './crossingTieNav'

describe('nextConflictIndex', () => {
  it('CN1 — the first press goes to the FIRST conflict', () => {
    expect(nextConflictIndex(null, 2)).toBe(0)
  })

  it('CN2 — each further press advances', () => {
    expect(nextConflictIndex(0, 3)).toBe(1)
    expect(nextConflictIndex(1, 3)).toBe(2)
  })

  it('CN3 — past the last one it wraps, so the chip never dead-ends', () => {
    expect(nextConflictIndex(2, 3)).toBe(0)
  })

  it('CN4 — resolving one keeps the press meaningful (the list shrank under us)', () => {
    // Two conflicts, engineer visited #1 (index 1), then deleted a tie so only
    // one remains. The stale index is past the end; the next press must land on
    // a conflict that EXISTS rather than throwing or pointing at nothing.
    expect(nextConflictIndex(1, 1)).toBe(0)
    expect(nextConflictIndex(5, 2)).toBe(0)
  })

  it('CN5 — nothing to visit when the last conflict is resolved', () => {
    expect(nextConflictIndex(null, 0)).toBeNull()
    expect(nextConflictIndex(0, 0)).toBeNull()
  })

  it('CN6 — a single conflict re-visits itself rather than going blank', () => {
    // Pressing again when there is one left should re-centre it: the engineer
    // may have panned away since.
    expect(nextConflictIndex(0, 1)).toBe(0)
  })
})
