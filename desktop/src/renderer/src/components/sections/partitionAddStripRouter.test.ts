// Unit tests for the edge-only add-strip router (S99).
//
// The owner's model (dogfeed 2026-07-24): ONLY the visible line between two litho
// fills is grabbable. A click ON a litho-transition edge grabs THAT edge; a click
// in the open band INTERIOR (farther than the hit tolerance from every edge) is a
// NO-OP — no grab, no node. The earlier region-containment grab (S71) is RETIRED:
// clicking anywhere inside a band interior used to route to that band's edge and
// drop a node ("i can click in the middle of a band"). Edge-proximity replaces it.
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
  routeAddStripByEdgeProximity,
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

describe('partitionAddStripRouter — edge-only pick (S99)', () => {
  // Only the visible litho line is grabbable. A click ON an edge (within the hit
  // tolerance) grabs THAT edge; a click in open band interior (farther than the
  // tolerance from EVERY edge) is a NO-OP. The tolerance below (49 = 7²) mirrors
  // the caller's ``(ADDSTRIP_HIT_W / 2)²`` = the half-width of the hit strip in px.
  const TOL_SQ = 49 // (7px)²

  it('E0 — point-in-polygon: inside a rectangle (retained for barrier no-op)', () => {
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

  it('E1 — a click ON a litho edge (within tolerance) grabs THAT edge', () => {
    // The click sits 2px above the sand/clay contact line y=50 → within 7px tol.
    const click = { x: 50, y: 48 }
    const contact: AddStripCandidate<string> = {
      segments: [[{ x: 20, y: 50 }, { x: 80, y: 50 }]],
      dispatch: 'contact:sand-clay',
    }
    expect(routeAddStripByEdgeProximity(click, [contact], TOL_SQ)).toBe('contact:sand-clay')
  })

  it('E2 — a click in the OPEN band interior (far from every edge) is a NO-OP', () => {
    // The exact owner bug: a click deep inside the SAND band — 30px from sand's
    // base edge, 20px from the silt lens diagonal — must NOT grab anything. The
    // OLD containment router grabbed the region the cursor was inside (sand). The
    // edge-only rule returns null: only the line is grabbable.
    const click = { x: 50, y: 60 }
    const sand: AddStripCandidate<string> = {
      regionPolygon: [
        { x: 20, y: 50 },
        { x: 80, y: 50 },
        { x: 80, y: 90 },
        { x: 20, y: 90 },
      ],
      segments: [[{ x: 20, y: 90 }, { x: 80, y: 90 }]], // sand base edge ~30px below
      dispatch: 'sand',
    }
    const siltLensAbove: AddStripCandidate<string> = {
      regionPolygon: [
        { x: 20, y: 30 },
        { x: 80, y: 30 },
        { x: 20, y: 40 },
      ],
      segments: [[{ x: 20, y: 30 }, { x: 80, y: 40 }]], // diagonal ~20px above the click
      dispatch: 'silt-lens',
    }
    // Interior click → no edge within tolerance → NO grab (was 'sand' under containment).
    expect(routeAddStripByEdgeProximity(click, [sand, siltLensAbove], TOL_SQ)).toBeNull()
  })

  it('E3 — a click ON a diagonal lens edge grabs the lens (the line you clicked ON wins)', () => {
    // A click sitting ON a lens's diagonal flank (within tolerance) grabs the lens,
    // because it is the nearest EDGE to where the cursor is — not because the cursor
    // is "inside" any band. The sand band's far base edge does not steal it.
    const click = { x: 50, y: 55 }
    const sand: AddStripCandidate<string> = {
      segments: [[{ x: 20, y: 90 }, { x: 80, y: 90 }]], // 35px below → outside tol
      dispatch: 'sand',
    }
    const lens: AddStripCandidate<string> = {
      // Diagonal (20,30)→(80,62): at x=50 the line is at y=46; the click (50,55) is
      // ~8px off but the nearest point on the segment is within ~5px → within tol.
      segments: [[{ x: 20, y: 40 }, { x: 80, y: 56 }]], // at x=50 → y=52, 3px from click
      dispatch: 'lens',
    }
    expect(routeAddStripByEdgeProximity(click, [sand, lens], TOL_SQ)).toBe('lens')
  })

  it('E4 — empty list routes to null', () => {
    expect(routeAddStripByEdgeProximity({ x: 0, y: 0 }, [], TOL_SQ)).toBeNull()
  })

  it('E5 — a click near a GHOST barrier region is a NO-OP even if an edge is within tolerance (§83)', () => {
    // The ghost-suppression case survives edge-only. A suppressed ghost band owns
    // the click: even if a live candidate edge grazes the tolerance, a press inside
    // the ghost region must NOT grab — the ghost has no handle, so no reshape there.
    const insideGhost = { x: 50, y: 51 } // inside the ghost ring, near the lens edge
    const sandGhostRing = [
      { x: 20, y: 50 },
      { x: 80, y: 50 },
      { x: 80, y: 90 },
      { x: 20, y: 90 },
    ]
    const siltLensEdge: AddStripCandidate<string> = {
      segments: [[{ x: 20, y: 50 }, { x: 80, y: 50 }]], // coincides with the ghost's top edge
      dispatch: 'silt-lens',
    }
    // WITHOUT the barrier: the click is on the lens edge → grabs it.
    expect(routeAddStripByEdgeProximity(insideGhost, [siltLensEdge], TOL_SQ)).toBe('silt-lens')
    // WITH the ghost ring as a barrier: the click is inside the ghost → NO-OP.
    expect(
      routeAddStripByEdgeProximity(insideGhost, [siltLensEdge], TOL_SQ, [sandGhostRing]),
    ).toBeNull()
    // A click on the SAME edge but OUTSIDE the ghost ring still grabs (not suppressed).
    expect(
      routeAddStripByEdgeProximity({ x: 50, y: 49 }, [siltLensEdge], TOL_SQ, [sandGhostRing]),
    ).toBe('silt-lens')
  })
})

// ===========================================================================
// S72 — a new node must sit ON its target boundary, never float in the region
// interior. Edge-only routing grabs the right edge, then the node's y is
// PROJECTED onto that edge at the click's x (never the raw cursor y).
// ===========================================================================
describe('partitionAddStripRouter — project click onto the target boundary (S72)', () => {
  it('P1 — a click near a horizontal edge projects onto that edge at the click x', () => {
    // Sand band base edge y=90. A click JUST above the edge (50, 86) projects to the
    // point on the base edge (y=90) at x=50 — NOT the raw cursor y=86.
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
    const projected = projectClickToCandidate({ x: 50, y: 86 }, sand)
    expect(projected).not.toBeNull()
    expect(projected!.x).toBeCloseTo(50, 3)
    expect(projected!.y).toBeCloseTo(90, 3) // ON the base edge, not the interior y=86
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
