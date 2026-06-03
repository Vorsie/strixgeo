/**
 * Body band geometry — the "colour the closed loop" fill.
 *
 * A body is a single-lithology unit traced across the section via the
 * resolver's correlation grouping (every accepted ``litho_layer`` carrying the
 * same ``body_id`` is one instance of that unit on one column). The filled
 * closed loop is bounded by:
 *
 *   - top boundary  = the chain of the member layers' ``depth_top_m`` across
 *                     columns, left → right;
 *   - base boundary = the chain of their ``depth_base_m``;
 *   - the end columns (or, later, the lateral extent caps).
 *
 * A wedge (pinch-out) is just this loop where the top and base chains converge
 * to a point on a column; a band is where they stay apart. Same primitive.
 *
 * This module is pure (no React, no screen transforms) so the geometry is unit
 * testable in world coordinates; the overlay projects it to screen space.
 */

import type { BodyListItem, LithoLayerResponse } from '../api/client'

/** One column's section placement, in world coordinates. */
export interface BandColumn {
  investigationId: string
  /** Along-section distance (metres) of the column. */
  along: number
  /** Surface elevation (mTAW) of the investigation at this column. */
  surfaceElevM: number
}

/** A single point on a band boundary, in world coordinates. */
export interface BandPoint {
  along: number
  elev: number
}

/** One body's filled-loop boundary, left → right. */
export interface BodyBand {
  bodyId: string
  formationId: string
  /** Top boundary points, ordered by ascending along. */
  top: BandPoint[]
  /** Base boundary points, same column order as ``top``. */
  base: BandPoint[]
}

/**
 * Compute the filled-loop geometry for every body that spans ≥2 on-section
 * columns.
 *
 * Parameters
 * ----------
 * bodies
 *   The bodies on the active litho model.
 * layers
 *   Accepted ``litho_layer`` rows; each carries the ``body_id`` the resolver
 *   stamped, plus the unit's ``depth_top_m`` / ``depth_base_m`` and its anchor
 *   (``cpt_id`` XOR ``borehole_id``).
 * columnsByInv
 *   investigation_id → its section placement. Only investigations present here
 *   are on the section; members on other columns are dropped.
 *
 * Returns
 * -------
 * One ``BodyBand`` per body that has at least two on-section member columns
 * (the minimum to bound a fillable loop). Single-column bodies are skipped —
 * a lone occurrence is not a closed loop (its lateral extent, if any, is the
 * cap's job, not the band's).
 */
export function computeBodyBands(
  bodies: readonly BodyListItem[],
  layers: readonly LithoLayerResponse[],
  columnsByInv: ReadonlyMap<string, BandColumn>,
): BodyBand[] {
  // Group accepted member layers by the body the resolver assigned them to.
  const membersByBody = new Map<string, LithoLayerResponse[]>()
  for (const layer of layers) {
    if (!layer.body_id || layer.status !== 'accepted') continue
    const bucket = membersByBody.get(layer.body_id)
    if (bucket) bucket.push(layer)
    else membersByBody.set(layer.body_id, [layer])
  }

  const out: BodyBand[] = []
  for (const body of bodies) {
    const members = membersByBody.get(body.id)
    if (!members) continue

    const placed = members
      .map(layer => {
        const inv = layer.cpt_id ?? layer.borehole_id
        const col = inv ? columnsByInv.get(inv) : undefined
        return col ? { col, top: layer.depth_top_m, base: layer.depth_base_m } : null
      })
      .filter((m): m is { col: BandColumn; top: number; base: number } => m !== null)
      .sort((a, b) => a.col.along - b.col.along)

    // Need at least two columns to bound a fillable loop.
    if (placed.length < 2) continue

    out.push({
      bodyId: body.id,
      formationId: body.formation_id,
      top: placed.map(p => ({ along: p.col.along, elev: p.col.surfaceElevM - p.top })),
      base: placed.map(p => ({ along: p.col.along, elev: p.col.surfaceElevM - p.base })),
    })
  }
  return out
}
