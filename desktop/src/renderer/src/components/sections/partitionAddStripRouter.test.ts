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
  pointInPolygon,
  projectClickToCandidate,
  routeAddStripByContainment,
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

describe('partitionAddStripRouter — region-containment pick (S71)', () => {
  // The nearest-SEGMENT metric fails when a distant lens's long diagonal flank
  // passes nearer in perpendicular distance than the band the owner clicked ON
  // (owner dogfeed 2026-07-22). Containment is robust: grab the region under the
  // cursor. These cases pin the invariant in isolation.
  it('C1 — point-in-polygon: inside a rectangle', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(pointInPolygon({ x: 5, y: 5 }, rect)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, rect)).toBe(false)
    expect(pointInPolygon({ x: 5, y: 15 }, rect)).toBe(false)
  })

  it('C2 — a click INSIDE the sand region grabs sand, even though a diagonal lens edge passes NEARER', () => {
    // The exact owner failure the nearest-segment metric could not solve: the
    // click is inside the SAND band (a wide low region). A DISTANT silt lens above
    // has a long diagonal LOWER edge that sweeps down THROUGH a point only 2px from
    // the click — so nearest-segment would grab the silt lens. Containment grabs
    // the region the click is actually inside (sand).
    const click = { x: 50, y: 60 }
    const sand: AddStripCandidate<string> = {
      // Sand's region ring contains (50,60); its base edge is far below the click.
      regionPolygon: [
        { x: 20, y: 50 },
        { x: 80, y: 50 },
        { x: 80, y: 90 },
        { x: 20, y: 90 },
      ],
      segments: [[{ x: 20, y: 90 }, { x: 80, y: 90 }]], // sand base edge ~30px below click
      dispatch: 'sand',
    }
    const siltLensAbove: AddStripCandidate<string> = {
      // A long diagonal lens edge that dips through (48,58) — 2px from the click —
      // yet the click is NOT inside the lens's (thin, high) region.
      regionPolygon: [
        { x: 20, y: 30 },
        { x: 80, y: 30 },
        { x: 20, y: 40 },
      ],
      segments: [[{ x: 20, y: 30 }, { x: 80, y: 62 }]], // diagonal passing ~2px from click
      dispatch: 'silt-lens',
    }
    // Nearest-segment (the OLD metric) would grab the silt lens (2px vs 30px):
    expect(routeNearestAddStrip(click, [sand, siltLensAbove])).toBe('silt-lens')
    // Containment (the invariant) grabs sand — the region under the cursor:
    expect(routeAddStripByContainment(click, [sand, siltLensAbove])).toBe('sand')
  })

  it('C3 — click outside every region falls back to nearest-segment', () => {
    const click = { x: 50, y: 5 }
    const a: AddStripCandidate<string> = {
      regionPolygon: [
        { x: 20, y: 50 },
        { x: 80, y: 50 },
        { x: 80, y: 90 },
        { x: 20, y: 90 },
      ],
      segments: [[{ x: 20, y: 8 }, { x: 80, y: 8 }]], // 3px from the click, outside the region
      dispatch: 'a',
    }
    const b: AddStripCandidate<string> = {
      regionPolygon: [
        { x: 20, y: 90 },
        { x: 80, y: 90 },
        { x: 80, y: 99 },
        { x: 20, y: 99 },
      ],
      segments: [[{ x: 20, y: 40 }, { x: 80, y: 40 }]], // 35px from the click
      dispatch: 'b',
    }
    // Neither region contains (50,5) → nearest-segment wins → 'a'.
    expect(routeAddStripByContainment(click, [a, b])).toBe('a')
  })

  it('C4 — a shared contact click (inside BOTH incident bands) resolves to the nearer edge', () => {
    const click = { x: 50, y: 50 }
    const upper: AddStripCandidate<string> = {
      regionPolygon: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 52 },
        { x: 20, y: 52 },
      ], // contains the click; its base edge (y=52) is 2px below
      segments: [[{ x: 20, y: 52 }, { x: 80, y: 52 }]],
      dispatch: 'upper',
    }
    const lower: AddStripCandidate<string> = {
      regionPolygon: [
        { x: 20, y: 40 },
        { x: 80, y: 40 },
        { x: 80, y: 90 },
        { x: 20, y: 90 },
      ], // ALSO contains the click; its top edge (y=40) is 10px above
      segments: [[{ x: 20, y: 40 }, { x: 80, y: 40 }]],
      dispatch: 'lower',
    }
    // Both contain the click; the nearer edge (upper base, 2px) wins.
    expect(routeAddStripByContainment(click, [upper, lower])).toBe('upper')
  })

  it('C5 — empty list routes to null', () => {
    expect(routeAddStripByContainment({ x: 0, y: 0 }, [])).toBeNull()
  })
})

// ===========================================================================
// S72 — a new node must sit ON its target boundary, never float in the region
// interior. S71's containment router grabs the right BODY even for a click deep
// in the interior, but the click's raw y was stored verbatim → three floating
// blue dots in the gap interior (owner dogfeed 2026-07-22, GEO-23/125-S10 —
// "i managed to get a point without grabbing a boundary"). The node's y must be
// PROJECTED onto the candidate's nearest edge at the click's x.
// ===========================================================================
describe('partitionAddStripRouter — project click onto the target boundary (S72)', () => {
  it('P1 — a click in the region interior projects onto the candidate edge at the click x', () => {
    // Sand band: base edge is the horizontal line y=90 from x20→x80. The click is
    // deep in the interior at (50, 60). The stored node must land ON the base edge
    // (y=90) at x=50 — NOT float at the raw cursor y=60.
    const sand: AddStripCandidate<string> = {
      regionPolygon: [
        { x: 20, y: 50 },
        { x: 80, y: 50 },
        { x: 80, y: 90 },
        { x: 20, y: 90 },
      ],
      segments: [[{ x: 20, y: 90 }, { x: 80, y: 90 }]],
      dispatch: 'sand',
    }
    const projected = projectClickToCandidate({ x: 50, y: 60 }, sand)
    expect(projected).not.toBeNull()
    expect(projected!.x).toBeCloseTo(50, 3)
    expect(projected!.y).toBeCloseTo(90, 3) // ON the base edge, not the interior y=60
  })

  it('P2 — a click near a sloping edge projects onto that sloping edge (rides the boundary line)', () => {
    // A dipping contact from (20,40) to (80,70). A click at (50, 62) projects to the
    // point on the line at x=50 → y=55 (mid-slope), NEVER the raw cursor y=62.
    const cand: AddStripCandidate<string> = {
      segments: [[{ x: 20, y: 40 }, { x: 80, y: 70 }]],
      dispatch: 'contact',
    }
    const projected = projectClickToCandidate({ x: 50, y: 62 }, cand)
    expect(projected).not.toBeNull()
    expect(projected!.x).toBeCloseTo(50, 3)
    expect(projected!.y).toBeCloseTo(55, 3)
  })

  it('P3 — the projected point lies ON one of the candidate segments (distance ≈ 0)', () => {
    // Invariant form: whatever the click, the projection is on the strip. A lens
    // with two edges — project onto whichever is nearer, distance-to-edge ≈ 0.
    const lens: AddStripCandidate<string> = {
      segments: [
        [{ x: 20, y: 40 }, { x: 50, y: 55 }], // upper edge
        [{ x: 20, y: 70 }, { x: 50, y: 55 }], // lower edge
      ],
      dispatch: 'lens',
    }
    const projected = projectClickToCandidate({ x: 35, y: 48 }, lens)
    expect(projected).not.toBeNull()
    const d = Math.min(
      candidateDistSq(projected!, { segments: [lens.segments[0]], dispatch: 'x' }),
      candidateDistSq(projected!, { segments: [lens.segments[1]], dispatch: 'x' }),
    )
    expect(d).toBeLessThan(1e-6) // exactly on an edge
  })

  it('P4 — a candidate with no segments projects to null', () => {
    expect(projectClickToCandidate({ x: 0, y: 0 }, { segments: [], dispatch: 'x' })).toBeNull()
  })
})
