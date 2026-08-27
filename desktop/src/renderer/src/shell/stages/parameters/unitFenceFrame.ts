// The cutout's synthetic camera-frame geometry (audit F4, 2026-08-27) — pure
// and Cesium-free so it is pinnable under jsdom.

import type { FencePanel } from '../../../utils/fencePanels'

/**
 * The 8 corners of the axis-aligned bounding box over EVERY panel vertex.
 *
 * The cutout's camera frames on a synthetic solid; framing it on the FILTERED
 * panels lost all orientation context (a small body = a chip of orthophoto,
 * a deep unit floated the photo at its own top). These corners bound the
 * WHOLE fence, so the framing sphere contains every wall — O(1) output
 * whatever the panel count, which also keeps the viewer's vertex-count
 * ``fitKey`` constant across scope changes (deliberate: the frame covers the
 * model, so no scope change needs a re-fly).
 *
 * Parameters
 * ----------
 * panels
 *     The unfiltered fence panels.
 *
 * Returns
 * -------
 * [number, number, number][] | null
 *     Exactly 8 ``[x, y, z]`` corners, or ``null`` when no vertex exists.
 */
export function fenceFrameCorners(
  panels: readonly FencePanel[],
): [number, number, number][] | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let n = 0
  for (const panel of panels) {
    for (const [x, y, z] of panel.vertices) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
      n++
    }
  }
  if (n === 0) return null
  return [
    [minX, minY, minZ],
    [minX, minY, maxZ],
    [minX, maxY, minZ],
    [minX, maxY, maxZ],
    [maxX, minY, minZ],
    [maxX, minY, maxZ],
    [maxX, maxY, minZ],
    [maxX, maxY, maxZ],
  ]
}
