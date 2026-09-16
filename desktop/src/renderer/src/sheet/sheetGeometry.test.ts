import { describe, expect, it } from 'vitest'
import { computeSheetGeometry, pageFillingVex, VEX_SLIDER_MAX } from './sheetGeometry'
import {
  COLUMN_HALF_WIDTH_MAX_MM, COLUMN_HALF_WIDTH_MM, COLUMN_HEADER_MIN_HALF_WIDTH_MM,
  DRAWING_HEIGHT_FIT_MM, GUTTER_MM, MAP_HEIGHT_MM, MAP_LEGEND_GAP_MM, MARGIN_MM,
  MIN_PAPER_HEIGHT_MM, PAPER_HEIGHT_MM, PAPER_MAX_WIDTH_MM, PAPER_MIN_WIDTH_MM,
  PROFILE_TRAILING_MM, SCALE_LINE_MM, TITLE_BLOCK_MM, VERTICAL_CHROME_MM,
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
    // The sheet is no longer padded to full A3 height: the taller drawing makes
    // the PAGE taller too (debt #285), with no white band under it. It never gets
    // NARROWER — the width and horizontal scale are unchanged above.
    expect(v20.paperHeightMm).toBeGreaterThan(v10.paperHeightMm)
    expect(v20.paperHeightMm).toBe(Math.ceil(v20.drawingHeightMm + VERTICAL_CHROME_MM))
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

// Owner, installer #42 dogfeed (2026-09-16, verbatim): "the cpt's are too
// stretched vertically and not enough horizontally which kinda makes them
// unreadable." On his 563 m by ~20 m section at fit + page-fill the horizontal
// scale was H 1:2382, so each qc / Rf track drew only a few mm wide while 250 mm
// tall — unreadable spikes. A CPT track therefore has a readable MINIMUM width on
// paper, independent of the horizontal scale; where the widened tracks no longer
// fit, the columns spread apart (and the paper grows) so the traces stay legible.
describe('computeSheetGeometry — a CPT track has a readable minimum width', () => {
  // 12 mm on A3: a qc track reading 0..40 MPa with its 2 / 10 MPa interior
  // references and the right-edge scale label needs ~12 mm to read (0.3 mm/MPa);
  // it clears the 8 mm header threshold so the "what is what" header always
  // prints; it stays under the 18 mm cap so widely-spaced columns still widen.
  const READABLE_MIN_TRACK_MM = 12
  // A long section crowded with CPTs — the shape of the owner's report: at fit
  // the spacing-derived width would collapse toward the old 5 mm floor.
  const crowded = {
    levelMaxM: 5,
    levelMinM: -20,
    columns: Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, alongM: i * 24 })),
  }

  it('a CPT track on the sheet is never narrower than the readable minimum, whatever the horizontal scale', () => {
    // Fit at several exaggerations (the page-fill value included) and the owner's
    // own explicit H 1:2382 — every one keeps the track at least the minimum.
    for (const vex of [1, 5, 20, 29]) {
      const g = computeSheetGeometry({ ...crowded, scaleMode: 'fit', hScale: null, vScale: null, vex, spacing: 1 })
      expect(g.columnHalfWidthMm).toBeGreaterThanOrEqual(READABLE_MIN_TRACK_MM)
    }
    const owner = computeSheetGeometry({ ...crowded, scaleMode: 'explicit', hScale: 2382, vScale: 81, vex: 5, spacing: 1 })
    expect(owner.columnHalfWidthMm).toBeGreaterThanOrEqual(READABLE_MIN_TRACK_MM)
  })

  it('at a coarse horizontal scale the track keeps its true centre and grows to the minimum width', () => {
    const g = computeSheetGeometry({ ...crowded, scaleMode: 'fit', hScale: null, vScale: null, vex: 20, spacing: 1 })
    // Crowded columns cannot each be scale-wide, so the width grows exactly to
    // the readable minimum — not below it.
    expect(g.columnHalfWidthMm).toBeCloseTo(READABLE_MIN_TRACK_MM, 6)
    // Each column stays on its own along-section centre: the layout keeps the
    // order and spreads the columns so the widened tracks (± a full half-width
    // each side) never overlap.
    const xs = [...g.columnXmm]
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1])
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(2 * g.columnHalfWidthMm - 1e-6)
    }
  })

  it('at a fine horizontal scale the track keeps its scale-derived width, no shrink', () => {
    // Few, widely-drawn columns: the width follows the on-paper spacing — above
    // the readable minimum, up to the cap. Raising the floor never shrinks it.
    const wide = { levelMaxM: 5, levelMinM: -20, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 100 }, { id: 'c', alongM: 400 }] }
    const g = computeSheetGeometry({ ...wide, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 1 })
    expect(g.columnHalfWidthMm).toBeGreaterThan(READABLE_MIN_TRACK_MM)
    expect(g.columnHalfWidthMm).toBeLessThanOrEqual(COLUMN_HALF_WIDTH_MAX_MM)
  })

  it('the readable minimum track always prints its qc / Rf scale header', () => {
    // The per-column "what is what" header prints once a column reaches
    // COLUMN_HEADER_MIN_HALF_WIDTH_MM; the readable minimum clears it, so every
    // CPT column on the sheet now shows its qc / Rf ticks.
    expect(COLUMN_HALF_WIDTH_MM).toBeGreaterThanOrEqual(COLUMN_HEADER_MIN_HALF_WIDTH_MM)
  })
})

// Owner ruling 2026-09-11 "Fit to A3": in fit mode the paper STAYS A3 — the
// drawing fits the A3 width and the vertical follows the exaggeration. The
// readable minimum track width (installer #42) spreads crowded columns apart, so
// at the length-fit scale a real section can push the profile past the A3 width.
// Rather than growing the paper (which would break "Fit to A3"), the horizontal
// scale is reduced until the spread columns fit A3; the columns keep their true
// centres at the smaller scale and their 26 mm minimum spacing. Only when even
// the minimum spacing cannot fit does the paper grow.
describe('computeSheetGeometry — fit mode keeps the A3 paper', () => {
  // His Cross-section 1: 9 tests over 563 m by ~21 m, with a few close pairs
  // (e.g. two tests ~15 mm apart on paper) whose readable tracks push them apart.
  const cs1 = {
    levelMaxM: 3,
    levelMinM: -18,
    columns: [0, 120, 240, 300, 335, 370, 405, 480, 563].map((alongM, i) => ({ id: `t${i}`, alongM })),
  }

  it('in fit mode the paper stays A3 when the readable tracks push the columns apart', () => {
    const g = computeSheetGeometry({ ...cs1, scaleMode: 'fit', hScale: null, vScale: null, vex: pageFillingVex(cs1), spacing: 1 })
    expect(g.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
    // The page stays A3 WIDTH (420) — the scale re-fit keeps the spread columns
    // inside the A3 drawing width. The HEIGHT now follows the drawing (debt #285):
    // at cs1's page-filling exaggeration the width re-fit leaves the drawing about
    // 224 mm tall, so the honest page is that plus chrome, not a padded 297.
    expect(g.paperHeightMm).toBe(Math.ceil(g.drawingHeightMm + VERTICAL_CHROME_MM))
    // The tracks are still at least the readable minimum, and the profile's
    // trailing edge lands inside the A3 drawing area (no overrun, no wider paper).
    expect(g.columnHalfWidthMm).toBeGreaterThanOrEqual(12)
    const profileRight = Math.max(...g.columnXmm) + g.columnHalfWidthMm + PROFILE_TRAILING_MM
    expect(profileRight).toBeLessThanOrEqual(g.rightColumnLeftMm - GUTTER_MM + 1e-6)
  })

  it('only when the columns cannot fit at any scale does the paper grow', () => {
    // Nine spread tests fit the A3 width at a reduced scale (above).
    const fits = computeSheetGeometry({ ...cs1, scaleMode: 'fit', hScale: null, vScale: null, vex: pageFillingVex(cs1), spacing: 1 })
    expect(fits.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
    // Far more tests than the A3 drawing width can hold at the 26 mm minimum
    // spacing: the scale cannot shrink enough, so the paper grows (the dialog's
    // paper-size readout then shows the wider sheet).
    const tooMany = {
      levelMaxM: 3,
      levelMinM: -18,
      columns: Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, alongM: i * 24 })),
    }
    const grown = computeSheetGeometry({ ...tooMany, scaleMode: 'fit', hScale: null, vScale: null, vex: pageFillingVex(tooMany), spacing: 1 })
    expect(grown.paperWidthMm).toBeGreaterThan(PAPER_MIN_WIDTH_MM)
  })

  it('explicit scale mode keeps growing the paper — the engineer chose the scale', () => {
    // Fit-to-A3 is fit-mode only. In explicit mode a chosen coarse scale that
    // spreads the columns past A3 still grows the paper (the user asked for it).
    const g = computeSheetGeometry({ ...cs1, scaleMode: 'explicit', hScale: 100, vScale: 100, vex: 5, spacing: 1 })
    expect(g.paperWidthMm).toBeGreaterThan(PAPER_MIN_WIDTH_MM)
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

// Debt #285 (owner, installer #44, 2026-09-16): "when i turn down the height
// exaggeration the cpt's become even more readable but there is a lot of
// whitespace below, of course the bottom should come up so it better fits the
// page." The drawing gets shorter as the exaggeration drops, but the page used
// to keep the full A3 height, so a wide white band opened under the profile. Now
// the page height follows the drawing: paper = the drawing plus its fixed chrome,
// floored only at the room the right column (map inset, legend, title block)
// needs.
describe('computeSheetGeometry — the sheet bottom follows the drawing (debt #285)', () => {
  const long = { ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 450 }, { id: 'c', alongM: 900 }] }

  it('when the exaggeration goes down the bottom of the sheet comes up: no white band under the profile', () => {
    const full = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: pageFillingVex(long), spacing: 1 })
    const lower = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: 20, spacing: 1 })
    // Turning the exaggeration down shortens the drawing and the page comes up with it.
    expect(lower.drawingHeightMm).toBeLessThan(full.drawingHeightMm)
    expect(lower.paperHeightMm).toBeLessThan(full.paperHeightMm)
    // No white band: the page is exactly the drawing plus its fixed chrome.
    expect(lower.paperHeightMm).toBe(Math.ceil(lower.drawingHeightMm + VERTICAL_CHROME_MM))
  })

  it('at the page-filling exaggeration the sheet is unchanged', () => {
    // Where the drawing genuinely fills the A3 drawing area (a width-comfortable
    // profile), the page stays a full A3 — 420 x 297, no change.
    const g = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: pageFillingVex(long), spacing: 1 })
    expect(g.drawingHeightMm).toBeCloseTo(DRAWING_HEIGHT_FIT_MM, 3)
    expect(g.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
    expect(g.paperHeightMm).toBe(PAPER_HEIGHT_MM)
  })

  it('the map inset and the title block keep their room', () => {
    // A very low exaggeration draws almost nothing, but the page never shrinks
    // below the right column's fixed stack, so the map inset (top) and the title
    // block (bottom) still fit without overlapping.
    const g = computeSheetGeometry({ ...long, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 1 })
    expect(g.paperHeightMm).toBe(Math.ceil(MIN_PAPER_HEIGHT_MM))
    const rightColumnHeightMm = g.paperHeightMm - 2 * MARGIN_MM
    expect(rightColumnHeightMm).toBeGreaterThanOrEqual(
      MAP_HEIGHT_MM + MAP_LEGEND_GAP_MM + TITLE_BLOCK_MM + SCALE_LINE_MM,
    )
  })

  it('explicit mode also pulls the bottom up under the profile — no dead band', () => {
    // The engineer chose a fine scale that makes a short drawing; the page still
    // should not carry a dead band below it (range 25 m at V 1:200 draws 125 mm).
    const g = computeSheetGeometry({ ...base, scaleMode: 'explicit', hScale: 2000, vScale: 200, vex: 5, spacing: 1 })
    expect(g.paperHeightMm).toBe(Math.ceil(Math.max(MIN_PAPER_HEIGHT_MM, g.drawingHeightMm + VERTICAL_CHROME_MM)))
    expect(g.paperHeightMm).toBeLessThan(PAPER_HEIGHT_MM)
  })
})
