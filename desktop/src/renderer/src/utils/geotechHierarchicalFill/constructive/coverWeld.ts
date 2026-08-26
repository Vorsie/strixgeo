/**
 * THE COVER WELD — when a LITHO boundary counts as a tied contact.
 *
 * Owner, 2026-08-26, shown CS1 gap 19's two top sands standing as two closed
 * loops with unclassed ground between them:
 *
 *   *"those top sands have an engine tie no? the tops of all tests are
 *    connected? follow the tie, same nad class, emit nothing...."*
 *
 * This REFINES Ruling A (2026-08-22, *"a boundary only: 2/1/0 counts packing
 * ties"*), it does not overturn it. Ruling A exists so a litho line can never
 * force a statement BETWEEN TWO PACKINGS — the wedge he circled on gap 0. That
 * danger only exists where the two ends differ. Where they are the SAME MASS
 * there is nothing to state: the two bands are one body, the law's own answer
 * for a tied contact whose far end matches is *"emit nothing"*, and refusing to
 * read the boundary at all is what left each sand emitting into a vacuum. So:
 *
 *   **a cover boundary reads as a TIED CONTACT when, and only when, the far
 *   band across it is the same litho and the same packing.**
 *
 * A cover boundary to a DIFFERENT mass keeps today's behaviour to the byte: it
 * counts nothing for ``emitFor``, and a STORED litho tie still lends it the
 * geometry Ruling A gives it.
 *
 * WHAT "CONNECTED" MEANS WHERE NO TIE IS STORED
 * ---------------------------------------------
 * Measured on the real CS1 fixture: gap 19's two sands carry NO stored litho
 * tie on their tops. Their tops are the model column's own top surface — depth
 * 1.60 m on both tests — and the litho stage has already drawn them as ONE
 * cover region spanning the gap. That is his *"the tops of all tests are
 * connected"*: the cover's own boundary is a single line whether or not anybody
 * ever drew a correlation along it. So an untied cover contact reads the facing
 * column's band at the SAME cover boundary, and the line it follows is the edge
 * between them — which is the cover ring's own edge, already in the fill's
 * arrangement.
 *
 * ...AND ONLY THE ENVELOPE, which is the whole of the guard. A family's cover
 * can MERGE several litho units (the litho fill folds a same-soil sandwich into
 * one region), and then a column carries several bands each sitting at its OWN
 * unit's boundary. Only the outermost pair — the shallowest band's top, the
 * deepest band's base — is the cover region's own edge; every inner one is a
 * boundary INSIDE the cover, connected to nothing in particular. Measured on
 * CS1 gap 0 while this rule was being written: without the envelope test, S10's
 * thin top silt welded its base at +11.68 to a same-class silt whose base is at
 * +5.59 on the facing test — two bases of two different units, six metres
 * apart, joined by a line nobody drew, and it broke the owner's own S16b
 * reading (*"top silt has only a top tie ... emit onlap"*).
 *
 * A STORED litho tie needs no such test: it IS the model saying these two
 * contacts are one boundary.
 *
 * Pure module. ``RunBand``/``RunColumn``/``RunTie`` are imported for their TYPE
 * only, so ``constructs.ts`` can depend on this at runtime without a cycle.
 *
 * @module utils/geotechHierarchicalFill/constructive/coverWeld
 */

import { sameMass, type Mass } from './emitKernel'
import { farBandOf } from './farBand'
import type { RunBand, RunColumn, RunTie } from './constructs'

/** What one of a band's contacts says when it sits on the cover's own boundary. */
export interface CoverContact {
  /**
   * The line the contact lies on — the stored litho tie, or the cover's own
   * edge to the facing column's band at the same boundary.
   */
  tie: RunTie
  /**
   * Whether that line is a STORED, accepted litho correlation. Ruling A already
   * rides these whatever the far mass reads; an implicit cover edge is ridden
   * only when it welds.
   */
  stored: boolean
  /**
   * *"follow the tie, same nad class, emit nothing"* — the far band across the
   * boundary is the same mass, so this contact counts as TIED for the law.
   */
  welds: boolean
}

/** The cover edge between two bands' contacts, ordered left to right by along-x. */
function coverEdge(
  band: RunBand,
  elevation: number,
  far: RunBand,
  farElevation: number,
): RunTie {
  const near = { ci: band.ci, x: band.x, y: elevation }
  const other = { ci: far.ci, x: far.x, y: farElevation }
  const [lo, hi] = near.x <= other.x ? [near, other] : [other, near]
  return {
    key: `cover:${lo.ci}@${lo.y}~${hi.ci}@${hi.y}`,
    leftCi: lo.ci,
    rightCi: hi.ci,
    leftX: lo.x,
    rightX: hi.x,
    leftY: lo.y,
    rightY: hi.y,
  }
}

/**
 * The band holding the cover's OWN edge on one column: the shallowest band's
 * top, the deepest band's base. Every other contact of the stack lies inside
 * the cover and is a boundary between two of its packings, not the cover's.
 */
function envelopeBandOf(column: RunColumn, side: 'top' | 'base'): RunBand | null {
  let best: RunBand | null = null
  for (const candidate of column.bands) {
    if (best === null || (side === 'top' ? candidate.top > best.top : candidate.base < best.base)) {
      best = candidate
    }
  }
  return best
}

/**
 * What one contact of a band says, given that it IS the parent litho unit's own
 * boundary and carries no packing tie across this gap.
 *
 * @param band The band whose contact is being read.
 * @param side Which of its two contacts — ``top`` or ``base``.
 * @param storedTie The accepted litho tie on that contact, or null when none is
 *   stored (the caller resolves it exactly as it resolves packing ties).
 * @param column The band's own banded column of this family.
 * @param facing The gap's OTHER banded column of this family.
 * @param stacks EVERY packing band per column — the far end across a stored tie
 *   may belong to a neighbouring family, and its mass still decides.
 * @param own The band's own mass.
 * @param massOf The mass (litho + packing) of a band.
 * @returns The contact's reading, or null where the cover states nothing here.
 */
export function coverContactOf(
  band: RunBand,
  side: 'top' | 'base',
  storedTie: RunTie | null,
  column: RunColumn,
  facing: RunColumn,
  stacks: ReadonlyMap<number, readonly RunBand[]>,
  own: Mass,
  massOf: (band: RunBand) => Mass,
): CoverContact | null {
  const elevation = side === 'top' ? band.top : band.base
  // A band lies BELOW its top contact and ABOVE its base contact; the far end
  // that continues it is the one on that same side over there.
  const above = side === 'base'
  if (storedTie !== null) {
    const far = farBandOf(storedTie, band.ci, elevation, above, stacks)
    return {
      tie: storedTie,
      stored: true,
      welds: far !== null && sameMass(own, massOf(far)),
    }
  }
  // THE ENVELOPE, both ends. This contact must be the cover's own edge here, and
  // the far one must be the cover's own edge over there — otherwise the two are
  // boundaries of different units inside a merged cover and nothing joins them.
  if (envelopeBandOf(column, side)?.layerId !== band.layerId) return null
  const far = envelopeBandOf(facing, side)
  if (far === null) return null
  if ((side === 'top' ? far.atCoverTop : far.atCoverBase) !== true) return null
  // An implicit edge is not a correlation anybody drew: it earns its line only
  // by welding. Different masses there keep the flat fallback they have today.
  if (!sameMass(own, massOf(far))) return null
  return {
    tie: coverEdge(band, elevation, far, side === 'top' ? far.top : far.base),
    stored: false,
    welds: true,
  }
}
