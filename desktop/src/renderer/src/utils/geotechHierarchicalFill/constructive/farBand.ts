/**
 * WHAT CONTINUES PAST A LINE — *"follow tie ... check litho and packing
 * density on the other end"*.
 *
 * One tolerance and one far-end read, extracted from ``constructs.ts`` when the
 * cover weld of 2026-08-26 became their second consumer (``coverWeld.ts``).
 * Both modules ask the same two questions — *"is this the same contact?"* and
 * *"what lies on my side of it over there?"* — and a second copy of either
 * answer is a place they can drift apart.
 *
 * Pure module, and it imports ``RunBand``/``RunTie`` for their TYPE only, so
 * ``constructs.ts`` can depend on it at runtime without the two forming an
 * import cycle (the arrangement ``columnReading.ts`` and ``carriedTaper.ts``
 * already use).
 *
 * @module utils/geotechHierarchicalFill/constructive/farBand
 */

import type { RunBand, RunTie } from './constructs'

/** Elevation tolerance (m) at which two contacts are the same contact. */
export const CONTACT_EPS = 1e-6

/**
 * *"follow tie ... check litho and packing density on the other end"* — the
 * mass that continues past the tie, on the SAME SIDE of the contact.
 *
 * The tie lands on a contact of the facing test, and a contact has a band above
 * it and a band below it. A band sitting ABOVE its own contact continues as
 * whatever sits above the contact over there; below, below. Reading the wrong
 * side reads the neighbouring soil and calls a continuous mass a different one,
 * which is the owner's own worked example: the sand's tie lands on the facing
 * sand|silt contact and *"it is the same litho and packing density"*.
 *
 * @param tie The tie on the band's contact.
 * @param ci The band's own column index.
 * @param elevation The contact's elevation on the band's own column, mTAW.
 * @param above Whether the band lies ABOVE the contact the tie is on.
 * @param stacks EVERY packing band per column — the far band may belong to a
 *   neighbouring family, and its mass still decides.
 * @returns The far band, or null when nothing lies on that side there.
 */
export function farBandOf(
  tie: RunTie,
  ci: number,
  elevation: number,
  above: boolean,
  stacks: ReadonlyMap<number, readonly RunBand[]>,
): RunBand | null {
  const onLeft = tie.leftCi === ci && Math.abs(tie.leftY - elevation) <= CONTACT_EPS
  const farCi = onLeft ? tie.rightCi : tie.leftCi
  const farY = onLeft ? tie.rightY : tie.leftY
  const stack = stacks.get(farCi) ?? []
  const far = stack.find((b) =>
    above ? Math.abs(b.base - farY) <= CONTACT_EPS : Math.abs(b.top - farY) <= CONTACT_EPS,
  )
  return far ?? null
}
