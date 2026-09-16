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
  /** Right edge of the profile's drawn extent (trailing column + margin), mm
   *  from the paper's left edge. In fit mode this reaches the drawing area's
   *  right edge at every spacing (the scale re-fits so the readable columns fit
   *  A3); only when even the minimum column spacing cannot fit does the paper
   *  grow. Explicit mode grows the paper for any over-A3 profile. */
  drawingRightMm: number
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

/** Upper bound of the sheet's exaggeration slider (mirrors the section view's VEX_MAX). */
export const VEX_SLIDER_MAX = 50

/** The horizontal scale (mm per m) that fits the profile length into the A3 drawing width. */
function fitWidthScaleH(columns: readonly { alongM: number }[]): number {
  const lengthM = Math.max(1e-3, (columns[columns.length - 1]?.alongM ?? 0) - (columns[0]?.alongM ?? 0))
  // The first and last columns are drawn at up to the capped half-width on
  // either side of their centres, so that reach is taken off the fit width
  // too — otherwise a long profile lands 2 × 18 mm past A3.
  const availableWidthMm =
    PAPER_MIN_WIDTH_MM - MARGIN_MM - AXIS_GUTTER_MM - PROFILE_TRAILING_MM - GUTTER_MM - RIGHT_COLUMN_MM - MARGIN_MM
    - 2 * COLUMN_HALF_WIDTH_MAX_MM
  return availableWidthMm / lengthM
}

/**
 * The exaggeration at which a fit-mode sheet fills the page: the drawing is
 * exactly the page height on the A3 width. The sheet opens here (owner
 * 2026-09-11: "a lot of white space on the pdf report no? Can't we give a
 * better page fit to start?" — at 1× a 900 m by 25 m profile was a strip along
 * the top). Never below 1× (a short deep profile already fills the page at
 * true scale), never above the slider's maximum, rounded to a tenth so the
 * readout and the slider agree.
 */
export function pageFillingVex(input: {
  levelMaxM: number
  levelMinM: number
  /** Only the along-section metres matter; a payload column fits as well as a geometry column. */
  columns: readonly { alongM: number }[]
}): number {
  const rangeM = Math.max(1e-3, input.levelMaxM - input.levelMinM)
  const raw = DRAWING_HEIGHT_FIT_MM / (rangeM * fitWidthScaleH(input.columns))
  return Math.min(VEX_SLIDER_MAX, Math.max(1, Math.round(raw * 10) / 10))
}

export function computeSheetGeometry(input: SheetGeometryInput): SheetGeometry {
  const rangeM = Math.max(1e-3, input.levelMaxM - input.levelMinM)
  const drawingLeftMm = MARGIN_MM + AXIS_GUTTER_MM
  const layoutColumns = input.columns.map(c => ({
    id: c.id, along: c.alongM, fixedWidthPx: 0, halfWidthMultiple: 2,
  }))
  const xMin = input.columns[0]?.alongM ?? 0
  const fillMode = input.scaleMode !== 'explicit'
  // The trailing edge the profile should reach on an A3 sheet: one gutter and a
  // right column short of the paper's right margin.
  const fillTargetRightMm = PAPER_MIN_WIDTH_MM - MARGIN_MM - RIGHT_COLUMN_MM - GUTTER_MM

  // Lay the columns out at a given horizontal scale and drawn half-width and
  // return their mm x in input order. ``marginLeft`` includes the half-width so
  // the leftmost column's mirrored (leftward) reach lands exactly on the
  // elevation axis, and stays fixed as the scale varies (the axis never moves).
  const layoutAt = (scaleH: number, bandHalfWidth: number): number[] => {
    const placements = layoutColumnsHorizontally({
      columns: layoutColumns, xMin, scaleH, bandHalfWidth,
      columnSpacing: input.spacing,
      marginLeft: drawingLeftMm + bandHalfWidth,
      edgeGapPx: COLUMN_EDGE_GAP_MM,
    })
    const byId = new Map(placements.map(p => [p.id, p.nudgedX]))
    return input.columns.map(c => byId.get(c.id) ?? drawingLeftMm)
  }
  // Fit mode fills the drawing width at EVERY spacing. ``layoutAt`` places the
  // columns at true × scaleH then lerps them toward packed by the Spacing
  // slider, so a low spacing pulls the profile into a narrow cluster on the left
  // and opens white space before the right column (owner, installer #40: "fit to
  // A3 and column spacing all the way down has a lot of white space between the
  // profile and the map on the right"). The rule: in fit mode the spacing
  // decides how the columns SHARE the width, not how much of the page the
  // profile uses. So after the spacing layout, the columns are stretched about
  // the fixed left edge (the leftmost column stays on the elevation axis) until
  // the profile's trailing edge reaches the drawing area's right edge — a
  // UNIFORM stretch, so the relative spacing the slider produced is preserved.
  // The stretch never COMPRESSES (a profile already at or past the A3 width is
  // handled by the scale re-fit below, not by squashing the columns together).
  // Explicit mode is left untouched — there a chosen scale may leave white space.
  const layoutFilled = (scaleH: number, bandHalfWidth: number): number[] => {
    const xs = layoutAt(scaleH, bandHalfWidth)
    if (!fillMode || xs.length < 2) return xs
    const firstX = Math.min(...xs)
    const span = Math.max(...xs) - firstX
    if (span <= 1e-6) return xs
    // ``bandHalfWidth`` sits on both ends: the leftmost column reaches
    // ``bandHalfWidth`` left of ``firstX`` (onto the axis) and the trailing
    // column ``bandHalfWidth`` + ``PROFILE_TRAILING_MM`` right of its centre.
    const targetLastCentre = fillTargetRightMm - bandHalfWidth - PROFILE_TRAILING_MM
    const k = (targetLastCentre - firstX) / span
    if (k <= 1) return xs
    return xs.map(x => firstX + (x - firstX) * k)
  }
  // Resolve the drawn column width + positions at a given horizontal scale.
  // Pass 1 seeds the (filled) layout at the readable minimum width to read the
  // on-paper column spacing; the drawn width is then a fixed fraction of the
  // nearest-neighbour spacing (clamped), so widely-spaced columns read as legible
  // strips rather than tall hairlines. Pass 2 re-lays and re-fills at that width
  // so the packing, the first-column offset and the trailing edge all use the
  // real drawn width. ``drawingRightMm`` is the profile's trailing edge: it fills
  // exactly to ``fillTargetRightMm`` when the layout fits (the fill stretched it
  // up), and overruns it when the columns are too wide to fit at this scale.
  const resolveLayout = (scaleH: number): {
    columnXmm: number[]; columnHalfWidthMm: number; drawingRightMm: number
  } => {
    const seedXmm = layoutFilled(scaleH, COLUMN_HALF_WIDTH_MM)
    const nearestGapMm = minAdjacentGapMm(seedXmm)
    const columnHalfWidthMm = nearestGapMm === null
      ? COLUMN_HALF_WIDTH_MM
      : Math.max(
          COLUMN_HALF_WIDTH_MM,
          Math.min(COLUMN_HALF_WIDTH_MAX_MM, COLUMN_WIDTH_SPACING_FRACTION * nearestGapMm),
        )
    const columnXmm = layoutFilled(scaleH, columnHalfWidthMm)
    const lastX = columnXmm.length > 0 ? Math.max(...columnXmm) : drawingLeftMm
    return { columnXmm, columnHalfWidthMm, drawingRightMm: lastX + columnHalfWidthMm + PROFILE_TRAILING_MM }
  }

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
    const widthFitH = fitWidthScaleH(input.columns)
    const heightFitH = DRAWING_HEIGHT_FIT_MM / (rangeM * vex)
    scaleH = Math.min(widthFitH, heightFitH)
    // "Fit to A3" (owner 2026-09-11): in fit mode the paper stays A3. The
    // readable minimum track width (COLUMN_HALF_WIDTH_MM) spreads crowded columns
    // apart, so at the length-fit scale the profile can overrun the A3 drawing
    // width. Reduce the horizontal scale until the spread columns fit — they keep
    // their true centres at the smaller scale and their 26 mm minimum spacing,
    // and the vertical follows (scaleV = scaleH × vex), so the exaggeration stays
    // honest and the drawing is a little shorter, never wider than A3. Only when
    // even the minimum spacing (every column at the floor) cannot fit does the
    // paper grow — there the length-fit scale is kept (true relative positions)
    // and the dialog's paper-size readout shows the wider sheet.
    if (fillMode && resolveLayout(scaleH).drawingRightMm > fillTargetRightMm + 1e-6) {
      // At scaleH → 0 every column packs to the 26 mm floor: the narrowest the
      // profile can be drawn. If even that overruns A3, the columns cannot fit
      // and the paper must grow (keep the length-fit scale below).
      if (resolveLayout(0).drawingRightMm <= fillTargetRightMm + 1e-6) {
        let lo = 0
        let hi = scaleH
        for (let i = 0; i < 40; i += 1) {
          const mid = (lo + hi) / 2
          if (resolveLayout(mid).drawingRightMm <= fillTargetRightMm + 1e-6) lo = mid
          else hi = mid
        }
        scaleH = lo
      }
    }
    scaleV = scaleH * vex
    drawingHeightMm = Math.max(MIN_DRAWING_HEIGHT_MM, rangeM * scaleV)
  }

  const { columnXmm, columnHalfWidthMm, drawingRightMm } = resolveLayout(scaleH)
  const naturalWidth = drawingRightMm + GUTTER_MM + RIGHT_COLUMN_MM + MARGIN_MM
  // A fit-mode layout that exactly fills the A3 drawing width lands
  // ``naturalWidth`` on PAPER_MIN_WIDTH_MM to the micron; the tolerance keeps
  // sub-micron floating dust (from the scale re-fit's binary search) from
  // rounding a full-A3 sheet up to 421 mm. A genuine overflow is far past it.
  const paperWidthMm = Math.max(PAPER_MIN_WIDTH_MM, Math.ceil(naturalWidth - 1e-6))
  const rightColumnLeftMm = paperWidthMm - MARGIN_MM - RIGHT_COLUMN_MM
  return {
    paperWidthMm,
    paperHeightMm: Math.max(PAPER_HEIGHT_MM, Math.ceil(drawingHeightMm + VERTICAL_CHROME_MM)),
    drawingHeightMm,
    drawingLeftMm,
    drawingTopMm: MARGIN_MM + TOP_BAND_MM,
    drawingWidthMm: rightColumnLeftMm - GUTTER_MM - drawingLeftMm,
    drawingRightMm,
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
