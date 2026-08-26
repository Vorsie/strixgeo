// Behavioural pins for the model footprint ring (owner ballot 2026-08-26).
//
// The ask, in the owner's words: draw the model's footprint boundary "as a
// subtle closed ring at/near ground level ... so 'the model ends here' reads as
// an edge, not a hole".
//
// Everything asserted here is phrased against that sentence, not against the
// implementation:
//
//   • "closed ring"      → the last point repeats the first.
//   • "the model's       → the ring is the polygon the BUILD clipped to,
//     footprint"           passed through verbatim: no reordering, no
//                          simplification, no resampling.
//   • "at/near ground    → a flat ring at the model's TOP, lifted clear of the
//     level"               surface so it does not z-fight the ground/solids.
//   • "an edge, not a    → fewer than 3 vertices is not an area, so there is no
//     hole"                edge to draw and the ring is absent (never a
//                          degenerate 2-point line the user would read as a
//                          stray artefact).

import { describe, expect, it } from 'vitest'

import {
  FOOTPRINT_RING_LIFT_M,
  footprintRingPositions,
  resolveFootprintRingElevation,
} from './footprintRing'

describe('footprintRingPositions', () => {
  it('closes the ring — the last point repeats the first', () => {
    const ring = footprintRingPositions(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      5,
    )

    // 3 hull vertices in → 4 points out, the 4th being the 1st again.
    expect(ring).toHaveLength(4)
    expect(ring[3]).toEqual(ring[0])
  })

  it('passes the hull through verbatim — same vertices, same order', () => {
    // The ring must be the polygon the build clipped to. A ring that
    // re-ordered or simplified its input would draw a boundary the geometry
    // does not actually have.
    const hull: [number, number][] = [
      [100, 200],
      [140, 205],
      [130, 260],
      [95, 250],
    ]

    const ring = footprintRingPositions(hull, 0)

    expect(ring.slice(0, 4).map(([x, y]) => [x, y])).toEqual(hull)
  })

  it('places every point at the one given elevation — the ring is flat', () => {
    const ring = footprintRingPositions(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      12.5,
    )

    expect(ring.every(([, , z]) => z === 12.5)).toBe(true)
  })

  it('draws nothing when the footprint is not an area', () => {
    // Two points are a line, one is a dot, none is nothing — none of them is a
    // boundary, and a stray 2-point line in the scene reads as a bug.
    expect(footprintRingPositions([], 0)).toEqual([])
    expect(footprintRingPositions([[0, 0]], 0)).toEqual([])
    expect(
      footprintRingPositions(
        [
          [0, 0],
          [1, 1],
        ],
        0,
      ),
    ).toEqual([])
  })

  it('tolerates a hull that already repeats its first vertex', () => {
    // alpha_hull_polygon documents "WITHOUT a repeated last point", but a
    // future caller (or a hand-authored fixture) that closes its own ring must
    // not produce a doubled vertex.
    const ring = footprintRingPositions(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
      0,
    )

    expect(ring).toHaveLength(4)
    expect(ring[3]).toEqual(ring[0])
  })
})

describe('resolveFootprintRingElevation', () => {
  it('sits above the ground surface when there is one', () => {
    const elev = resolveFootprintRingElevation(
      [
        [0, 0, 3],
        [1, 0, 7],
        [1, 1, 5],
      ],
      [],
    )

    expect(elev).toBe(7 + FOOTPRINT_RING_LIFT_M)
  })

  it('falls back to the top of the built solids when no ground surface exists', () => {
    // The litho / geotech panes render solids with no DEM in many projects;
    // the ring must still land on top of the model rather than at zero, which
    // could be far below or far above the geometry.
    const elev = resolveFootprintRingElevation(
      [],
      [
        [0, 0, -12],
        [1, 0, 2.25],
      ],
    )

    expect(elev).toBe(2.25 + FOOTPRINT_RING_LIFT_M)
  })

  it('prefers the ground surface over the solids', () => {
    const elev = resolveFootprintRingElevation([[0, 0, 4]], [[0, 0, 99]])

    expect(elev).toBe(4 + FOOTPRINT_RING_LIFT_M)
  })

  it('has no elevation to offer when nothing is rendered', () => {
    // Null, not 0: a ring at sea level in a project whose model sits at −30 m
    // would float in empty space and read as a second, wrong model edge.
    expect(resolveFootprintRingElevation([], [])).toBeNull()
  })

  it('ignores non-finite vertex elevations', () => {
    // A degenerate solid with a NaN z must not poison max() and take the ring
    // out of the scene entirely.
    const elev = resolveFootprintRingElevation(
      [],
      [
        [0, 0, Number.NaN],
        [1, 0, 3],
      ],
    )

    expect(elev).toBe(3 + FOOTPRINT_RING_LIFT_M)
  })
})
