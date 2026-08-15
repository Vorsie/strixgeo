// The horizontal layout + the cursor-anchored zoom solve, at the maths level.
//
// The hook-level net (useSectionCursorZoom.test.ts) pins what the engineer
// sees. These pin the two properties everything above them rests on:
//
//   * the layout is TRANSLATION-EQUIVARIANT in ``xMin`` — which is what makes a
//     closed-form solve possible instead of an iterative search;
//   * the solve puts the cursor's world point back on the cursor pixel, exactly,
//     at every Spacing setting.

import { describe, expect, it } from 'vitest'

import { warpedAlongToScreenX } from './sectionWarp'
import {
  columnLayoutWidthPx,
  layoutColumnsHorizontally,
  simulateWarpAnchors,
  solveCursorAnchoredXMin,
  zoomLayoutColumn,
} from './wheelZoomAnchor'

/** Two bare columns 30 m apart — wide enough that the nudge only bites packed. */
const PAIR = [zoomLayoutColumn('a', 0, 0, false, 0), zoomLayoutColumn('b', 30, 0, false, 0)]

const BASE = {
  columns: PAIR,
  xMin: 0,
  scaleH: 1,
  bandHalfWidth: 10,
  marginLeft: 0,
  edgeGapPx: 4,
}

describe('column layout widths', () => {
  it('WL1: a bare column claims its glyph width and nothing more', () => {
    expect(columnLayoutWidthPx(zoomLayoutColumn('x', 0, 0, false, 0), 40)).toBe(14)
  })

  it('WL2: a data band claims two half-widths on top of the glyph', () => {
    expect(columnLayoutWidthPx(zoomLayoutColumn('x', 0, 2, false, 0), 40)).toBe(14 + 80)
  })

  it('WL3: a litho ghost band reserves the same room even with no data band', () => {
    expect(columnLayoutWidthPx(zoomLayoutColumn('x', 0, 0, true, 0), 40)).toBe(14 + 80)
  })

  it('WL4: the wider of the two claims wins — they share one band, not two', () => {
    expect(columnLayoutWidthPx(zoomLayoutColumn('x', 0, 6, true, 0), 40)).toBe(14 + 240)
  })

  it('WL5: the ghost rail is added on every column, whatever the band does', () => {
    expect(columnLayoutWidthPx(zoomLayoutColumn('x', 0, 2, false, 18), 40)).toBe(14 + 80 + 18)
  })
})

describe('layoutColumnsHorizontally', () => {
  it('WL6: at Spacing 1 each test sits at its true projected position', () => {
    const out = layoutColumnsHorizontally({ ...BASE, columnSpacing: 1 })

    expect(out.map(p => p.nudgedX)).toEqual([0, 30])
    expect(out.every(p => !p.displaced)).toBe(true)
  })

  it('WL7: at Spacing 0 the tests pack edge to edge from the leftmost one', () => {
    // Packed puts b at 14 px (two 14 px glyphs, edge to edge); the collision
    // pass then opens the 4 px gap the section always keeps.
    const out = layoutColumnsHorizontally({ ...BASE, columnSpacing: 0 })

    expect(out.map(p => p.nudgedX)).toEqual([0, 18])
  })

  it('WL8: TRANSLATION EQUIVARIANCE — moving the viewport slides the whole layout, unchanged in shape', () => {
    // This is the property the wheel-zoom solve rests on: pan by d metres and
    // every column moves by exactly d × scaleH px, so one layout run fixes the
    // shape and the remaining unknown is a single translation.
    const scaleH = 2
    const at0 = layoutColumnsHorizontally({ ...BASE, scaleH, xMin: 0, columnSpacing: 0.4 })
    const at5 = layoutColumnsHorizontally({ ...BASE, scaleH, xMin: 5, columnSpacing: 0.4 })

    for (let i = 0; i < at0.length; i += 1) {
      expect(at5[i].nudgedX).toBeCloseTo(at0[i].nudgedX - 5 * scaleH, 9)
      expect(at5[i].width).toBe(at0[i].width)
    }
  })

  it('WL9: a correlated pair claims the wider gap it was given', () => {
    const out = layoutColumnsHorizontally({
      ...BASE,
      columnSpacing: 0,
      gapForPair: () => 24,
    })

    expect(out.map(p => p.nudgedX)).toEqual([0, 38])
  })

  it('WL10: anchors come back sorted by along-distance, which is what the warp map wants', () => {
    const anchors = simulateWarpAnchors({ ...BASE, columnSpacing: 0 })

    expect(anchors).toEqual([
      { along: 0, effX: 0 },
      { along: 30, effX: 18 },
    ])
  })
})

/** Where a given along-distance lands once the layout is run at ``xMin``. */
function drawnAt(
  along: number,
  xMin: number,
  scaleH: number,
  bandHalfWidth: number,
  columnSpacing: number,
): number {
  const anchors = simulateWarpAnchors({
    ...BASE,
    xMin,
    scaleH,
    bandHalfWidth,
    columnSpacing,
  })
  return warpedAlongToScreenX(along, anchors, scaleH, (along - xMin) * scaleH)
}

describe('solveCursorAnchoredXMin', () => {
  for (const columnSpacing of [0, 0.5, 1]) {
    it(`WZ-S1 (spacing ${columnSpacing}): the world point under the cursor lands back on the cursor pixel`, () => {
      const scaleH = 1
      const newScaleH = 1.6
      const anchors = simulateWarpAnchors({ ...BASE, columnSpacing })
      // A cursor sitting BETWEEN the two tests, which is where the old
      // nearest-column anchor used to snap to a neighbour.
      const cursorPx = (anchors[0].effX + anchors[1].effX) / 2
      const pointedAlong =
        anchors[0].along +
        ((cursorPx - anchors[0].effX) / (anchors[1].effX - anchors[0].effX)) *
          (anchors[1].along - anchors[0].along)

      const newXMin = solveCursorAnchoredXMin({
        cursorPx,
        currentAnchors: anchors,
        currentXMin: 0,
        currentScaleH: scaleH,
        newScaleH,
        newBandHalfWidth: 16,
        columns: PAIR,
        columnSpacing,
        marginLeft: 0,
        edgeGapPx: 4,
      })

      expect(drawnAt(pointedAlong, newXMin, newScaleH, 16, columnSpacing)).toBeCloseTo(
        cursorPx,
        6,
      )
    })
  }

  it('WZ-S2: with no tests on the section the answer is the plain linear cursor anchor', () => {
    const cursorPx = 120
    const newXMin = solveCursorAnchoredXMin({
      cursorPx,
      currentAnchors: [],
      currentXMin: 10,
      currentScaleH: 2,
      newScaleH: 4,
      newBandHalfWidth: 24,
      columns: [],
      columnSpacing: 1,
      marginLeft: 0,
      edgeGapPx: 4,
    })

    // Cursor points at 10 + 120/2 = 70 m; at the new scale that must still be
    // 120 px from the plot's left edge.
    expect(newXMin).toBeCloseTo(70 - cursorPx / 4, 9)
  })

  it('WZ-S3: zooming in and back out at the same cursor returns the viewport exactly', () => {
    const columnSpacing = 0.5
    const cursorPx = 40
    const solve = (xMin: number, from: number, to: number, bhw: number): number =>
      solveCursorAnchoredXMin({
        cursorPx,
        currentAnchors: simulateWarpAnchors({
          ...BASE,
          xMin,
          scaleH: from,
          bandHalfWidth: Math.round(from * 10),
          columnSpacing,
        }),
        currentXMin: xMin,
        currentScaleH: from,
        newScaleH: to,
        newBandHalfWidth: bhw,
        columns: PAIR,
        columnSpacing,
        marginLeft: 0,
        edgeGapPx: 4,
      })

    const zoomedIn = solve(0, 1, 2, 20)
    const backOut = solve(zoomedIn, 2, 1, 10)

    expect(backOut).toBeCloseTo(0, 9)
  })
})
