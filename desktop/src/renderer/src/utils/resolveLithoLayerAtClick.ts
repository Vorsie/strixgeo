// Resolve the accepted litho layer + depth under a right-click on the section's
// litho axis — the target of the per-layer "Edit composition…" / "Split here"
// verbs (installer #21). Pure so it is unit-testable off the section
// god-component: given the projected columns, the accepted layers, the click
// position, and the section's own along→screenX + screenY→elevation transforms,
// it names the single layer the click fell in and the clicked depth.
//
// Vertical axis, not the along warp: the depth is ``surfaceElevM - level`` for
// the clicked column, so it does not go through ``warpedXToScreen`` (that guards
// the along axis only). The column is picked by nearest warped screen-X, so the
// resolution follows column spacing nudging like every other section gesture.

/** One projected investigation column the click can land on. */
export interface ClickColumn {
  /** Investigation id (CPT or borehole) the column stands on. */
  investigationId: string
  /** Along-section position of the column (m). */
  alongM: number
  /** Surface elevation of the column (mTAW); null columns are skipped. */
  surfaceElevM: number | null
  /**
   * Half the column's rendered strip width in px. When present, a click whose
   * horizontal distance from the column's screen-X exceeds this is treated as
   * NOT on the column and resolves nothing — the "Split here" / "Edit
   * composition" verbs are for a click ON the test's own column strip, not for
   * the gap fill between columns (owner ruling, installer #26 2026-09-08). Left
   * ``undefined`` by legacy callers, which keeps the old nearest-column-wins
   * behaviour at any distance.
   */
  halfWidthPx?: number
}

/** The subset of a litho layer this resolver reads. */
export interface ClickLayer {
  id: string
  cpt_id: string | null
  borehole_id: string | null
  status: string
  depth_top_m: number
  depth_base_m: number
}

export interface ClickedLithoLayer {
  /** The accepted layer the click fell in. */
  layerId: string
  /** The clicked depth (m below the column surface), mm-rounded. */
  depthM: number
  /** The column the layer is anchored to. */
  investigationId: string
}

/**
 * Resolve the accepted litho layer + clicked depth under a section right-click.
 *
 * Picks the column whose warped screen-X is nearest the click, converts the
 * click Y to a depth below that column's surface, and returns the accepted layer
 * on that column whose half-open ``[depth_top_m, depth_base_m)`` interval
 * contains the depth. Returns ``null`` when no column has a surface elevation, or
 * when no accepted layer on the nearest column covers the clicked depth.
 *
 * @param columns - Projected investigation columns on the section.
 * @param layers - The litho model's layers (only ``accepted`` ones are targets).
 * @param svgX - Click X in SVG coordinates.
 * @param svgY - Click Y in SVG coordinates.
 * @param alongToScreenX - The section's along→screen-X transform (warped).
 * @param screenToLevelM - The section's screen-Y→elevation (mTAW) inverse.
 * @returns The clicked layer + depth, or ``null`` when none resolves.
 */
export function resolveLithoLayerAtClick(params: {
  columns: readonly ClickColumn[]
  layers: readonly ClickLayer[]
  svgX: number
  svgY: number
  alongToScreenX: (alongM: number) => number
  screenToLevelM: (svgY: number) => number
}): ClickedLithoLayer | null {
  const { columns, layers, svgX, svgY, alongToScreenX, screenToLevelM } = params
  // Nearest column with a real surface elevation (depth needs it).
  let nearest: ClickColumn | null = null
  let nearestDx = Infinity
  for (const c of columns) {
    if (c.surfaceElevM === null) continue
    const dx = Math.abs(alongToScreenX(c.alongM) - svgX)
    if (dx < nearestDx) {
      nearestDx = dx
      nearest = c
    }
  }
  if (nearest === null || nearest.surfaceElevM === null) return null

  // Column-strip gate (owner ruling, installer #26): the per-layer verbs act on
  // the accepted unit AT THE TEST, so a click farther from the column's screen-X
  // than its rendered half-width is in the gap fill between columns, not on a
  // column — resolve nothing. ``halfWidthPx`` undefined preserves the legacy
  // nearest-column-wins behaviour (the unit tests that omit it, and any caller
  // that has not opted in).
  if (nearest.halfWidthPx !== undefined && nearestDx > nearest.halfWidthPx) {
    return null
  }

  // Click Y → depth below the column surface, mm-rounded to the stored precision.
  const depthM = Math.round((nearest.surfaceElevM - screenToLevelM(svgY)) * 1000) / 1000

  const inv = nearest.investigationId
  const hit = layers.find(
    l =>
      l.status === 'accepted' &&
      (l.cpt_id === inv || l.borehole_id === inv) &&
      depthM >= l.depth_top_m &&
      depthM < l.depth_base_m,
  )
  if (hit === undefined) return null
  return { layerId: hit.id, depthM, investigationId: inv }
}
