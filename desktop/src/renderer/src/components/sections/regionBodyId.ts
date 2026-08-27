// Resolve the resolver BODY behind one computed fill region — pure, shared by
// the fill's unit-statistics jump (owner body-scope ruling 2026-08-27).
//
// A region's ``bodyId`` field is the LABEL the body recompute rewrites (it
// oscillated when fed back on itself — see ``PartitionRegion.layerIds``'s own
// note), and on the geotech axis the hierarchical fill can label a face from
// the litho FRAME. ``layerIds`` is the label-independent identity currency:
// the drilled ``litho_layer`` rows whose ground produced the paint. So the
// jump resolves through the LAYERS' ``body_id`` — the same authority the
// statistics pool filters on — never through the region label.

/**
 * The one body a region's layers agree on, or ``null``.
 *
 * Rules (task ruling, verbatim: "a region whose layers span several bodies
 * (should not happen for one mass) or none reports null and stays
 * formation-level"):
 *
 * * exactly one DISTINCT stamped body among the named layers → that body
 *   (layers the resolver has not stamped yet do not veto — they are silence,
 *   not disagreement);
 * * several distinct bodies, or no stamped body at all, or no ``layerIds``
 *   (fallback paint) → ``null``.
 *
 * Parameters
 * ----------
 * layerIds
 *     The region's ``layerIds`` (absent on fallback paint).
 * bodyIdByLayerId
 *     ``litho_layer id → body_id`` over the axis's own layer list.
 *
 * Returns
 * -------
 * str | null
 *     The one body, or ``null`` for the formation-level (pooled) jump.
 */
export function resolveRegionBodyId(
  layerIds: readonly string[] | undefined,
  bodyIdByLayerId: ReadonlyMap<string, string | null>,
): string | null {
  if (layerIds === undefined || layerIds.length === 0) return null
  let found: string | null = null
  for (const layerId of layerIds) {
    const bodyId = bodyIdByLayerId.get(layerId) ?? null
    if (bodyId === null) continue
    if (found === null) found = bodyId
    else if (found !== bodyId) return null
  }
  return found
}
