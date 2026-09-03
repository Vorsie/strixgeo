// Pure glue for the Parameters-pane "Group" / "Ungroup" gesture (owner finding
// 2026-09-03: "ik wil ook kunnen groeperen in de right hand pane van de
// parameter stage"). The gesture reuses the section-canvas body-union client
// verbatim (``api.geology.createBodyUnion`` / ``deleteBodyUnion``); this module
// owns only the label-independent glue around it, kept pure so ``useUnitGrouping``
// stays a thin React shell and ``UnitListPane`` stays under the 500-line cap
// (debt #201).
//
// The one non-obvious modelling call: a group requires the members be ONE mass,
// which the section-canvas Join expresses as "same packing class" (``joinPick``).
// Each NAD class 1–31 belongs to exactly ONE soil family (``nadClasses.ts`` —
// e.g. 13–20 are all SILT), so "same NAD class" already implies "same soil":
// the pane keys its guard on ``nad_class`` alone, and the backend's
// ``body_union_cross_class`` 422 stays the ultimate authority (surfaced via
// ``joinErrorToastKey``), exactly as the canvas lets the write guard decide.

import type {
  BodyUnionListItem,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../../api/client'
import { firstLayerStampedToBody } from '../../../components/sections/joinPick'

/** Whether a checked selection can be grouped, and why not when it cannot. */
export type GroupGuardStatus =
  /** Two or more bodies, all the same NAD class — a group is legal. */
  | 'ok'
  /** Fewer than two bodies checked — nothing to group yet. */
  | 'need-two'
  /** The checked bodies span more than one NAD class — never one mass. */
  | 'cross-class'

/**
 * ``geotech body id → NAD class`` over the accepted geotech bands.
 *
 * A geotech body is class-homogeneous by construction (the resolver splits by
 * class), so the first accepted band's class stands for the whole body. Pending
 * bands are never a class source. Used for the same-class group guard.
 *
 * Parameters
 * ----------
 * geotechLayers
 *     Every geotech-model layer (any status; filtered to accepted here).
 * geotechFormations
 *     The geotech formation rows — each carries the band's ``nad_class``.
 *
 * Returns
 * -------
 * Map<string, number>
 *     ``body id → nad_class`` for every accepted, stamped, classified body.
 */
export function bodyNadClassMap(
  geotechLayers: readonly LithoLayerResponse[],
  geotechFormations: readonly GeologicalFormationResponse[],
): Map<string, number> {
  const nadByFormation = new Map<string, number>()
  for (const f of geotechFormations) if (f.nad_class != null) nadByFormation.set(f.id, f.nad_class)

  const out = new Map<string, number>()
  for (const l of geotechLayers) {
    if (l.status !== 'accepted') continue
    const bodyId = l.body_id ?? null
    if (bodyId === null) continue
    const nad = nadByFormation.get(l.formation_id)
    if (nad === undefined) continue
    if (!out.has(bodyId)) out.set(bodyId, nad)
  }
  return out
}

/**
 * ``geotech body id → anchor layer id`` for the given bodies.
 *
 * The anchor is the body's FIRST accepted stamped ``litho_layer`` — the same
 * label-independent identity currency the section-canvas Join uses
 * (``joinPick.firstLayerStampedToBody``), so a body always joins through the same
 * anchor whichever surface fires the verb. A body with no accepted stamped band
 * is omitted (never given an invented anchor).
 *
 * Parameters
 * ----------
 * bodyIds
 *     The bodies to resolve anchors for.
 * geotechLayers
 *     Every geotech-model layer (any status; filtered to accepted here).
 *
 * Returns
 * -------
 * Map<string, string>
 *     ``body id → anchor layer id`` for each body that has one.
 */
export function anchorLayersForBodies(
  bodyIds: readonly string[],
  geotechLayers: readonly LithoLayerResponse[],
): Map<string, string> {
  const bodyIdByLayerId = new Map<string, string | null>()
  const orderedLayerIds: string[] = []
  for (const l of geotechLayers) {
    if (l.status !== 'accepted') continue
    bodyIdByLayerId.set(l.id, l.body_id ?? null)
    orderedLayerIds.push(l.id)
  }

  const out = new Map<string, string>()
  for (const bodyId of bodyIds) {
    const anchor = firstLayerStampedToBody(orderedLayerIds, bodyId, bodyIdByLayerId)
    if (anchor !== null) out.set(bodyId, anchor)
  }
  return out
}

/**
 * The ``createBodyUnion`` anchor pairs that link N bodies into ONE group.
 *
 * A union is a PAIR, but "these N are one group" is the transitive closure, so a
 * star from the first anchor — ``(head, x)`` for every other ``x`` — yields one
 * connected component in ``n − 1`` POSTs. Bodies without a resolved anchor drop
 * out; fewer than two anchored bodies yields no pair.
 *
 * Parameters
 * ----------
 * bodyIds
 *     The checked bodies, in display order (the first becomes the star centre).
 * anchorByBody
 *     ``body id → anchor layer id`` (``anchorLayersForBodies``).
 *
 * Returns
 * -------
 * Array<[string, string]>
 *     ``[layer_a_id, layer_b_id]`` pairs to POST, or ``[]`` when nothing links.
 */
export function groupUnionPairs(
  bodyIds: readonly string[],
  anchorByBody: ReadonlyMap<string, string>,
): Array<[string, string]> {
  const anchored: string[] = []
  for (const id of bodyIds) {
    const anchor = anchorByBody.get(id)
    if (anchor !== undefined) anchored.push(anchor)
  }
  if (anchored.length < 2) return []
  const [head, ...rest] = anchored
  return rest.map(anchor => [head, anchor] as [string, string])
}

/**
 * Whether a checked selection can be grouped (same NAD class = one mass).
 *
 * Fewer than two bodies is ``need-two``; two or more spanning more than one
 * KNOWN class is ``cross-class``; otherwise ``ok``. A body whose class is unknown
 * (a roster race) is not counted against the guard — it never blocks, matching
 * the canvas rule that a missing class lets the backend write guard decide (a
 * label difference always implies a class difference, so an unknown class can
 * never hide a real cross-class the backend would then accept).
 *
 * Parameters
 * ----------
 * bodyIds
 *     The checked body ids.
 * classByBody
 *     ``body id → nad_class`` (``bodyNadClassMap``).
 *
 * Returns
 * -------
 * GroupGuardStatus
 *     ``ok`` / ``need-two`` / ``cross-class``.
 */
export function groupGuardStatus(
  bodyIds: readonly string[],
  classByBody: ReadonlyMap<string, number>,
): GroupGuardStatus {
  if (bodyIds.length < 2) return 'need-two'
  const classes = new Set<number>()
  for (const id of bodyIds) {
    const nad = classByBody.get(id)
    if (nad !== undefined) classes.add(nad)
  }
  return classes.size > 1 ? 'cross-class' : 'ok'
}

/**
 * The union-row ids that anchor a body — the "Ungroup" delete set.
 *
 * Removing a body from its group means lifting every union that references it;
 * the remaining members stay connected through their other unions. Reuses the
 * same ``deleteBodyUnion`` path as the canvas "Un-join from {label}".
 *
 * Parameters
 * ----------
 * bodyId
 *     The body to remove from its group.
 * unions
 *     The model's unions (``GET .../body-unions``).
 *
 * Returns
 * -------
 * string[]
 *     Every union id anchoring ``bodyId``, de-duplicated.
 */
export function unionIdsAnchoringBody(
  bodyId: string,
  unions: readonly BodyUnionListItem[],
): string[] {
  const ids = new Set<string>()
  for (const u of unions) {
    if (u.anchor_a.body_id === bodyId || u.anchor_b.body_id === bodyId) ids.add(u.id)
  }
  return [...ids]
}
