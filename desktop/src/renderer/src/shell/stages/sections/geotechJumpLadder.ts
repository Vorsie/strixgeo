// The section → Parameters jump ladder (spec §2, 2026-08-27): every jump lands
// on the most specific Parameters node it can PROVE, falling back one level at
// a time. Pure, so the ladder is pinnable without mounting the canvas.
//
// The section overlays report a clicked surface's FORMATION id + (when the
// surface knows it) a resolved BODY. This module turns that — plus, for the
// geotech axis, the clicked region's own geotech LAYER ids — into the typed
// scope the deep link carries.

import type { ParameterUnitScope } from '../../ShellContext'

/** The layer/formation fields the ladder reads (a structural subset). */
interface LithoLayerRef {
  id: string
  formation_id: string
  body_id?: string | null
}
interface GeotechLayerRef {
  id: string
  formation_id: string
  body_id?: string | null
  parent_litho_layer_id?: string | null
}
interface GeotechFormationRef {
  id: string
  nad_class: number | null
}

/** The model context the geotech ladder resolves a region's litho parent through. */
export interface GeotechJumpContext {
  lithoLayers: readonly LithoLayerRef[]
  geotechLayers: readonly GeotechLayerRef[]
  geotechFormations: readonly GeotechFormationRef[]
}

/**
 * A LITHO surface jumps as itself (spec §2 step 4): with a body → litho-body,
 * without → litho-unit.
 *
 * @param unitId  The litho formation id the surface reported.
 * @param bodyId  The clicked ground's resolver body, or null/undefined.
 * @returns  A litho-body or litho-unit scope.
 */
export function lithoJumpScope(
  unitId: string,
  bodyId: string | null | undefined,
): ParameterUnitScope {
  if (bodyId != null) return { kind: 'litho-body', unitId, bodyId }
  return { kind: 'litho-unit', unitId }
}

/**
 * A GEOTECH surface jumps down the fallback ladder (spec §2 steps 1–3):
 *
 * 1. a resolved body → geotech-body (the leaf);
 * 2. an unresolved body whose region's litho PARENT BODY is unique → the
 *    geotech-class row for that litho body + the region's NAD class;
 * 3. still unresolved → geotech-unit (the pooled formation-row fallback).
 *
 * @param unitId  The geotech formation id the surface reported.
 * @param bodyId  The clicked ground's resolver body, or null/undefined.
 * @param regionLayerIds  The clicked region's own geotech layer ids, or
 *                        undefined when the surface cannot name them (a single
 *                        band click resolves its body, so it needs no region).
 * @param ctx  The model layers + geotech formations, for the parent-body walk.
 * @returns  A geotech-body, geotech-class or geotech-unit scope.
 */
export function geotechJumpScope(
  unitId: string,
  bodyId: string | null | undefined,
  regionLayerIds: readonly string[] | undefined,
  ctx: GeotechJumpContext,
): ParameterUnitScope {
  // Step 1 — a resolved body is the leaf.
  if (bodyId != null) return { kind: 'geotech-body', unitId, bodyId }

  // Step 2 — a region with a UNIQUE litho parent body lands on its class row.
  if (regionLayerIds !== undefined && regionLayerIds.length > 0) {
    const lithoById = new Map(ctx.lithoLayers.map(l => [l.id, l]))
    const geoById = new Map(ctx.geotechLayers.map(l => [l.id, l]))
    const classByFormation = new Map(ctx.geotechFormations.map(f => [f.id, f.nad_class]))

    const lithoBodies = new Set<string>()
    let lithoUnitId: string | null = null
    let nadClass: number | null = null
    for (const layerId of regionLayerIds) {
      const geo = geoById.get(layerId)
      if (geo === undefined) continue
      const parentId = geo.parent_litho_layer_id ?? null
      const parent = parentId === null ? undefined : lithoById.get(parentId)
      const lithoBody = parent?.body_id ?? null
      if (lithoBody !== null) {
        lithoBodies.add(lithoBody)
        // The litho unit is the parent litho band's own formation (the tree
        // homes a roster-less body the same way).
        if (lithoUnitId === null) lithoUnitId = parent?.formation_id ?? null
      }
      const cls = classByFormation.get(geo.formation_id)
      if (cls != null) nadClass = cls
    }
    if (lithoBodies.size === 1 && lithoUnitId !== null && nadClass !== null) {
      return {
        kind: 'geotech-class',
        lithoUnitId,
        lithoBodyId: [...lithoBodies][0],
        nadClass,
      }
    }
  }

  // Step 3 — the pooled formation-row fallback (today's behaviour).
  return { kind: 'geotech-unit', unitId }
}
