/**
 * PHASE 2 — THE FILL, for the ground no construct claims: THE MATRIX.
 *
 * Owner, 2026-08-19: *"the lines are the structural framework, the fill is to
 * fill all gaps, the merge is to reduce the dimensions to a manageable level"*.
 * The constructs (``constructs.ts``) draw the framework; every loop they leave
 * over is matrix, and this module says who owns it. It invents nothing: the
 * answer is always a band a real test measured, of this family's own soil.
 *
 * THE STANDING RULINGS, asked in the order of what actually read the ground:
 *
 *  1. **The test that read this level owns it** — the gap's own two tests
 *     first (2026-08-11: *"we correlate over the boreholes from cpt to cpt ...
 *     section is the guideline"*, and the 623 m donor he rejected), nearest
 *     first, and only where NEITHER of them carries this body does a test
 *     further along answer. Below a short test's TD only the deep test read the
 *     ground, so its stack extends whole — the adoption the owner asked for:
 *     *"Below TD there is a SF on the test to the right that gets adopted ...
 *     there the SF silt is one band"*.
 *  2. **A band that already closed its own loop does not answer again past
 *     it** — the enclosed interbed's level beyond its lens apex belongs to the
 *     WRAPPER, the class that encloses it on that same test (*"top circle
 *     should be a lens"*). The wrapper is read on the interbed's OWN column,
 *     never fetched from another test: the level is that test's reading.
 *  3. **A closed form floods from its own wall** — where no test read the level
 *     at all, the nearest band whose own 2/1/0 ENVELOPE reaches it answers:
 *     *"we have a closed form, the only thing left that can flood that form is
 *     the MF silt to the left"*. The envelope is the band's own extent unioned
 *     with the lines it carries — its packing ties, and its parent litho unit's
 *     ties, because litho approval carries down (ruling A). It is the same
 *     envelope the 2/1/0 conformance gate audits against, so the fill and the
 *     gate cannot disagree.
 *
 * Ground no rule above can answer stays unclaimed and renders "correlate me",
 * which is the truth: nothing read it.
 *
 * @module utils/geotechHierarchicalFill/constructive/matrixOwner
 */

import type { RunBand } from './constructs'

/** A line a band carries across this gap — a tie of its own, or its unit's. */
export interface ReachLine {
  leftX: number
  leftY: number
  rightX: number
  rightY: number
}

/** One test that can answer for this gap's ground. */
export interface MatrixReader {
  ci: number
  x: number
  /** Its bands of this family, shallowest first. */
  bands: RunBand[]
  /**
   * The lines each band carries across this gap: its own packing ties, and its
   * parent litho unit's ties (litho approval carries down). Its envelope at a
   * point is its own extent unioned with those lines AT THAT POINT — a band
   * follows the line it carries, so its reach dips and rises with the line
   * rather than squaring off at the line's far end. Keyed by ``layerId``; a
   * band with no entry reaches its own extent only.
   */
  reach: ReadonlyMap<string, readonly ReachLine[]>
  /** Whether it is one of the two tests the gap's own run runs between. */
  flank: boolean
}

/** A line's elevation at along-x (flat outside its own span is never needed). */
function lineAt(line: ReachLine, x: number): number {
  const width = line.rightX - line.leftX
  if (Math.abs(width) < 1e-9) return line.leftY
  return line.leftY + ((x - line.leftX) / width) * (line.rightY - line.leftY)
}

/** Elevation windows each band's own construct already claims in this gap. */
export type ClosedWindows = ReadonlyMap<string, { lo: number; hi: number }>

/** The band of ``bands`` whose interval contains ``elevation``, or null. */
function bandAt(bands: readonly RunBand[], elevation: number): RunBand | null {
  for (const band of bands) {
    if (elevation <= band.top && elevation >= band.base) return band
  }
  return null
}

/** Has this band's own construct already spoken for this level in this gap? */
function closedAt(closed: ClosedWindows, layerId: string, elevation: number): boolean {
  const window = closed.get(layerId)
  return window !== undefined && elevation <= window.hi && elevation >= window.lo
}

/**
 * The nearest band of ONE test that may answer at ``elevation`` — nearest by
 * elevation, skipping bands that closed here, and only within the band's own
 * 2/1/0 envelope.
 */
function nearestWithinReach(
  reader: MatrixReader,
  x: number,
  elevation: number,
  closed: ClosedWindows,
): RunBand | null {
  let best: RunBand | null = null
  let bestDistance = Infinity
  for (const band of reader.bands) {
    if (closedAt(closed, band.layerId, elevation)) continue
    let hi = band.top
    let lo = band.base
    for (const line of reader.reach.get(band.layerId) ?? []) {
      const at = lineAt(line, x)
      hi = Math.max(hi, at)
      lo = Math.min(lo, at)
    }
    if (elevation > hi || elevation < lo) continue
    const distance =
      elevation > band.top ? elevation - band.top : elevation < band.base ? band.base - elevation : 0
    if (distance < bestDistance) {
      bestDistance = distance
      best = band
    }
  }
  return best
}

/**
 * Order the readers for ONE point: the gap's own two tests first (nearest
 * first), then the family's other tests by distance. Per point, not per face —
 * a wide loop's left end and right end need not have the same answer.
 */
function readersNearest(readers: readonly MatrixReader[], x: number): MatrixReader[] {
  return [...readers].sort((a, b) => {
    if (a.flank !== b.flank) return a.flank ? -1 : 1
    return Math.abs(a.x - x) - Math.abs(b.x - x)
  })
}

/**
 * Who owns one point of matrix ground.
 *
 * @param x Along-section position of the point, in metres.
 * @param y Its elevation.
 * @param readers Every test of the family that can answer (see
 *   {@link MatrixReader}).
 * @param closed What each band's own construct already claims in this gap.
 * @returns The owning band, or null when nothing read this ground.
 */
export function matrixOwner(
  x: number,
  y: number,
  readers: readonly MatrixReader[],
  closed: ClosedWindows,
): RunBand | null {
  const order = readersNearest(readers, x)
  // 1 + 2. The test that read this level, nearest first; where its band closed
  //        its own loop here, that test's wrapper answers instead.
  for (const reader of order) {
    const band = bandAt(reader.bands, y)
    if (band === null) continue
    if (!closedAt(closed, band.layerId, y)) return band
    const wrapper = nearestWithinReach(reader, x, y, closed)
    if (wrapper !== null) return wrapper
  }
  // 3. Nothing could answer the level: the ground is a form the constructs
  //    closed around, and its only legal filler is the wall of that form —
  //    *"we have a closed form, the only thing left that can flood that form is
  //    the MF silt to the left"*. Gating this on "nobody read the level" was
  //    tried and MEASURED: it hatched 13 pp of Tie-section 11 and 10 pp of
  //    Tie-section 4 without fixing anything, because the common case here is a
  //    level one test read and CLOSED (its lens) whose wrapper cannot reach —
  //    exactly the closed form this rule exists for.
  for (const reader of order) {
    const wall = nearestWithinReach(reader, x, y, closed)
    if (wall !== null) return wall
  }
  return null
}
