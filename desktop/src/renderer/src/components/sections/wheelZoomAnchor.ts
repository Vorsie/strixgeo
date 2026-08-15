// Horizontal column layout + the cursor-anchored wheel-zoom solve.
//
// Two things live here, and they belong together because the second is only
// exact when it uses the first:
//
//   * ``layoutColumnsHorizontally`` — the section's horizontal layout pass:
//     pack the columns edge-to-edge, lerp each one back toward its true
//     projected X by the Spacing slider, then run the collision nudge. This is
//     the SINGLE source of truth: ``SectionPanel`` builds ``placedColumns``
//     from it, and the wheel zoom re-runs it to ask where the columns WOULD
//     land at a candidate viewport.
//
//   * ``solveCursorAnchoredXMin`` — given the cursor pixel and the post-zoom
//     scale, the new ``viewport.xMin`` that keeps the WARPED world point under
//     the cursor exactly under the cursor.
//
// Why an exact solve is possible at all: the layout is TRANSLATION-EQUIVARIANT
// in ``xMin``. Every column's true X is ``marginLeft + (along - xMin) * scaleH``,
// so shifting ``xMin`` shifts every true X by the same number of pixels; the
// packing origin is the leftmost true X, the spacing lerp is affine, and the
// nudge is a running ``max`` of translated quantities. Shift the input, the
// whole layout shifts with it. So one layout simulation at ANY reference
// ``xMin`` fixes the layout's SHAPE at the new scale, and the remaining
// unknown is a single translation — solved in closed form, no iteration and no
// approximation.
//
// The previous implementation instead picked the column NEAREST the cursor and
// solved for THAT column's pixel, with a band-half-width ratio standing in for
// the packed offset. Two consequences the owner saw: with the cursor between
// columns the view snapped to a neighbour's anchor, and because the ratio is
// not exact the error did not cancel between a zoom-in and a zoom-out, so the
// camera crept left over repeated wheeling.
//
// Pure module: no React, no DOM. Unit-tested in wheelZoomAnchor.test.ts.

import { nudgeColumns } from '../../utils/columnLayout'
import { warpedAlongToScreenX, warpedScreenXToAlong, type WarpAnchor } from './sectionWarp'
import { BARE_COLUMN_WIDTH_PX } from './utils'

/**
 * One column as the horizontal layout sees it.
 *
 * The width is split into the part that is constant across a zoom step and the
 * part that scales with the band half-width, because the band half-width
 * changes with the horizontal scale — so the wheel zoom can re-derive the
 * post-zoom width without re-reading any of the toggle state.
 */
export interface ZoomLayoutColumn {
  /** Investigation id — identity for the correlated-pair gap lookup. */
  id: string
  /** True projected along-section distance of the column (world metres). */
  along: number
  /** Layout width that does NOT scale with the band half-width (px). */
  fixedWidthPx: number
  /** Multiple of the band half-width added to the layout width (0, 2, 2·N…). */
  halfWidthMultiple: number
}

/** Minimal structural view of the per-id lookups the footprint builder needs. */
interface HasId {
  has(id: string): boolean
}

/**
 * Build one column's layout footprint.
 *
 * Called from BOTH the render layout and the wheel-zoom simulation so the two
 * can never drift — the drift between them is exactly what made repeated
 * wheeling walk the camera sideways.
 *
 * @param id - Investigation id.
 * @param along - True projected along-section distance (world metres).
 * @param dataBandHalfWidthMultiple - Multiple of the band half-width claimed by
 *   the column's own data band: ``cptBandFullWidth(type, channels, 1)`` for a
 *   CPT that has a plot, ``2 * enabledBoreholeChannels`` for a borehole that
 *   has detail rows, ``0`` when no data band is drawn.
 * @param hasLithoGhostBand - True when a litho suggestion ghost reserves a
 *   ``2 × halfWidth`` band on this column even with the data band off.
 * @param ghostRailPx - Virtuele-Boring ghost-rail footprint reserved on every
 *   column (px; 0 when the overlay is off).
 * @returns The column's layout footprint.
 */
export function zoomLayoutColumn(
  id: string,
  along: number,
  dataBandHalfWidthMultiple: number,
  hasLithoGhostBand: boolean,
  ghostRailPx: number,
): ZoomLayoutColumn {
  return {
    id,
    along,
    fixedWidthPx: BARE_COLUMN_WIDTH_PX + ghostRailPx,
    // ``Math.max(dataBandW, lithoBandW)`` over two NON-NEGATIVE multiples of
    // the same half-width is the max of the multiples — so the split survives
    // the band half-width changing under a zoom.
    halfWidthMultiple: Math.max(dataBandHalfWidthMultiple, hasLithoGhostBand ? 2 : 0),
  }
}

/**
 * A column's layout width at a given band half-width.
 *
 * @param column - The column footprint.
 * @param bandHalfWidth - Band half-width at the scale being laid out (px).
 * @returns The layout width in px.
 */
export function columnLayoutWidthPx(
  column: ZoomLayoutColumn,
  bandHalfWidth: number,
): number {
  return column.fixedWidthPx + column.halfWidthMultiple * bandHalfWidth
}

/** Inputs to {@link layoutColumnsHorizontally}. */
export interface HorizontalLayoutInput {
  /** Columns to lay out, in any order. */
  columns: readonly ZoomLayoutColumn[]
  /** Left edge of the along-section viewport (world metres). */
  xMin: number
  /** Horizontal scale (px per along-section metre). */
  scaleH: number
  /** Band half-width at ``scaleH`` (px). */
  bandHalfWidth: number
  /** Spacing slider, 0 = fully packed … 1 = true projected positions. */
  columnSpacing: number
  /** Plot-area left margin (px). */
  marginLeft: number
  /** Base edge-to-edge gap between adjacent columns (px). */
  edgeGapPx: number
  /**
   * Per-adjacent-pair gap override in left-to-right order — correlated pairs
   * claim a wider gap so the ribbon between them has room. Omitted ⇒ every
   * pair uses ``edgeGapPx``.
   */
  gapForPair?: (prevId: string, currId: string) => number
}

/** One column's placement out of {@link layoutColumnsHorizontally}. */
export interface HorizontalPlacement {
  /** Investigation id. */
  id: string
  /** True projected along-section distance (world metres). */
  along: number
  /**
   * Screen X the column claims BEFORE the collision nudge — i.e. after the
   * spacing lerp. Equals the true projected X at spacing 1. The renderer draws
   * the tie-back diagonal from ``nudgedX`` to this.
   */
  trueX: number
  /** Screen X after the spacing lerp and the collision nudge (px). */
  nudgedX: number
  /** Layout width at this scale (px). */
  width: number
  /** True when the collision nudge moved the column more than half a pixel. */
  displaced: boolean
}

/**
 * The section's horizontal column layout: pack → spacing-lerp → collision nudge.
 *
 * Order of the result is left-to-right (ascending post-lerp X), which is what
 * ``nudgeColumns`` returns and what the section renderer consumes.
 *
 * @param input - See {@link HorizontalLayoutInput}.
 * @returns One placement per input column, left to right.
 */
export function layoutColumnsHorizontally(
  input: HorizontalLayoutInput,
): HorizontalPlacement[] {
  const {
    columns,
    xMin,
    scaleH,
    bandHalfWidth,
    columnSpacing,
    marginLeft,
    edgeGapPx,
    gapForPair,
  } = input
  if (columns.length === 0) return []

  const withTrue = columns.map(col => ({
    id: col.id,
    along: col.along,
    trueX: marginLeft + (col.along - xMin) * scaleH,
    width: columnLayoutWidthPx(col, bandHalfWidth),
  }))
  // Packed layout: edge-to-edge in projection order, starting from the
  // leftmost column's true X. Sorting by trueX and by along agree because
  // ``scaleH`` is positive.
  const sorted = [...withTrue].sort((a, b) => a.trueX - b.trueX)
  const packedBySortedIndex: number[] = []
  let cursor = sorted[0].trueX
  for (let i = 0; i < sorted.length; i += 1) {
    const halfW = sorted[i].width / 2
    if (i === 0) {
      packedBySortedIndex.push(cursor)
      cursor += halfW
    } else {
      cursor += halfW
      packedBySortedIndex.push(cursor)
      cursor += halfW
    }
  }
  const packedById = new Map<string, number>()
  for (let i = 0; i < sorted.length; i += 1) {
    packedById.set(sorted[i].id, packedBySortedIndex[i])
  }
  // The Spacing slider lerps each column from its packed position back toward
  // its true projected position. The nudge then runs over the LERPED positions
  // so the edge-gap rule holds at every spacing value.
  const lerped = withTrue.map(c => {
    const packedX = packedById.get(c.id) as number
    return {
      id: c.id,
      along: c.along,
      trueX: packedX + (c.trueX - packedX) * columnSpacing,
      width: c.width,
    }
  })
  return nudgeColumns(lerped, edgeGapPx, (prev, curr) =>
    gapForPair ? gapForPair(prev.id, curr.id) : edgeGapPx,
  ).map(r => ({
    id: r.item.id,
    along: r.item.along,
    trueX: r.item.trueX,
    nudgedX: r.nudgedX,
    width: r.item.width,
    displaced: r.displaced,
  }))
}

/**
 * The warp anchors a layout produces — ``(along, nudgedX)`` per column, sorted
 * ascending by ``along``, which is the shape the warp map consumes.
 *
 * @param input - See {@link HorizontalLayoutInput}.
 * @returns Warp anchors for the laid-out columns.
 */
export function simulateWarpAnchors(input: HorizontalLayoutInput): WarpAnchor[] {
  return layoutColumnsHorizontally(input)
    .map(p => ({ along: p.along, effX: p.nudgedX }))
    .sort((a, b) => a.along - b.along)
}

/** Inputs to {@link solveCursorAnchoredXMin}. */
export interface CursorAnchoredZoomInput {
  /** Cursor X in the plot's coordinate space (px). */
  cursorPx: number
  /** Anchors currently on screen — what the cursor is actually pointing at. */
  currentAnchors: readonly WarpAnchor[]
  /** Current left edge of the along-section viewport (world metres). */
  currentXMin: number
  /** Current horizontal scale (px per along-section metre). */
  currentScaleH: number
  /** Horizontal scale AFTER the zoom step (px per along-section metre). */
  newScaleH: number
  /** Band half-width at ``newScaleH`` (px). */
  newBandHalfWidth: number
  /** Column footprints (focus-filtered exactly as the render is). */
  columns: readonly ZoomLayoutColumn[]
  /** Spacing slider, 0 = fully packed … 1 = true projected positions. */
  columnSpacing: number
  /** Plot-area left margin (px). */
  marginLeft: number
  /** Base edge-to-edge gap between adjacent columns (px). */
  edgeGapPx: number
  /** Per-adjacent-pair gap override — see {@link HorizontalLayoutInput}. */
  gapForPair?: (prevId: string, currId: string) => number
}

/**
 * The post-zoom ``viewport.xMin`` that keeps the point under the cursor under
 * the cursor.
 *
 * Three steps, all exact:
 *
 *   1. Read the WARPED along-distance the cursor is pointing at — the piecewise
 *      map through the on-screen anchors, so a cursor BETWEEN two columns keeps
 *      its interpolation parameter instead of snapping to a neighbour.
 *   2. Lay the columns out at the post-zoom scale, at an arbitrary reference
 *      ``xMin``, and measure where that along-distance lands.
 *   3. Translate: the layout is translation-equivariant in ``xMin``, so one
 *      subtraction moves that pixel onto the cursor.
 *
 * With no columns the warp degenerates to the linear map and the result is the
 * standard linear cursor anchor — that falls out of the anchor-free branches of
 * the warp helpers, so it needs no special case.
 *
 * @param input - See {@link CursorAnchoredZoomInput}.
 * @returns The new ``viewport.xMin`` (world metres).
 */
export function solveCursorAnchoredXMin(input: CursorAnchoredZoomInput): number {
  const {
    cursorPx,
    currentAnchors,
    currentXMin,
    currentScaleH,
    newScaleH,
    newBandHalfWidth,
    columns,
    columnSpacing,
    marginLeft,
    edgeGapPx,
    gapForPair,
  } = input

  const linearAlong = currentXMin + (cursorPx - marginLeft) / currentScaleH
  const cursorAlong = warpedScreenXToAlong(
    cursorPx,
    currentAnchors,
    currentScaleH,
    linearAlong,
  )

  // Reference layout at the post-zoom scale. ``currentXMin`` is used as the
  // reference only because it is at hand — any value gives the same answer.
  const referenceAnchors = simulateWarpAnchors({
    columns,
    xMin: currentXMin,
    scaleH: newScaleH,
    bandHalfWidth: newBandHalfWidth,
    columnSpacing,
    marginLeft,
    edgeGapPx,
    gapForPair,
  })
  const referencePx = warpedAlongToScreenX(
    cursorAlong,
    referenceAnchors,
    newScaleH,
    marginLeft + (cursorAlong - currentXMin) * newScaleH,
  )

  // Moving ``xMin`` right by d metres slides the whole layout LEFT by
  // ``d * newScaleH`` px, so this lands ``referencePx`` exactly on the cursor.
  return currentXMin + (referencePx - cursorPx) / newScaleH
}
