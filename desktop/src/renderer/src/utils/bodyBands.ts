/**
 * Body band geometry — the "colour the closed loop" fill.
 *
 * A body is a single-lithology unit traced across the section via the
 * resolver's correlation grouping (every accepted ``litho_layer`` carrying the
 * same ``body_id`` is one instance of that unit on one column). The fill is
 * drawn GAP BY GAP: for each pair of consecutive on-section member columns, a
 * trapezoid spans the dark space between them, bounded by
 *
 *   - top edge  = the correlation line of the unit's top (left column's
 *                 ``depth_top_m`` → right column's ``depth_top_m``);
 *   - base edge = the correlation line of its base;
 *   - the two column edges.
 *
 * Filling per gap (and only the gap, in the overlay) tiles cleanly: stacked
 * units fill adjacent vertical slices with no overlap, no big self-crossing
 * polygon, and never paint over a column's own glyphs. A wedge (pinch-out) is
 * just the gap where the unit is absent on one side — a hole the cap fills,
 * later.
 *
 * This module is pure (no React, no screen transforms) so the geometry is unit
 * testable in world coordinates; the overlay maps it to screen space + column
 * edges.
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

/** A body's member unit on one on-section column. */
export interface BandMember {
  investigationId: string
  /** The member layer's OWN formation — drives the segment colour + the
   *  one-lithology guard, NOT the body's nominal formation (a mis-grouped
   *  body can span lithologies; we colour each member by what it actually is). */
  formationId: string
  /** Along-section distance — used to order columns left → right. */
  along: number
  /** Absolute elevation (mTAW) of the unit's top on this column. */
  topElev: number
  /** Absolute elevation (mTAW) of the unit's base on this column. */
  baseElev: number
}

/** One body's on-section member columns, ordered left → right. */
export interface BodyBand {
  bodyId: string
  formationId: string
  /** Member columns sorted by ascending along; length ≥ 2. */
  members: BandMember[]
}

/**
 * Compute the per-body member columns for the band fill.
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
 * (the minimum to bound a fillable gap). The overlay draws one trapezoid per
 * consecutive member pair. Single-column bodies are skipped — a lone
 * occurrence has no gap to fill.
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
    const layersForBody = membersByBody.get(body.id)
    if (!layersForBody) continue

    const members = layersForBody
      .map((layer): BandMember | null => {
        const inv = layer.cpt_id ?? layer.borehole_id
        const col = inv ? columnsByInv.get(inv) : undefined
        if (!col) return null
        return {
          investigationId: col.investigationId,
          formationId: layer.formation_id,
          along: col.along,
          topElev: col.surfaceElevM - layer.depth_top_m,
          baseElev: col.surfaceElevM - layer.depth_base_m,
        }
      })
      .filter((m): m is BandMember => m !== null)
      .sort((a, b) => a.along - b.along)

    // Need at least two columns to bound a fillable gap.
    if (members.length < 2) continue

    out.push({ bodyId: body.id, formationId: body.formation_id, members })
  }
  return out
}
