/** Map box extent in projected metres (spec "The map — Extent") + the scale bar pick. */
import { MAP_ASPECT, MAP_MIN_SPAN_M, MAP_PAD_FRACTION, SCALE_BAR_CANDIDATES_M } from './sheetConstants'

export interface Extent { minX: number; minY: number; maxX: number; maxY: number }

export function computeMapExtent(points: readonly { x: number; y: number }[]): Extent {
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  let spanX = Math.max(MAP_MIN_SPAN_M, (maxX - minX) * (1 + 2 * MAP_PAD_FRACTION))
  let spanY = Math.max(MAP_MIN_SPAN_M / MAP_ASPECT, (maxY - minY) * (1 + 2 * MAP_PAD_FRACTION))
  // Widen (never shrink) to the box aspect.
  if (spanX / spanY < MAP_ASPECT) spanX = spanY * MAP_ASPECT
  else spanY = spanX / MAP_ASPECT
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  return { minX: cx - spanX / 2, maxX: cx + spanX / 2, minY: cy - spanY / 2, maxY: cy + spanY / 2 }
}

export function pickScaleBarM(visibleWidthM: number): number {
  const target = visibleWidthM / 3
  let best: number = SCALE_BAR_CANDIDATES_M[0]
  for (const c of SCALE_BAR_CANDIDATES_M) {
    if (Math.abs(c - target) < Math.abs(best - target)) best = c
  }
  return best
}
