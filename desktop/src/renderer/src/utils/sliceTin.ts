// In-browser slice of a TIN surface against a section line.
//
// Mirrors the Python ``groundmodel.domain.services.tin_surface.slice_tin``
// implementation 1:1 — same algorithm, same edge-case behaviour, same
// output shape. Lives in the renderer because the section editor
// needs sub-millisecond slicing on every render frame; a backend
// round-trip per pan/zoom would kill interactivity.
//
// Algorithm:
//
//   1. Project each TIN vertex onto the section line (signed
//      along-distance + signed perpendicular offset).
//   2. For every triangle, test which of its three edges cross the
//      line (perpendicular-offset sign change).
//   3. For each crossing edge, linearly interpolate the
//      (along, elevation) of the crossing point.
//   4. Sort all crossing points by ``along`` to form the polyline.
//
// Off-line picks contribute via their triangle's intersection with
// the line — exactly the property the previous "connect picks
// projected onto line" render couldn't deliver.

import type { FormationSurfaceResponse } from '../api/client'

/** Section endpoints in the project's horizontal CRS. */
export interface SectionLine2D {
  startX: number
  startY: number
  endX: number
  endY: number
}

/** One point on a section-slice polyline. */
export interface SlicePoint {
  alongM: number
  elevationM: number
  /**
   * Debt #28: index of the triangle this crossing came from.  Two
   * consecutive ``SlicePoint``s in the sorted polyline are crossings of
   * the SAME triangle (since the section line enters and exits each
   * triangle through two edges), so a per-segment confidence value can
   * be read by looking up ``triangleIdx`` on the SECOND point of each
   * segment (or either — they will agree).  Optional for backwards
   * compat with callers that don't need the band split.
   */
  triangleIdx?: number
}

/**
 * Cut the TIN with a vertical plane along ``line`` and return the
 * polyline.
 *
 * Returns an empty array when the surface has no triangles (the
 * geological minimum of 3 non-collinear contacts isn't met) OR when
 * the section line is zero-length (defensive against UI bugs).
 *
 * The returned polyline is sorted by ``alongM`` — load-bearing for
 * SVG path generation downstream.
 */
export function sliceTin(
  surface: FormationSurfaceResponse,
  line: SectionLine2D,
): SlicePoint[] {
  if (surface.triangles.length === 0) return []
  const dx = line.endX - line.startX
  const dy = line.endY - line.startY
  const length = Math.hypot(dx, dy)
  if (length === 0) return []
  const ux = dx / length
  const uy = dy / length
  // Left-perpendicular unit vector.
  const nx = -uy
  const ny = ux

  const n = surface.vertices.length
  const along = new Array<number>(n)
  const offset = new Array<number>(n)
  const elev = new Array<number>(n)
  for (let i = 0; i < n; i += 1) {
    const v = surface.vertices[i]
    const rx = v[0] - line.startX
    const ry = v[1] - line.startY
    along[i] = rx * ux + ry * uy
    offset[i] = rx * nx + ry * ny
    elev[i] = v[2]
  }

  const crossings: SlicePoint[] = []
  for (let tIdx = 0; tIdx < surface.triangles.length; tIdx += 1) {
    const tri = surface.triangles[tIdx]
    const ia = tri[0]
    const ib = tri[1]
    const ic = tri[2]
    // Three edges: (ia, ib), (ib, ic), (ic, ia).
    const edges: [number, number][] = [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ]
    for (const [i, j] of edges) {
      const oi = offset[i]
      const oj = offset[j]
      // Both endpoints exactly on the line — degenerate edge, skip.
      // The triangle's interior on the line should be rendered as a
      // face (caller's responsibility); a zero-length edge has no
      // crossing.
      if (oi === 0 && oj === 0) continue
      // Same side — no crossing.
      if (oi * oj > 0) continue
      if (oi === 0) {
        crossings.push({ alongM: along[i], elevationM: elev[i], triangleIdx: tIdx })
        continue
      }
      if (oj === 0) {
        crossings.push({ alongM: along[j], elevationM: elev[j], triangleIdx: tIdx })
        continue
      }
      // Strict sign change: linearly interpolate to find the
      // crossing point's parametric position along edge i→j.
      const t = oi / (oi - oj) // in (0, 1)
      const crossingAlong = along[i] + t * (along[j] - along[i])
      const crossingElev = elev[i] + t * (elev[j] - elev[i])
      crossings.push({ alongM: crossingAlong, elevationM: crossingElev, triangleIdx: tIdx })
    }
  }

  crossings.sort((a, b) => a.alongM - b.alongM)
  return crossings
}
