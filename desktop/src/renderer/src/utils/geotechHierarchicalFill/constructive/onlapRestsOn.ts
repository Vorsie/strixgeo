/**
 * AN ONLAP RESTS ON WHAT IT SITS ON — the free contact as a POLYLINE.
 *
 * Owner dogfeed, 2026-08-26, Tie-section 12 gap 0: *"why the fuck is there a
 * zigzag in that onlap?"* The loose sand's wedge painted, and its underside
 * backtracked in x around the tip of the medium lens directly beneath it — the
 * sand had wrapped UNDERNEATH a mass it sits on top of at its own test.
 *
 * WHY. An onlap's free contact and the facing flank of the construct below it
 * leave the SAME point: the contact they share on the band's own column. Both
 * are straight, so which one lies lower over the rest of the gap is decided by
 * one number each — how steeply they fall. Where the onlap's closing line dives
 * steeper than the neighbour's flank, it passes below the neighbour's FAR flank
 * shortly before the neighbour pinches out, and the hair between the two reads
 * as the onlap's by its own ``claims()``. On his section that hair is a
 * hundredth of the gap wide and a few centimetres tall, and it is a notch.
 *
 * THE RULING (2026-08-26):
 *
 *   An onlap's base rests ON the construct below it until that construct pinches
 *   out, then runs STRAIGHT from the pinch-tip to its own apex. It NEVER wraps
 *   underneath a mass it sits on top of at its own column.
 *
 * ...and the same statement upside down for an onlap riding its BASE tie, whose
 * free contact is its TOP and whose neighbour is above it.
 *
 * The apex does not move, the tie-side contact does not move, and the ground the
 * onlap gives up — between its old closing line and the new tip→apex line —
 * falls to whatever owns the ground around it.
 *
 * ONE SHAPE, NOT TWO. The wedge's underside is now two segments rather than one,
 * so it can no longer be stated as an interpolation between two endpoints. It is
 * stated ONCE, as {@link BandConstruct.freeVertices}, and BOTH readers take it
 * from there: ``claims()`` through the boundary function this module builds, and
 * ``fillGap``'s flank pass by walking the same vertices. That is yesterday's
 * lesson made structural — the plunging-tie bug was a drawn line and a claimed
 * window disagreeing about one wedge, and a polyline that only one of them knew
 * about would be the same bug again.
 *
 * Pure module — no I/O, no React, and no runtime dependency on ``constructs.ts``
 * (types only), so the two never form an import cycle.
 *
 * @module utils/geotechHierarchicalFill/constructive/onlapRestsOn
 */

import type { BandConstruct } from './constructs'

/** Two contacts are the same contact within this many metres. */
const CONTACT_EPS = 1e-6
/** A dive is only a dive when it clears the neighbour's flank by this much. */
const WRAP_EPS = 1e-9

/** One vertex of a construct's free contact, in along-section metres. */
export interface FreeVertex {
  /** Along-section position, in metres. */
  x: number
  /** Elevation there, mTAW. */
  y: number
}

/**
 * A free contact's elevation at along-x, clamped flat past either end.
 *
 * Reduces to the straight closing line exactly — same arithmetic, same rounding
 * — when the polyline is the ordinary two-vertex one, so an onlap with nothing
 * pinching below it is byte-identical to what it was.
 *
 * The last segment returns its OWN end vertex once the walk has arrived rather
 * than an interpolation onto it: ``a + 1·(b − a)`` rounds a ULP off ``b`` for
 * about one pair of elevations in ten, and a hair-wide gap between the wedge's
 * two edges is a loop the arrangement is entitled to mint (owner's verification
 * contract, 2026-08-25 — the apex is ONE vertex).
 *
 * @param vertices The free contact, from the band's own column toward its apex.
 * @param x Along-section position, in metres.
 * @returns The free contact's elevation there.
 */
export function freeContactAt(vertices: readonly FreeVertex[], x: number): number {
  const last = vertices.length - 1
  for (let i = 0; i < last; i++) {
    const a = vertices[i]
    const b = vertices[i + 1]
    const span = b.x - a.x
    const t = Math.min(1, Math.max(0, Math.abs(span) < 1e-9 ? 1 : (x - a.x) / span))
    if (t >= 1) {
      if (i === last - 1) return b.y
      continue
    }
    return a.y + t * (b.y - a.y)
  }
  return vertices[last].y
}

/**
 * The construct sharing this onlap's FREE contact on its own column — the mass
 * it sits on (free base) or hangs under (free top).
 *
 * A column's bands are contiguous, so at most one of them holds that contact
 * from the other side. It must pinch, and it must pinch STRICTLY INSIDE the
 * onlap's own reach: a neighbour that closes at the same middle the onlap does
 * offers no tip to leave from, and one that never closes at all offers none
 * either. Both keep the straight closing line (see the CONTROL pins).
 */
function neighbourAcrossFreeContact(
  onlap: BandConstruct,
  constructs: readonly BandConstruct[],
): BandConstruct | null {
  const apexX = onlap.apexX
  if (apexX === undefined) return null
  const freeIsBase = onlap.topTied
  const contact = freeIsBase ? onlap.band.base : onlap.band.top
  const reach = Math.abs(apexX - onlap.band.x)
  for (const other of constructs) {
    if (other === onlap) continue
    if (other.band.ci !== onlap.band.ci) continue
    if (other.extendsToFar === true) continue
    const otherApexX = other.apexX
    if (otherApexX === undefined) continue
    const shared = freeIsBase ? other.band.top : other.band.base
    if (Math.abs(shared - contact) > CONTACT_EPS) continue
    // Same direction out of the shared column, and pinching first.
    if ((otherApexX - other.band.x) * (apexX - onlap.band.x) <= 0) continue
    const otherReach = Math.abs(otherApexX - other.band.x)
    if (!(otherReach > 0 && otherReach < reach)) continue
    return other
  }
  return null
}

/**
 * Rest every onlap that would wrap on the construct it shares its free contact
 * with — the ruling of 2026-08-26, applied to a gap's finished constructs.
 *
 * Nothing else about a construct changes: the apex, the tie-side contact, the
 * closure bar it contributes and the classification that produced it are all
 * untouched. Only the free contact gains its middle vertex, and only where the
 * dive actually reaches the neighbour.
 *
 * Idempotent — a contact already rested reads its neighbour's tip as its own
 * value there, so the dive test answers no and it is returned untouched.
 *
 * @param constructs Every construct of one gap, as the law emitted them.
 * @returns The same constructs, with wrapping free contacts rested.
 */
export function restOnlapsOnPinches(constructs: readonly BandConstruct[]): BandConstruct[] {
  return constructs.map((construct) => {
    if (construct.emit !== 'onlap') return construct
    const vertices = construct.freeVertices
    if (vertices === undefined) return construct
    const neighbour = neighbourAcrossFreeContact(construct, constructs)
    if (neighbour === null) return construct
    const tipX = neighbour.apexX as number
    const freeIsBase = construct.topTied
    // The neighbour's flank FACING the onlap, read through the neighbour's own
    // boundary function — never re-derived from its levels, so a lens, an onlap
    // and a cover-tied contact all answer with the line they themselves draw.
    const tipY = freeIsBase ? neighbour.topAt(tipX) : neighbour.baseAt(tipX)
    const dived = freeContactAt(vertices, tipX)
    const wraps = freeIsBase ? dived < tipY - WRAP_EPS : dived > tipY + WRAP_EPS
    if (!wraps) return construct
    const rested: FreeVertex[] = [vertices[0], { x: tipX, y: tipY }, vertices[1]]
    const freeAt = (x: number): number => freeContactAt(rested, x)
    return {
      ...construct,
      freeVertices: rested,
      topAt: freeIsBase ? construct.topAt : freeAt,
      baseAt: freeIsBase ? freeAt : construct.baseAt,
    }
  })
}
