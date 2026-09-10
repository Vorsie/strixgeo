/**
 * Pair each packing band with the litho unit it subdivides, on its own column.
 *
 * {@link columnsNeedingRederive} knows what an overhang is; it does not know where the
 * bands and the units come from. This module is the join between them: geotech layers on
 * one side, litho layers on the other, and the geotech formation roster as the link
 * (`source_litho_formation_id` names the litho formation a NAD unit subdivides).
 *
 * Two rules here are load-bearing, and both were settled against the owner's real model
 * rather than by taste:
 *
 * 1. **The lookup is per COLUMN.** Two CPTs are two holes in the ground; the depth a
 *    formation occupies on one says nothing about the other. Matching on formation alone
 *    would judge a band against a unit metres away.
 * 2. **A formation may occur MORE THAN ONCE on one column, and usually does.** On the
 *    owner's litho model 119 of 199 (column, formation) pairs carry two or more rows —
 *    up to six — because a formation that recurs down a column is one formation with
 *    several bodies. Keeping one row per (column, formation) would judge most bands
 *    against the wrong body and report columns nobody had touched. Each band is therefore
 *    matched to the occurrence it actually overlaps.
 *
 * @module utils/geotechBandParents
 */
import type { GeologicalFormationResponse, LithoLayerResponse } from '../api/client'
import type { BandFit, BandParent } from './geotechParentFit'

/**
 * Index key for one occurrence set: a formation AS IT SITS on one column.
 *
 * @param columnId The CPT the row is anchored on.
 * @param formationId The litho formation.
 * @returns The composite key. Both halves are UUIDs, so the separator cannot appear
 *   inside either half and two different pairs can never collide on one key.
 */
function keyOf(columnId: string, formationId: string): string {
  return `${columnId}|${formationId}`
}

/**
 * How much of the depth interval `[aTop, aBase]` also lies in `[bTop, bBase]`, in metres.
 *
 * @param aTop First interval's top.
 * @param aBase First interval's base.
 * @param bTop Second interval's top.
 * @param bBase Second interval's base.
 * @returns The overlap, or 0 when the intervals are disjoint.
 */
function overlapM(aTop: number, aBase: number, bTop: number, bBase: number): number {
  return Math.max(0, Math.min(aBase, bBase) - Math.max(aTop, bTop))
}

/**
 * Which occurrence of a recurring unit a band belongs to.
 *
 * The one it overlaps most. A band that lies wholly inside an occurrence overlaps it by
 * its own full length, which no other occurrence can beat (litho occurrences on a column
 * do not overlap each other), so "fits one of them" always resolves to that one and the
 * column is judged as fitting.
 *
 * When a band overlaps NONE of them — the contact was dragged clean past it — the first
 * occurrence is returned rather than null. The band is then judged against a unit it lies
 * entirely outside, which is exactly the answer: that column needs re-deriving. Returning
 * null there would call the worst case "not staleness".
 *
 * @param candidates Every occurrence of the parent formation on the band's column; must
 *   not be empty.
 * @param topDepthM The band's top.
 * @param baseDepthM The band's base.
 * @returns The occurrence the band is judged against.
 */
function pickOccurrence(
  candidates: readonly BandParent[],
  topDepthM: number,
  baseDepthM: number,
): BandParent {
  let best = candidates[0]
  let bestOverlap = overlapM(topDepthM, baseDepthM, best.topDepthM, best.baseDepthM)
  for (const candidate of candidates.slice(1)) {
    const overlap = overlapM(topDepthM, baseDepthM, candidate.topDepthM, candidate.baseDepthM)
    // Ties are broken by depth, not by position in the list: a band straddling
    // the contact between two bodies overlaps both equally, and which one it is
    // paired with must not depend on the order the server returned the rows in.
    // The shallower body wins — an arbitrary but stable choice.
    if (overlap > bestOverlap || (overlap === bestOverlap && candidate.topDepthM < best.topDepthM)) {
      best = candidate
      bestOverlap = overlap
    }
  }
  return best
}

/**
 * Pair every packing band — CPT- or borehole-anchored — with the litho unit it
 * subdivides.
 *
 * Boreholes were skipped until 2026-09-10 on the argument that "Subdivide CPTs" cannot
 * re-derive one. Then the owner split a borehole's sand under a silt lens and turned
 * the top piece to GRIND, and the geotech axis kept reading ZAND·MD with nothing saying
 * the column was out of date. The mark on the drawing is the point; which verb fixes it
 * (Subdivide for a CPT, Divide boreholes for a borehole) is the tooltip's job.
 *
 * A band whose geotech formation is missing from the roster or carries no
 * `source_litho_formation_id` is paired with `null` and `parentMissingOnColumn: false`:
 * a data-integrity problem the rule downstream does not call stale. A band whose litho
 * parent formation is known but has no row left on this column is paired with `null`
 * and `parentMissingOnColumn: true`: the unit was re-composed or deleted, which IS
 * staleness.
 *
 * @param geotechLayers The committed packing bands of the active geotech model.
 * @param lithoLayers The committed rows of the active litho model.
 * @param geotechFormations The project's geotech unit roster; supplies the link from a
 *   band's formation to the litho formation it subdivides.
 * @returns One entry per band, ready for {@link columnsNeedingRederive}.
 */
export function pairBandsWithLithoParents(
  geotechLayers: readonly LithoLayerResponse[],
  lithoLayers: readonly LithoLayerResponse[],
  geotechFormations: readonly GeologicalFormationResponse[],
): BandFit[] {
  // (column, litho formation) → every occurrence of that unit on that column.
  const occurrences = new Map<string, BandParent[]>()
  for (const layer of lithoLayers) {
    const columnId = layer.cpt_id ?? layer.borehole_id
    if (columnId === null) continue
    const key = keyOf(columnId, layer.formation_id)
    const parent: BandParent = {
      formationId: layer.formation_id,
      topDepthM: layer.depth_top_m,
      baseDepthM: layer.depth_base_m,
    }
    const existing = occurrences.get(key)
    if (existing === undefined) occurrences.set(key, [parent])
    else existing.push(parent)
  }

  const parentFormationIdByUnitId = new Map<string, string | null>(
    geotechFormations.map(f => [f.id, f.source_litho_formation_id]),
  )

  const bands: BandFit[] = []
  for (const layer of geotechLayers) {
    const columnId = layer.cpt_id ?? layer.borehole_id
    if (columnId === null) continue
    const parentFormationId = parentFormationIdByUnitId.get(layer.formation_id) ?? null
    const candidates =
      parentFormationId === null ? undefined : occurrences.get(keyOf(columnId, parentFormationId))
    const noOccurrence = candidates === undefined || candidates.length === 0
    bands.push({
      columnId,
      topDepthM: layer.depth_top_m,
      baseDepthM: layer.depth_base_m,
      parent: noOccurrence ? null : pickOccurrence(candidates, layer.depth_top_m, layer.depth_base_m),
      // Known parent formation, no row of it on the column: re-composed or deleted.
      parentMissingOnColumn: parentFormationId !== null && noOccurrence,
    })
  }
  return bands
}
