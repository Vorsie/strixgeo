// desktop/src/renderer/src/utils/fencePanels.ts
import type { PartitionPoint } from './sectionPartition'
import { triangulatePolygon2D, type Vec2 } from './polygonTriangulate'
import { projectionFoot, type SectionEndpoints } from './sectionProjection'

/** One section column: an investigation and its along-section position (metres). */
export interface FenceColumn {
  investigationId: string
  alongM: number
  /**
   * Optional canonical world position ``(x, y)`` in project CRS where this
   * column should be DRAWN. When set, the panel is built between these world
   * points instead of projecting ``alongM`` onto ``section``. Tie-sections use
   * this to anchor each end at the cross-section column of the same test (so a
   * tie rung snaps onto the cross-section wall, dogfeed 2026-06-10); cross-
   * sections leave it unset (or set to their own projection) → unchanged.
   */
  worldX?: number
  worldY?: number
}

/** A partition region carrying which gap (column pair) it sits in. */
export interface FenceRegion {
  formationId: string
  bodyId: string | null
  /**
   * The ``litho_layer`` ids whose drilled units produced this region's paint
   * (``PartitionRegion.layerIds``) — the label-independent identity currency.
   * Optional and absent on fallback paint; carried so consumers can resolve
   * a panel's TRUE body through the layers rather than the ``bodyId`` LABEL,
   * which the weld mints locally and the recompute rewrites.
   */
  layerIds?: readonly string[]
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
  /** Source layer ids — see {@link FenceRegion.layerIds}; additive, optional. */
  layerIds?: readonly string[]
  vertices: [number, number, number][]
  triangles: [number, number, number][]
}

/**
 * Project each partition region into a world-space wall panel.
 *
 * For region in gap ``g``: the left column is ``orderedColumns[g]`` and the right
 * is ``orderedColumns[g+1]``. Each column resolves to a world ``(x, y)`` — its
 * ``worldX``/``worldY`` when set (a tie's canonical cross-section position), else
 * the foot of ``alongM`` on ``section``. A polygon point's ``fraction`` linearly
 * interpolates between the two column world points; ``elevation`` is the z.
 * Triangulation runs in the panel's own 2D plane ``(horizontal-distance,
 * elevation)`` (concave-safe) and the indices are reused for the 3D vertices,
 * which is valid because the panel is planar. For a cross-section the two world
 * points are colinear on the section line, so interpolating between them is
 * identical to projecting ``alongM`` — the change is inert there.
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
  // Resolve a column to the world (x, y) where it should be drawn: its canonical
  // worldX/worldY if set, else the foot of its alongM on the section line.
  const colWorld = (col: FenceColumn): { x: number; y: number } | null =>
    col.worldX !== undefined && col.worldY !== undefined
      ? { x: col.worldX, y: col.worldY }
      : projectionFoot(section, col.alongM)

  const panels: FencePanel[] = []
  for (const region of regions) {
    const left = orderedColumns[region.gapIndex]
    const right = orderedColumns[region.gapIndex + 1]
    if (!left || !right) continue
    const leftPt = colWorld(left)
    const rightPt = colWorld(right)
    if (!leftPt || !rightPt) continue
    // Horizontal span of the gap in world metres — the 2D plane's x axis, so the
    // ear-clip triangulation sees the true panel aspect ratio.
    const gapLen = Math.hypot(rightPt.x - leftPt.x, rightPt.y - leftPt.y)

    const plane: Vec2[] = []
    const vertices: [number, number, number][] = []
    for (const p of region.polygon) {
      const x = leftPt.x + p.fraction * (rightPt.x - leftPt.x)
      const y = leftPt.y + p.fraction * (rightPt.y - leftPt.y)
      vertices.push([x, y, p.elevation])
      plane.push({ x: p.fraction * gapLen, y: p.elevation })
    }
    if (vertices.length < 3) continue

    const triangles = triangulatePolygon2D(plane)
    if (triangles.length === 0) continue
    panels.push({
      formationId: region.formationId,
      bodyId: region.bodyId,
      layerIds: region.layerIds,
      vertices,
      triangles,
    })
  }
  return panels
}
