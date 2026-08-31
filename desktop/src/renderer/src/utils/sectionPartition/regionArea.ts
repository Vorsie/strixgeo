// partitionFill/regionArea.ts — the one shoelace-in-fraction-space helper.
//
// Extracted 2026-08-26 (gapless-gate clause 1 needed a FOURTH copy of this —
// past the "extract on the second copy" window per CLAUDE.md). Three private
// copies existed, identical in substance, different only in whether the
// caller already had the gap's width in hand or had to derive it from
// ``alongM``:
//   - geotechHierarchicalFill/constructive/fillGap.ts       (ring, width)
//   - geotechHierarchicalFill/constructive/familyFill.ts    (region, alongM)
//   - geotechHierarchicalFill/constructive/fillTotality.ts  (region, width)
//
// Lives next to ``SectionRegion`` (not inside the geotech package) because
// litho code — which produces the ``SectionRegion``s these functions measure
// — is exactly as likely to want a region's area as anything geotech-side.

import type { PartitionPoint } from './types'
import type { SectionRegion } from './sectionRegion'

/**
 * A closed ring's area in the gap's fraction space, scaled to square metres.
 *
 * The ring lives in (fraction, elevation) space — fraction in [0, 1] across
 * the gap, elevation in metres — so the raw shoelace result is a fraction·m
 * quantity; multiplying by the gap's width in metres turns it into m².
 */
export function ringAreaM2(ring: readonly PartitionPoint[], widthM: number): number {
  let twice = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    twice += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return (Math.abs(twice) / 2) * Math.abs(widthM)
}

/** A region's area in square metres, given its gap's width directly. */
export function regionAreaM2(region: Pick<SectionRegion, 'polygon'>, widthM: number): number {
  return ringAreaM2(region.polygon, widthM)
}

/**
 * A region's area in square metres, deriving its gap's width from ``alongM``.
 *
 * Returns 0 when the derived width is not finite (an out-of-range
 * ``gapIndex`` must not throw here) — the guard the original ``familyFill.ts``
 * copy carried, preserved verbatim.
 */
export function regionAreaM2FromAlongM(
  region: Pick<SectionRegion, 'polygon' | 'gapIndex'>,
  alongM: readonly number[],
): number {
  const width = alongM[region.gapIndex + 1] - alongM[region.gapIndex]
  if (!Number.isFinite(width)) return 0
  return regionAreaM2(region, width)
}
