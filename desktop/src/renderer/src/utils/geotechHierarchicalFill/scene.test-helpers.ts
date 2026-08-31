/**
 * SYNTHETIC SCENE HELPERS for the geotech fill's behavioural pins.
 *
 * Four helpers every scene test needs: build a column from metre depths, draw a
 * tie, test a point against a region's ring, and read the class painted at a
 * point. Extracted once the fourth copy came due (``hierarchicalFill``,
 * ``bandContinuationScene`` and ``extendsToFarCurtain`` each carry their own
 * today; migrating those three is a separate change so the pins they hold move
 * in a commit of their own).
 *
 * Not collected by vitest — the include glob is ``*.{test,spec}.{ts,tsx}`` and
 * this file's last segment is ``test-helpers``.
 *
 * @module utils/geotechHierarchicalFill/scene.test-helpers
 */

import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'

/** One band of a scene column, in metres BELOW the collar. */
export interface UnitSpec {
  layerId: string
  formationId: string
  top: number
  base: number
}

/**
 * One scene column with a flat collar.
 *
 * @param id The investigation id.
 * @param surface Collar elevation, mTAW.
 * @param units Its units, in metres below the collar.
 * @returns The partition column the fill engines take.
 */
export function column(id: string, surface: number, units: readonly UnitSpec[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      topDepthM: u.top,
      baseDepthM: u.base,
      bodyId: null,
    })),
  }
}

/**
 * One correlation edge between two layers.
 *
 * @param a, b The two layer ids.
 * @param aSide, bSide Which contact of each the tie lands on; both default to
 *   ``top``, the side the great majority of scene ties use.
 * @returns The edge.
 */
export function tie(
  a: string,
  b: string,
  aSide: 'top' | 'base' = 'top',
  bSide: 'top' | 'base' = 'top',
): CorrelationEdge {
  return { a, b, aSide, bSide }
}

/** Even-odd point-in-ring over (fraction, elevation). */
export function inRegion(f: number, e: number, region: SectionRegion): boolean {
  const ring = region.polygon
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > e !== b.elevation > e &&
      f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * The LAST region of one gap containing the sample — the render's own z-order.
 *
 * @param regions Every emitted region.
 * @param gap The gap index to read.
 * @param f, e The sample, in fraction space and mTAW.
 * @returns The region painted there, or null.
 */
export function paintAt(
  regions: readonly SectionRegion[],
  gap: number,
  f: number,
  e: number,
): SectionRegion | null {
  let found: SectionRegion | null = null
  for (const r of regions) if (r.gapIndex === gap && inRegion(f, e, r)) found = r
  return found
}
