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
  it('fit mode: V comes from the depth range over the 245 mm drawing, H from the exaggeration', () => {
    const g = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    expect(g.scaleVmmPerM).toBeCloseTo(DRAWING_HEIGHT_FIT_MM / 25, 6)
    expect(g.scaleHmmPerM).toBeCloseTo(g.scaleVmmPerM / 5, 6)
    expect(g.paperHeightMm).toBe(PAPER_HEIGHT_MM)
    expect(g.printedV).toBe(Math.round(1000 / g.scaleVmmPerM))
    expect(g.printedH).toBe(Math.round(1000 / g.scaleHmmPerM))
  })
  it('a short profile still gets a full A3 width', () => {
    const g = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 20 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    expect(g.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
  })
  it('a long profile at true distance makes a wider sheet than the same profile packed', () => {
    const wide = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 1 })
    const packed = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 0 })
    expect(wide.paperWidthMm).toBeGreaterThan(packed.paperWidthMm)
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
