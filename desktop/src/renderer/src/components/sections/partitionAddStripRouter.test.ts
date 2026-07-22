// Unit tests for the global nearest-boundary add-strip router (S70).
//
// The owner's rule, in isolation: a click on the sand/silt interface must grab
// THAT interface, not whichever overlapping strip is painted on top. The router
// picks the candidate whose segment is physically nearest the cursor across ALL
// bodies, so paint order (list order) no longer decides the winner.
//
//   R1 the nearest candidate wins even when a farther one comes LATER in the list
//      (the z-order-beats-nearest bug: a distant lens painted last must NOT win).
//   R2 a multi-segment candidate reports the min distance to ANY of its segments.
//   R3 an empty candidate list routes to null (no crash).
//   R4 GEO-10/170-S7 gap5 repro: click at the u3/u4 interface (~el 4.7) grabs the
//      interface, NOT the silt lens ~1 m above it.

import { describe, expect, it } from 'vitest'

import {
  candidateDistSq,
  routeNearestAddStrip,
  type AddStripCandidate,
} from './partitionAddStripRouter'

describe('partitionAddStripRouter — global nearest-boundary pick (S70)', () => {
  it('R1 — the nearest candidate wins even when a farther one is LATER in the list', () => {
    // The click is at (50, 53). Candidate A (a boundary) passes 3px away; candidate
    // B (a distant lens) passes 20px away but is LAST in the list. Old behaviour:
    // z-order (last painted) → B wins. New behaviour: nearest → A wins.
    const near: AddStripCandidate<string> = {
      segments: [[{ x: 20, y: 50 }, { x: 80, y: 56 }]],
      dispatch: 'boundary:sand-silt',
    }
    const farButLast: AddStripCandidate<string> = {
      segments: [[{ x: 20, y: 33 }, { x: 80, y: 33 }]],
      dispatch: 'lens:silt-above',
    }
    const winner = routeNearestAddStrip({ x: 50, y: 53 }, [near, farButLast])
    expect(winner).toBe('boundary:sand-silt')
  })

  it('R2 — a multi-segment candidate reports the MIN distance to any segment', () => {
    // The candidate has two segments; the click is far from the first but near the
    // second. The candidate's distance must be the near one.
    const cand: AddStripCandidate<string> = {
      segments: [
        [{ x: 0, y: 0 }, { x: 10, y: 0 }], // far from (50,53)
        [{ x: 48, y: 53 }, { x: 60, y: 53 }], // 2px away
      ],
      dispatch: 'lens:multi',
    }
    // Nearest point on the second segment is (50,53) itself → distance 0.
    expect(candidateDistSq({ x: 50, y: 53 }, cand)).toBeLessThan(1)
  })

  it('R3 — an empty candidate list routes to null', () => {
    expect(routeNearestAddStrip({ x: 0, y: 0 }, [])).toBeNull()
  })

  it('R4 — gap5 repro: a click at the u3/u4 interface grabs the interface, not the silt lens above', () => {
    // GEO-10/170-S7 gap5, mapped to screen (y = 100 - elev*10):
    //   u2 SILT base 5.79 → y≈42.1  (the lens ABOVE the owner grabbed)
    //   u3/u4 interface at 5.19 → y≈48.1  (the sand/silt interface the owner aimed at)
    // The owner clicked ~el 4.7 → y≈53. Both strips sweep across the gap; the
    // interface strip passes ~5px below the click, the u2-base lens strip ~11px above.
    const interfaceStrip: AddStripCandidate<string> = {
      segments: [[{ x: 20, y: 48.1 }, { x: 80, y: 48.1 }]],
      dispatch: 'contact:u3|u4',
    }
    const siltLensAbove: AddStripCandidate<string> = {
      // The u2 lens LOWER edge (its base at 5.79 → y≈42.1) — painted after the
      // interface strip, so z-order would have grabbed it.
      segments: [[{ x: 20, y: 42.1 }, { x: 80, y: 42.1 }]],
      dispatch: 'lens:u2-silt',
    }
    // List order puts the lens LAST (as it paints last) — nearest must still win.
    const winner = routeNearestAddStrip({ x: 50, y: 53 }, [interfaceStrip, siltLensAbove])
    expect(winner).toBe('contact:u3|u4')
  })
})
