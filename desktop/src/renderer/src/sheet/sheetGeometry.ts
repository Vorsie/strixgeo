/**
 * Paper size and column placement for the sheet (spec "Scale modes").
 * Pure: millimetres in, millimetres out. Column x reuses the screen's own
 * ``layoutColumnsHorizontally`` so the spacing slider means on paper exactly
 * what it means on screen.
 */
import { layoutColumnsHorizontally } from '../components/sections/wheelZoomAnchor'
import {
  AXIS_GUTTER_MM, COLUMN_EDGE_GAP_MM, COLUMN_HALF_WIDTH_MAX_MM, COLUMN_HALF_WIDTH_MM,
  COLUMN_WIDTH_SPACING_FRACTION, DRAWING_HEIGHT_FIT_MM,
  GUTTER_MM, MARGIN_MM, MIN_DRAWING_HEIGHT_MM, PAPER_HEIGHT_MM, PAPER_MAX_WIDTH_MM,
  PAPER_MIN_WIDTH_MM, PROFILE_TRAILING_MM, RIGHT_COLUMN_MM, TOP_BAND_MM, VERTICAL_CHROME_MM,
} from './sheetConstants'
import type { SheetScaleMode } from './sheetPayload'

/** Smallest gap between two adjacent column centres on paper, or ``null`` when
 *  there are fewer than two columns (nothing to measure a spacing against). */
function minAdjacentGapMm(xsMm: readonly number[]): number | null {
  if (xsMm.length < 2) return null
  const sorted = [...xsMm].sort((a, b) => a - b)
  let smallest = Infinity
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap < smallest) smallest = gap
  }
  return Number.isFinite(smallest) ? smallest : null
}

export interface SheetGeometryInput {
  levelMaxM: number
  levelMinM: number
  /** Sorted by ``alongM`` ascending. */
  columns: readonly { id: string; alongM: number }[]
  scaleMode: SheetScaleMode
  hScale: number | null
  vScale: number | null
  vex: number
  spacing: number
}

export interface SheetGeometry {
  paperWidthMm: number
  paperHeightMm: number
  drawingHeightMm: number
  /** Left edge of the drawing (after margin + axis gutter). */
  drawingLeftMm: number
  drawingTopMm: number
  drawingWidthMm: number
  rightColumnLeftMm: number
  scaleHmmPerM: number
  scaleVmmPerM: number
  printedH: number
  printedV: number
  vexEffective: number
  /** One entry per input column, same order, mm from the paper's left edge. */
  columnXmm: number[]
  /** Half the drawn width of a column on paper — scales with the on-paper spacing. */
  columnHalfWidthMm: number
  overCap: boolean
}

export function computeSheetGeometry(input: SheetGeometryInput): SheetGeometry {
  const rangeM = Math.max(1e-3, input.levelMaxM - input.levelMinM)
  let scaleV: number
  let scaleH: number
  let drawingHeightMm: number
  if (input.scaleMode === 'explicit' && input.hScale && input.vScale) {
    scaleH = 1000 / input.hScale
    scaleV = 1000 / input.vScale
    drawingHeightMm = Math.max(MIN_DRAWING_HEIGHT_MM, rangeM * scaleV)
  } else {
    // Fit = the profile fits an A3 sheet in BOTH directions at the chosen
    // exaggeration. The horizontal scale fills the A3 drawing width; the
    // vertical follows the exaggeration, so more exaggeration makes the
    // drawing TALLER — until the page height is reached, after which the
    // whole drawing shrinks together to keep the exaggeration honest.
    //
    // Owner 2026-09-11 (sheet on the geotech axis): "columns do not rescale
    // with height exaggeration ... fit mode, i expected them to stretch taller
    // too and of course wider." The previous rule pinned the drawing height
    // to the page and derived H from V / vex, so raising the exaggeration
    // made the section SHORTER on paper and the columns narrower with it.
    const vex = Math.max(1e-6, input.vex)
    const lengthM = Math.max(
      1e-3,
      (input.columns[input.columns.length - 1]?.alongM ?? 0) - (input.columns[0]?.alongM ?? 0),
    )
    // The first and last columns are drawn at up to the capped half-width on
    // either side of their centres, so that reach is taken off the fit width
    // too — otherwise a long profile lands 2 × 18 mm past A3.
    const availableWidthMm =
      PAPER_MIN_WIDTH_MM - MARGIN_MM - AXIS_GUTTER_MM - PROFILE_TRAILING_MM - GUTTER_MM - RIGHT_COLUMN_MM - MARGIN_MM
      - 2 * COLUMN_HALF_WIDTH_MAX_MM
    const widthFitH = availableWidthMm / lengthM
    const heightFitH = DRAWING_HEIGHT_FIT_MM / (rangeM * vex)
    scaleH = Math.min(widthFitH, heightFitH)
    scaleV = scaleH * vex
    drawingHeightMm = Math.max(MIN_DRAWING_HEIGHT_MM, rangeM * scaleV)
  }
  const drawingLeftMm = MARGIN_MM + AXIS_GUTTER_MM
  const layoutColumns = input.columns.map(c => ({
    id: c.id, along: c.alongM, fixedWidthPx: 0, halfWidthMultiple: 2,
  }))
  const xMin = input.columns[0]?.alongM ?? 0
  // Lay the columns out at a given drawn half-width and return their mm x in
  // input order. ``marginLeft`` includes the half-width so the leftmost
  // column's mirrored (leftward) reach lands exactly on the elevation axis.
  const layoutAt = (bandHalfWidth: number): number[] => {
    const placements = layoutColumnsHorizontally({
      columns: layoutColumns, xMin, scaleH, bandHalfWidth,
      columnSpacing: input.spacing,
      marginLeft: drawingLeftMm + bandHalfWidth,
      edgeGapPx: COLUMN_EDGE_GAP_MM,
    })
    const byId = new Map(placements.map(p => [p.id, p.nudgedX]))
    return input.columns.map(c => byId.get(c.id) ?? drawingLeftMm)
  }
  // Pass 1 seeds the layout at the minimum width to read the on-paper column
  // spacing; the drawn width is then a fixed fraction of the nearest-neighbour
  // spacing (clamped), so widely-spaced columns read as legible strips rather
  // than tall hairlines. Pass 2 re-lays at that width so the packing, the
  // first-column offset and the trailing edge all use the real drawn width.
  const seedXmm = layoutAt(COLUMN_HALF_WIDTH_MM)
  const nearestGapMm = minAdjacentGapMm(seedXmm)
  const columnHalfWidthMm = nearestGapMm === null
    ? COLUMN_HALF_WIDTH_MM
    : Math.max(
        COLUMN_HALF_WIDTH_MM,
        Math.min(COLUMN_HALF_WIDTH_MAX_MM, COLUMN_WIDTH_SPACING_FRACTION * nearestGapMm),
      )
  const columnXmm = layoutAt(columnHalfWidthMm)
  const lastX = columnXmm.length > 0 ? Math.max(...columnXmm) : drawingLeftMm
  const drawingRightMm = lastX + columnHalfWidthMm + PROFILE_TRAILING_MM
  const naturalWidth = drawingRightMm + GUTTER_MM + RIGHT_COLUMN_MM + MARGIN_MM
  const paperWidthMm = Math.max(PAPER_MIN_WIDTH_MM, Math.ceil(naturalWidth))
  const rightColumnLeftMm = paperWidthMm - MARGIN_MM - RIGHT_COLUMN_MM
  return {
    paperWidthMm,
    paperHeightMm: Math.max(PAPER_HEIGHT_MM, Math.ceil(drawingHeightMm + VERTICAL_CHROME_MM)),
    drawingHeightMm,
    drawingLeftMm,
    drawingTopMm: MARGIN_MM + TOP_BAND_MM,
    drawingWidthMm: rightColumnLeftMm - GUTTER_MM - drawingLeftMm,
    rightColumnLeftMm,
    scaleHmmPerM: scaleH,
    scaleVmmPerM: scaleV,
    printedH: Math.round(1000 / scaleH),
    printedV: Math.round(1000 / scaleV),
    vexEffective: scaleV / scaleH,
    columnXmm,
    columnHalfWidthMm,
    overCap: paperWidthMm > PAPER_MAX_WIDTH_MM,
  }
}
