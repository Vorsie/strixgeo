import { describe, expect, it } from 'vitest'
import { computeSheetGeometry } from './sheetGeometry'
import {
  COLUMN_HALF_WIDTH_MAX_MM, COLUMN_HALF_WIDTH_MM,
  DRAWING_HEIGHT_FIT_MM, PAPER_HEIGHT_MM, PAPER_MAX_WIDTH_MM, PAPER_MIN_WIDTH_MM,
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
    expect(packed.columnXmm[2] - packed.columnXmm[1]).toBeLessThan(wide.columnXmm[2] - wide.columnXmm[1])
    expect(wide.columnXmm[2]).toBeGreaterThan(wide.columnXmm[1])
  })
  it('explicit mode: typed scales win, vex is derived, the page grows past A3 when the drawing needs it', () => {
    const g = computeSheetGeometry({ ...base, scaleMode: 'explicit', hScale: 1000, vScale: 50, vex: 5, spacing: 1 })
    expect(g.scaleHmmPerM).toBeCloseTo(1, 6)
    expect(g.scaleVmmPerM).toBeCloseTo(20, 6)
    expect(g.vexEffective).toBeCloseTo(20, 6)
    expect(g.drawingHeightMm).toBeCloseTo(500, 6)
    expect(g.paperHeightMm).toBeGreaterThan(PAPER_HEIGHT_MM)
  })
  // Owner finding 2026-09-04: at his fit-mode result the columns are drawn at a
  // fixed on-paper width, so on a very wide sheet every column is a tall
  // hairline. The drawn width must follow the on-paper column spacing.
  it('a wider column spacing draws wider columns; the width never drops under the minimum nor exceeds the cap', () => {
    const cols = [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 60 }, { id: 'c', alongM: 120 }]
    const spread = computeSheetGeometry({ ...base, columns: cols, scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    const packed = computeSheetGeometry({ ...base, columns: cols, scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 0 })
    // Columns sitting far apart on paper are drawn wider than the same columns packed.
    expect(spread.columnHalfWidthMm).toBeGreaterThan(packed.columnHalfWidthMm)
    // The floor holds when columns are packed edge-to-edge…
    expect(packed.columnHalfWidthMm).toBeGreaterThanOrEqual(COLUMN_HALF_WIDTH_MM)
    // …and a lone column (no neighbour to measure against) falls back to it.
    const single = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    expect(single.columnHalfWidthMm).toBe(COLUMN_HALF_WIDTH_MM)
    // The cap holds when the columns are drawn very far apart.
    const huge = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 5000 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 1 })
    expect(huge.columnHalfWidthMm).toBe(COLUMN_HALF_WIDTH_MAX_MM)
    expect(spread.columnHalfWidthMm).toBeLessThanOrEqual(COLUMN_HALF_WIDTH_MAX_MM)
  })

  it('a sheet past the width cap is flagged, never clipped', () => {
    const g = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 50_000 }], scaleMode: 'explicit', hScale: 100, vScale: 100, vex: 1, spacing: 1 })
    expect(g.paperWidthMm).toBeGreaterThan(PAPER_MAX_WIDTH_MM)
    expect(g.overCap).toBe(true)
  })
})
