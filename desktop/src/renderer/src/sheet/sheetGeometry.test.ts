import { describe, expect, it } from 'vitest'
import { computeSheetGeometry, pageFillingVex, VEX_SLIDER_MAX } from './sheetGeometry'
import {
  COLUMN_HALF_WIDTH_MAX_MM, COLUMN_HALF_WIDTH_MM,
  DRAWING_HEIGHT_FIT_MM, GUTTER_MM, PAPER_HEIGHT_MM, PAPER_MAX_WIDTH_MM, PAPER_MIN_WIDTH_MM,
  PROFILE_TRAILING_MM,
} from './sheetConstants'

const base = {
  levelMaxM: 5, levelMinM: -20,                 // range 25 m
  columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 100 }, { id: 'c', alongM: 400 }],
}

describe('computeSheetGeometry — the sheet fits the profile', () => {
  // Owner 2026-09-11 (sheet on the geotech axis): "columns do not rescale with
  // height exaggeration ... fit mode, i expected them to stretch taller too
  // and of course wider." Fit mode used to pin the drawing HEIGHT to the page
  // and let the exaggeration eat the width, so more exaggeration made the
  // section shorter on paper and the columns narrower. Fit mode now fits the
  // A3 WIDTH; the vertical follows the exaggeration until the page height is
  // reached, and only then does the whole drawing shrink to keep the
  // exaggeration honest.
  const long = { ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 450 }, { id: 'c', alongM: 900 }] }
  it('fit mode: more exaggeration makes the drawing taller, not the sheet narrower', () => {
    // 10 and 20 rather than 5 and 10: at 5 the 25 m range draws 33 mm tall and
    // the drawing box sits on its 60 mm floor, which would hide the doubling.
    const v10 = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: 10, spacing: 1 })
    const v20 = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: 20, spacing: 1 })
    expect(v20.scaleVmmPerM).toBeCloseTo(v10.scaleVmmPerM * 2, 6)
    expect(v20.drawingHeightMm).toBeCloseTo(v10.drawingHeightMm * 2, 3)
    expect(v20.scaleHmmPerM).toBeCloseTo(v10.scaleHmmPerM, 6)
    expect(v20.paperWidthMm).toBe(v10.paperWidthMm)
    expect(v20.columnHalfWidthMm).toBeCloseTo(v10.columnHalfWidthMm, 6)
    expect(v20.vexEffective).toBeCloseTo(20, 6)
    expect(v20.paperHeightMm).toBe(PAPER_HEIGHT_MM)
  })
  it('fit mode: the drawing never grows past the page; beyond that the whole drawing shrinks and keeps the exaggeration', () => {
    const g = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: 40, spacing: 1 })
    expect(g.drawingHeightMm).toBeCloseTo(DRAWING_HEIGHT_FIT_MM, 6)
    expect(g.scaleVmmPerM).toBeCloseTo(DRAWING_HEIGHT_FIT_MM / 25, 6)
    expect(g.scaleHmmPerM).toBeCloseTo(g.scaleVmmPerM / 40, 6)
    expect(g.vexEffective).toBeCloseTo(40, 6)
    expect(g.paperHeightMm).toBe(PAPER_HEIGHT_MM)
    expect(g.printedV).toBe(Math.round(1000 / g.scaleVmmPerM))
    expect(g.printedH).toBe(Math.round(1000 / g.scaleHmmPerM))
  })
  it('fit mode: a long profile fits the A3 width at any exaggeration', () => {
    for (const vex of [1, 5, 10]) {
      const g = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex, spacing: 1 })
      expect(g.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
    }
  })
  it('a short profile still gets a full A3 width', () => {
    const g = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 20 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    expect(g.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
  })
  it('fit mode: packing the columns moves them closer on the same A3 sheet', () => {
    const wide = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 1 })
    const packed = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 0 })
    expect(packed.paperWidthMm).toBeLessThanOrEqual(wide.paperWidthMm)
    // Packing keeps the far-apart pair (b→c, 300 m real) closer than the true
    // distance does; both now fill the same A3 sheet (owner, installer #40).
    expect(packed.columnXmm[2] - packed.columnXmm[1]).toBeLessThan(wide.columnXmm[2] - wide.columnXmm[1])
    expect(wide.columnXmm[2]).toBeGreaterThan(wide.columnXmm[1])
  })

  // Owner, installer #40 (verbatim): "pdf fit to A3 and column spacing all the
  // way down has a lot of white space between the profile and the map on the
  // right?" Fit mode fitted the profile LENGTH into the drawing width at
  // spacing 1; pulling the spacing slider down packed the columns into a narrow
  // cluster on the left and opened a wide white gap before the right column.
  // The rule: in fit mode the spacing decides how the columns SHARE the width,
  // not how much of the page the profile uses — so the profile fills the drawing
  // width at EVERY spacing (the horizontal scale re-fits after the spacing is
  // applied). ``drawingRightMm`` is the profile's trailing edge; the drawing
  // area ends one gutter before the right column, at ``rightColumnLeftMm − GUTTER``.
  it('fit mode: the profile fills the drawing width at minimum spacing', () => {
    const g = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 0 })
    const profileRight = Math.max(...g.columnXmm) + g.columnHalfWidthMm + PROFILE_TRAILING_MM
    expect(profileRight).toBeCloseTo(g.rightColumnLeftMm - GUTTER_MM, 3)
    // The profile spans the whole drawing area, no white gap before the map.
    expect(profileRight - g.drawingLeftMm).toBeCloseTo(g.drawingWidthMm, 3)
    // ``drawingRightMm`` reports that same trailing edge.
    expect(g.drawingRightMm).toBeCloseTo(profileRight, 6)
  })
  it('fit mode: the profile fills the drawing width at maximum spacing', () => {
    // A profile with one tight pair draws narrow columns, so even at spacing 1
    // the old width fit left a reserve gap; the fill closes it too.
    const tight = { ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 20 }, { id: 'c', alongM: 900 }] }
    const g = computeSheetGeometry({ ...tight, scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    const profileRight = Math.max(...g.columnXmm) + g.columnHalfWidthMm + PROFILE_TRAILING_MM
    expect(profileRight).toBeCloseTo(g.rightColumnLeftMm - GUTTER_MM, 3)
  })
  it('fit mode: the right column starts right after the profile trailing margin, whatever the spacing', () => {
    for (const spacing of [0, 0.25, 0.5, 0.75, 1]) {
      const g = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing })
      const profileRight = Math.max(...g.columnXmm) + g.columnHalfWidthMm + PROFILE_TRAILING_MM
      expect(g.rightColumnLeftMm).toBeCloseTo(profileRight + GUTTER_MM, 2)
    }
  })
  it('explicit mode leaves the white space it is asked for — the fill is fit-mode only', () => {
    // Owner: the explicit H/V scale mode is untouched (there the spacing may
    // leave white space by design). At a coarse H scale a packed profile does
    // NOT reach the drawing-area edge.
    const g = computeSheetGeometry({ ...long, scaleMode: 'explicit', hScale: 20000, vScale: 500, vex: 5, spacing: 0 })
    const profileRight = Math.max(...g.columnXmm) + g.columnHalfWidthMm + PROFILE_TRAILING_MM
    expect(profileRight).toBeLessThan(g.rightColumnLeftMm - GUTTER_MM)
  })
  it('explicit mode: typed scales win, vex is derived, the page grows past A3 when the drawing needs it', () => {
    const g = computeSheetGeometry({ ...base, scaleMode: 'explicit', hScale: 1000, vScale: 50, vex: 5, spacing: 1 })
    expect(g.scaleHmmPerM).toBeCloseTo(1, 6)
    expect(g.scaleVmmPerM).toBeCloseTo(20, 6)
    expect(g.vexEffective).toBeCloseTo(20, 6)
    expect(g.drawingHeightMm).toBeCloseTo(500, 6)
    expect(g.paperHeightMm).toBeGreaterThan(PAPER_HEIGHT_MM)
  })
  // Owner finding 2026-09-04: the columns must not be drawn at a fixed on-paper
  // width, else every column is a tall hairline on a wide sheet. The drawn width
  // follows the on-paper column spacing. RETARGET (installer #40): fit mode now
  // fills the drawing width at every spacing, so the on-paper spacing is set by
  // how many columns share that width — FEWER columns draw wider than MANY. (The
  // old spacing-slider spread/packed comparison encoded the pre-#40 fit, where a
  // packed profile clustered narrow; it no longer distinguishes width.)
  it('the drawn column width follows the on-paper spacing; the width never drops under the minimum nor exceeds the cap', () => {
    const few = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 60 }, { id: 'c', alongM: 120 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    const many = computeSheetGeometry({ ...base, columns: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, alongM: i * 20 })), scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    // Fewer columns fill the width with wider on-paper gaps, so they draw wider.
    expect(few.columnHalfWidthMm).toBeGreaterThan(many.columnHalfWidthMm)
    // The floor holds when many columns crowd the width…
    expect(many.columnHalfWidthMm).toBeGreaterThanOrEqual(COLUMN_HALF_WIDTH_MM)
    // …and a lone column (no neighbour to measure against) falls back to it.
    const single = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    expect(single.columnHalfWidthMm).toBe(COLUMN_HALF_WIDTH_MM)
    // The cap holds when the columns are drawn far apart.
    const huge = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 5000 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 1 })
    expect(huge.columnHalfWidthMm).toBe(COLUMN_HALF_WIDTH_MAX_MM)
    expect(few.columnHalfWidthMm).toBeLessThanOrEqual(COLUMN_HALF_WIDTH_MAX_MM)
  })

  it('a sheet past the width cap is flagged, never clipped', () => {
    const g = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 50_000 }], scaleMode: 'explicit', hScale: 100, vScale: 100, vex: 1, spacing: 1 })
    expect(g.paperWidthMm).toBeGreaterThan(PAPER_MAX_WIDTH_MM)
    expect(g.overCap).toBe(true)
  })
})

// Owner 2026-09-11 on the first fit-to-width sheet: "a lot of white space on
// the pdf report no? Can't we give a better page fit to start?" At 1x a
// 900 m by 25 m profile is a strip along the top of the page. The sheet opens
// at the exaggeration that fills the page height on the A3 width.
describe('pageFillingVex — the exaggeration that fills the page', () => {
  const long = { ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 450 }, { id: 'c', alongM: 900 }] }
  it('at the page-filling exaggeration the drawing is exactly the page height on the A3 width', () => {
    const vex = pageFillingVex(long)
    const g = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex, spacing: 1 })
    expect(g.drawingHeightMm).toBeCloseTo(DRAWING_HEIGHT_FIT_MM, 3)
    expect(g.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
    expect(vex).toBeGreaterThan(1)
  })
  it('a short deep profile fills the page at no exaggeration and is never asked to go below 1x', () => {
    const short = { ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 20 }] }
    expect(pageFillingVex(short)).toBe(1)
  })
  it('the value is rounded to a tenth and capped at the slider maximum', () => {
    const vast = { ...base, levelMaxM: 0, levelMinM: -1, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 100000 }] }
    expect(pageFillingVex(vast)).toBe(VEX_SLIDER_MAX)
    expect(Number.isInteger(pageFillingVex(long) * 10)).toBe(true)
  })
})
