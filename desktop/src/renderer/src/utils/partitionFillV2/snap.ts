/**
 * partitionFillV2/snap.ts — snap-rounding to a fixed integer grid.
 *
 * The entire numerical-robustness strategy is: perform ONE snapping pass mapping
 * every point (input vertices AND computed intersection points) to a fixed 1 mm
 * grid, represented as integer grid units. All subsequent arrangement walking is
 * EXACT integer arithmetic on this snapped graph — no floating-point epsilon
 * comparisons cascade downstream (design §3).
 *
 * We keep the snapped coordinates as integers (metres / ``SNAP_GRID_M``, rounded)
 * so two points within 1 mm collapse to the same grid cell and equality is exact.
 */

import { type Point, SNAP_GRID_M } from './types'

/**
 * An integer grid point: snapped coordinates in whole grid units (1 unit = 1 mm).
 * Integer equality is exact, so ``ix``/``iy`` form a reliable vertex key.
 */
export interface GridPoint {
  ix: number
  iy: number
}

/**
 * Snap a real point to the integer grid.
 *
 * Parameters
 * ----------
 * p : Point
 *     A point in metres×elevation space.
 *
 * Returns
 * -------
 * GridPoint
 *     The point rounded to the nearest 1 mm grid cell, in integer grid units.
 */
export function snapPoint(p: Point): GridPoint {
  return {
    ix: Math.round(p.x / SNAP_GRID_M),
    iy: Math.round(p.y / SNAP_GRID_M),
  }
}

/**
 * Convert a grid point back to real metres×elevation.
 *
 * Parameters
 * ----------
 * g : GridPoint
 *     A snapped integer grid point.
 *
 * Returns
 * -------
 * Point
 *     The grid point expressed in metres.
 */
export function unsnapPoint(g: GridPoint): Point {
  return { x: g.ix * SNAP_GRID_M, y: g.iy * SNAP_GRID_M }
}

/**
 * A stable string key for a grid point, for deduplication and vertex indexing.
 *
 * Parameters
 * ----------
 * g : GridPoint
 *     A snapped integer grid point.
 *
 * Returns
 * -------
 * string
 *     ``"ix,iy"`` — exact and order-preserving for two equal grid points.
 */
export function gridKey(g: GridPoint): string {
  return `${g.ix},${g.iy}`
}

/**
 * Whether two grid points are the same cell (exact integer equality).
 *
 * Parameters
 * ----------
 * a, b : GridPoint
 *
 * Returns
 * -------
 * boolean
 */
export function gridEqual(a: GridPoint, b: GridPoint): boolean {
  return a.ix === b.ix && a.iy === b.iy
}
