// desktop/src/renderer/src/utils/fencePanels.ts
import type { PartitionPoint } from './partitionFill'
import { triangulatePolygon2D, type Vec2 } from './polygonTriangulate'
import { projectionFoot, type SectionEndpoints } from './sectionProjection'

/** One section column: an investigation and its along-section position (metres). */
export interface FenceColumn {
  investigationId: string
  alongM: number
}

/** A partition region carrying which gap (column pair) it sits in. */
export interface FenceRegion {
  formationId: string
  bodyId: string | null
  /** Index of the LEFT bounding column in the ordered column list. */
  gapIndex: number
  /** Polygon in (gap-fraction 0..1, absolute elevation mTAW). */
  polygon: readonly PartitionPoint[]
}

/**
 * One filled wall panel of the fence, in project CRS.
 *
 * ``vertices`` are ``[x_m, y_m, elevation_m]`` (same convention as
 * ``FormationSurfaceResponse.vertices``); ``triangles`` index into them.
 */
export interface FencePanel {
  formationId: string
  bodyId: string | null
  vertices: [number, number, number][]
  triangles: [number, number, number][]
}

/**
 * Project each partition region into a world-space wall panel.
 *
 * For region in gap ``g``: the left column is ``orderedColumns[g]`` and the right
 * is ``orderedColumns[g+1]``. A polygon point's ``fraction`` maps linearly to an
 * along-section distance between the two columns; ``projectionFoot`` turns that
 * into world ``(x, y)``; ``elevation`` is the z. Triangulation runs in the
 * section's 2D plane ``(along, elevation)`` (concave-safe) and the indices are
 * reused for the 3D vertices, which is valid because the panel is planar.
 *
 * Parameters
 * ----------
 * section : SectionEndpoints
 *     The section's world endpoints (start/end x,y in project CRS).
 * orderedColumns : readonly FenceColumn[]
 *     Columns left→right with their along positions (same order fed to
 *     ``computeSectionFill``).
 * regions : readonly FenceRegion[]
 *     Partition regions from ``computeSectionFill`` (carry ``gapIndex``).
 *
 * Returns
 * -------
 * FencePanel[]
 *     One panel per region that has a valid bounding column pair and ≥3 vertices.
 */
export function buildFencePanels(
  section: SectionEndpoints,
  orderedColumns: readonly FenceColumn[],
  regions: readonly FenceRegion[],
): FencePanel[] {
  const panels: FencePanel[] = []
  for (const region of regions) {
    const left = orderedColumns[region.gapIndex]
    const right = orderedColumns[region.gapIndex + 1]
    if (!left || !right) continue

    const plane: Vec2[] = []
    const vertices: [number, number, number][] = []
    let ok = true
    for (const p of region.polygon) {
      const along = left.alongM + p.fraction * (right.alongM - left.alongM)
      const foot = projectionFoot(section, along)
      if (!foot) {
        ok = false
        break
      }
      vertices.push([foot.x, foot.y, p.elevation])
      plane.push({ x: along, y: p.elevation })
    }
    if (!ok || vertices.length < 3) continue

    const triangles = triangulatePolygon2D(plane)
    if (triangles.length === 0) continue
    panels.push({
      formationId: region.formationId,
      bodyId: region.bodyId,
      vertices,
      triangles,
    })
  }
  return panels
}
