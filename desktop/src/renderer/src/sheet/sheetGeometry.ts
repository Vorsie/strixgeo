/**
 * Paper size and column placement for the sheet (spec "Scale modes").
 * Pure: millimetres in, millimetres out. Column x reuses the screen's own
 * ``layoutColumnsHorizontally`` so the spacing slider means on paper exactly
 * what it means on screen.
 */
import { layoutColumnsHorizontally } from '../components/sections/wheelZoomAnchor'
import {
  AXIS_GUTTER_MM, COLUMN_EDGE_GAP_MM, COLUMN_HALF_WIDTH_MM, DRAWING_HEIGHT_FIT_MM,
  GUTTER_MM, MARGIN_MM, MIN_DRAWING_HEIGHT_MM, PAPER_HEIGHT_MM, PAPER_MAX_WIDTH_MM,
  PAPER_MIN_WIDTH_MM, PROFILE_TRAILING_MM, RIGHT_COLUMN_MM, TOP_BAND_MM, VERTICAL_CHROME_MM,
} from './sheetConstants'
import type { SheetScaleMode } from './sheetPayload'

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
    scaleV = DRAWING_HEIGHT_FIT_MM / rangeM
    scaleH = scaleV / Math.max(1e-6, input.vex)
    drawingHeightMm = DRAWING_HEIGHT_FIT_MM
  }
  const drawingLeftMm = MARGIN_MM + AXIS_GUTTER_MM
  const placements = layoutColumnsHorizontally({
    columns: input.columns.map(c => ({
      id: c.id, along: c.alongM, fixedWidthPx: 0, halfWidthMultiple: 2,
    })),
    xMin: input.columns[0]?.alongM ?? 0,
    scaleH,
    bandHalfWidth: COLUMN_HALF_WIDTH_MM,
    columnSpacing: input.spacing,
    marginLeft: drawingLeftMm + COLUMN_HALF_WIDTH_MM,
    edgeGapPx: COLUMN_EDGE_GAP_MM,
  })
  const byId = new Map(placements.map(p => [p.id, p.nudgedX]))
  const columnXmm = input.columns.map(c => byId.get(c.id) ?? drawingLeftMm)
  const lastX = columnXmm.length > 0 ? Math.max(...columnXmm) : drawingLeftMm
  const drawingRightMm = lastX + COLUMN_HALF_WIDTH_MM + PROFILE_TRAILING_MM
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
    overCap: paperWidthMm > PAPER_MAX_WIDTH_MM,
  }
}
