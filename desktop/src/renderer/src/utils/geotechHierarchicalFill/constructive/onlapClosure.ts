/**
 * THE ONLAP-CLOSURE TRIPWIRE — *"should be a triangle and not a quad"*.
 *
 * The owner has reported the same shape five times: a wedge that ends in a
 * VERTICAL EDGE at mid-gap instead of closing to a point. Each report was met
 * with a fix to WHO owned the offending loop; none of them stopped the loop
 * being minted, so the sixth report was always available. This module is the
 * check that makes the sixth one impossible to ship silently.
 *
 * THE INVARIANT, in the owner's own two rulings:
 *
 *  * 2026-08-22 — *"The loose sand has a bottom tie, not a top tie that is why
 *    it is an onlap and should be a triangle and not a quad"*.
 *  * 2026-08-20 — *"an onlap can't paint over ground near test itself, it
 *    terminates at 0.5 Distance approximately"*.
 *
 * Together: a mass that emitted an onlap in a gap must not carry a vertical
 * face strictly inside that gap. The wedge closes onto the contact it rides,
 * at the termination, as a point.
 *
 * WHAT IS DELIBERATELY NOT A VIOLATION. A vertical strictly inside the gap is
 * legal — it is the law's own seam — where the two masses meeting at it are
 * both OPEN: *"if it is different then vertical line in the middle"*, and the
 * stacked-seam fallback of 2026-08-25 whose step the owner accepted (*"The
 * different height is acceptable"*). So the sweep is scoped to masses that
 * actually emitted an onlap in that gap, read from the fill's own probe, and
 * says nothing about seams, lenses, or open spans.
 *
 * It reads the MERGED regions, not the raw construct faces: an onlap whose own
 * loop is a clean triangle can still be welded back into a quad by a same-class
 * face beside it, and that weld is exactly what the owner sees on screen.
 *
 * THE SIBLING CHECK — *"still not onlapping"* (2026-08-26). The sweep above can
 * only see a wedge that DREW something. The dogfeed of 2026-08-26 was the other
 * failure: S6's loose sand emitted its onlap, the probe recorded it, and the
 * band owned not one face — the medium sand beside it took the whole wedge, so
 * there was no vertical to find and nothing at all to report. That is the same
 * ruling broken from the other side (2026-08-22: *"where a band's own construct
 * speaks, it speaks COMPLETELY"*), and {@link silentConstructs} is the check for
 * it: a closed shape that terminates inside its own gap must own ground.
 *
 * @module utils/geotechHierarchicalFill/constructive/onlapClosure
 */

import type { ProbeEntry } from './fillGapProbe'
import type { SectionRegion } from '../../sectionPartition'

/**
 * Smallest elevation step (m) a vertical edge must span to count.
 *
 * Rings carry vertices on the mm grid and a merged outline routinely closes
 * with a sub-centimetre riser where two faces met; the owner's stubs are
 * decimetres to metres tall. 5 cm sits an order of magnitude below the
 * smallest real report (0.36 m) and an order above the grid noise.
 */
export const INTERIOR_VERTICAL_MIN_DROP = 0.05

/** How far inside (0, 1) a vertical must sit to be interior rather than a gap edge. */
const EDGE_EPS = 1e-6

/**
 * How close (in fraction) a vertical must stand to an onlap's termination to be
 * that onlap's own cut.
 *
 * The termination is a single computed fraction and the arrangement places its
 * vertices on it exactly, so this only has to absorb the mm-grid rounding a
 * merged outline carries — not a search radius. Wide enough and the seam
 * between two unrelated masses starts reading as a cut.
 */
const TERMINATION_EPS = 1e-3

/** One vertical edge found strictly inside a gap. */
export interface InteriorVertical {
  /** Where it stands, in the gap's own fraction space. */
  fraction: number
  /** Its lower and upper elevations (mTAW). */
  lo: number
  hi: number
}

/** One region that violates the closure invariant. */
export interface OnlapClosureViolation {
  gapIndex: number
  formationId: string
  /** The onlap-emitting layers this region carries. */
  onlapLayerIds: string[]
  vertical: InteriorVertical
}

/** One construct that emitted a closed shape and then owned no ground at all. */
export interface SilentConstruct {
  gapIndex: number
  /** The band's layer id — the same key the probe's faces carry as ``owner``. */
  layerId: string
  /** What it emitted: ``onlap`` or ``lens``. */
  emit: string
  /** Where it terminates, in the gap's own fraction space. */
  apexFraction: number
}

/**
 * Every construct that emitted a closed shape inside its gap and drew nothing.
 *
 * *"WHERE A BAND'S OWN CONSTRUCT SPEAKS, IT SPEAKS COMPLETELY"* — a lens or an
 * onlap whose apex falls strictly inside the gap holds real ground between its
 * two contacts, from its own column to that apex. Owning zero faces means the
 * ground went to somebody else, which is the 2026-08-26 dogfeed: the construct
 * was correct in the probe and absent from the screen.
 *
 * Two exclusions, both because the construct genuinely has no wedge HERE:
 *
 *  * a STACKED-SEAM run answers from the tests' own stacks and never consults a
 *    construct at all (the *"keep mtaw lvl"* fallback of 2026-08-25);
 *  * an EXTENDED construct's apex is the far column, and the taper it is part of
 *    closes in some other gap (see ``extendsToFar`` / ``carryApexX``). Its
 *    ``apexFraction`` is 0 or 1, so the interior test already excludes it; the
 *    explicit skip says so rather than relying on that.
 *
 * @param entries The drained ``fillGapProbe`` entries of one fill run.
 * @returns One entry per silent construct, empty when every closed shape drew.
 */
export function silentConstructs(entries: readonly ProbeEntry[]): SilentConstruct[] {
  const silent: SilentConstruct[] = []
  for (const entry of entries) {
    if (entry.stackedSeam) continue
    const owners = new Set(entry.faces.map((face) => face.owner).filter((id) => id !== null))
    for (const construct of entry.constructs) {
      if (construct.emit !== 'onlap' && construct.emit !== 'lens') continue
      if (construct.extendsToFar === true) continue
      const apex = construct.apexFraction
      if (apex === undefined || apex <= EDGE_EPS || apex >= 1 - EDGE_EPS) continue
      if (owners.has(construct.layer)) continue
      silent.push({
        gapIndex: entry.gapIndex,
        layerId: construct.layer,
        emit: construct.emit,
        apexFraction: apex,
      })
    }
  }
  return silent
}

/**
 * The vertical edges of one ring that stand strictly inside the gap.
 *
 * @param ring The region outline, in (fraction, elevation).
 * @param minDrop Smallest elevation span that counts; defaults to
 *   {@link INTERIOR_VERTICAL_MIN_DROP}.
 * @returns One entry per qualifying edge, in ring order.
 */
export function interiorVerticals(
  ring: readonly { fraction: number; elevation: number }[],
  minDrop: number = INTERIOR_VERTICAL_MIN_DROP,
): InteriorVertical[] {
  const found: InteriorVertical[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (Math.abs(a.fraction - b.fraction) > EDGE_EPS) continue
    if (a.fraction <= EDGE_EPS || a.fraction >= 1 - EDGE_EPS) continue
    if (Math.abs(a.elevation - b.elevation) <= minDrop) continue
    found.push({
      fraction: a.fraction,
      lo: Math.min(a.elevation, b.elevation),
      hi: Math.max(a.elevation, b.elevation),
    })
  }
  return found
}

/**
 * Where each onlap TERMINATES, per gap, from the fill's own probe.
 *
 * Stacked-seam runs are omitted entirely: there the vertical at the seam is the
 * *"keep mtaw lvl"* ruling of 2026-08-25 and its step is one the owner accepted,
 * so nothing in such a run can be a violation of this invariant.
 *
 * @param entries The drained ``fillGapProbe`` entries of one fill run.
 * @returns Gap index → (layer id → the fraction its onlap closes at).
 */
export function onlapTerminationsByGap(
  entries: readonly ProbeEntry[],
): Map<number, Map<string, number>> {
  const byGap = new Map<number, Map<string, number>>()
  for (const entry of entries) {
    if (entry.stackedSeam) continue
    for (const construct of entry.constructs) {
      if (construct.emit !== 'onlap' || construct.apexFraction === undefined) continue
      const byLayer = byGap.get(entry.gapIndex)
      if (byLayer === undefined) byGap.set(entry.gapIndex, new Map([[construct.layer, construct.apexFraction]]))
      else byLayer.set(construct.layer, construct.apexFraction)
    }
  }
  return byGap
}

/**
 * Every onlap that ends in a vertical FACE at its own termination.
 *
 * The invariant is narrow on purpose. A vertical face is only a defect where it
 * stands exactly where a wedge the region carries was supposed to close to a
 * point — *"should be a triangle and not a quad"*. A vertical anywhere else is
 * some other boundary: a band standing at its own test (the gap edges), or the
 * law's own seam between two open masses (*"if it is different then vertical
 * line in the middle"*), and neither is this rule's business.
 *
 * @param regions The MERGED regions the render draws.
 * @param terminationsByGap Gap index → layer id → termination fraction (see
 *   {@link onlapTerminationsByGap}).
 * @param minDrop Smallest elevation span that counts.
 * @returns One entry per offending vertical, empty when the invariant holds.
 */
export function onlapClosureViolations(
  regions: readonly SectionRegion[],
  terminationsByGap: ReadonlyMap<number, ReadonlyMap<string, number>>,
  minDrop: number = INTERIOR_VERTICAL_MIN_DROP,
): OnlapClosureViolation[] {
  const violations: OnlapClosureViolation[] = []
  for (const region of regions) {
    const terminations = terminationsByGap.get(region.gapIndex)
    if (terminations === undefined) continue
    const carried = (region.layerIds ?? []).filter((id) => terminations.has(id))
    if (carried.length === 0) continue
    for (const vertical of interiorVerticals(region.polygon, minDrop)) {
      const cuts = carried.filter(
        (id) => Math.abs((terminations.get(id) as number) - vertical.fraction) <= TERMINATION_EPS,
      )
      if (cuts.length === 0) continue
      violations.push({
        gapIndex: region.gapIndex,
        formationId: region.formationId,
        onlapLayerIds: cuts,
        vertical,
      })
    }
  }
  return violations
}
