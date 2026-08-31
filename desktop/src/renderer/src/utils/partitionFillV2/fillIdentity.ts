/**
 * partitionFillV2/fillIdentity.ts — the GEOMETRIC-IDENTITY view of one fill pass
 * (slice 5, "persist geometric body identity").
 *
 * The display merge (``mergeTouchingBodies`` inside ``computeSectionFillV2``) unions
 * same-litho regions THROUGH substrate/flood fallback paint so the render reads as one
 * coherent body. The identity the backend PERSISTS must not: inferred fill is not
 * evidence that two drilled bodies are one. This module runs the same weld with
 * ``excludeFallback`` on the PRE-merge sliced regions — the groups carry LAYER ids
 * (see ``FillIdentity``) — and is invoked only when a caller asks
 * (``classifyOverrideOutcome``'s ``withIdentity``); the render path never pays it.
 *
 * Before the weld, the identity pass AUGMENTS each non-fallback region's ``layerIds``
 * with GEOMETRIC COLUMN-EDGE ATTRIBUTION (the S10–S6 refused-tie defect, dogfeed
 * 2026-08-12): the face-seed path names only the SEED units, and the enclosed-lens
 * merge can splice an interbedded column's middle same-formation units out of the
 * normalised stack entirely — their layer ids then appear in ZERO regions and can
 * never join a connectivity group. The augmentation reads the RAW drilled stacks
 * (``rawLayerContacts``, captured before the merge mutates them): a region's paint
 * reaching a column over an elevation window that STRICTLY overlaps (> 1 mm,
 * mirroring the backend's ``_ELEV_OVERLAP_M``) a same-formation drilled unit is
 * evidence OF that unit, whatever the seed said. Identity path only — the default
 * render/build output stays byte-identical.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import {
  edgeElevInterval,
  gapEdgeFractionTol,
  mergeTouchingBodiesWithGroups,
} from './mergeTouchingBodies'
import { type ColumnGeom, type RawLayerContact } from './sectionGeom'
import { twoSidedTerminationsEnabled } from './tileFlags'
import { type SectionRegion } from '../sectionPartition'

/**
 * Strict elevation-overlap floor (metres) for column-edge attribution — mirrors the
 * backend's ``_ELEV_OVERLAP_M`` (``merge_bodies_across_sections.py``): a shared
 * contact LINE (a unit merely touching the span at its top/base) is not overlap.
 */
const ELEV_OVERLAP_M = 1e-3

/**
 * The identity view of a fill pass: the sliced regions relabelled by the
 * fallback-excluding weld, plus that weld's merge groups in LAYER-id space —
 * per connected component, the union of member regions' ``layerIds``
 * (components contributing fewer than two layers are dropped). Layer ids are
 * the wire currency of the recompute because they never change; body-id
 * groups could not survive their own success (a merge relabelled the
 * refetched regions and erased its own evidence — facts flapping 74→3→69
 * live, dogfeed 2026-08-12 evening).
 */
export interface FillIdentity {
  regions: SectionRegion[]
  groups: string[][]
}

/**
 * Augment each non-fallback region's ``layerIds`` with the same-formation RAW
 * drilled units its paint geometrically covers at its gap's two column edges.
 *
 * At each edge (gap-local fraction 0 = left column ``gapIndex``, 1 = right column
 * ``gapIndex + 1``), the region's elevation span is sampled with the engine's own
 * gap-edge snap tolerance (``gapEdgeFractionTol`` / ``edgeElevInterval`` — the exact
 * machinery the weld's cross-gap touch uses). Every unit of that column's RAW stack
 * sharing the region's formation whose drilled interval STRICTLY overlaps the span
 * (> ``ELEV_OVERLAP_M``) contributes its layer id; the result is the UNION with the
 * existing seed-derived ids (seeds kept, duplicates dropped). Fallback-painted
 * regions are returned untouched — inferred fill names no layer.
 *
 * Parameters
 * ----------
 * sliced : readonly SectionRegion[]
 *     The pass's pre-merge sliced regions.
 * sectionColumns : readonly ColumnGeom[]
 *     The pass's normalised columns (supply x for the per-gap snap tolerance).
 * rawLayerContacts : ReadonlyMap<string, RawLayerContact> | undefined
 *     Every RAW picked unit's contacts + formation, keyed by layerId (captured
 *     BEFORE the enclosed-lens merge mutates the stacks). Absent → no-op copy.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     New array; augmented regions are shallow copies, untouched regions are the
 *     original objects.
 */
export function augmentRegionLayerIdsAtColumnEdges(
  sliced: readonly SectionRegion[],
  sectionColumns: readonly ColumnGeom[],
  rawLayerContacts: ReadonlyMap<string, RawLayerContact> | undefined,
): SectionRegion[] {
  if (!rawLayerContacts || rawLayerContacts.size === 0) return [...sliced]
  // Raw drilled units per surviving column, in the deterministic capture order
  // (columns left→right, units shallow→deep — Map preserves insertion order).
  const rawByCol = new Map<number, { layerId: string; contact: RawLayerContact }[]>()
  for (const [layerId, contact] of rawLayerContacts) {
    let arr = rawByCol.get(contact.colIndex)
    if (!arr) {
      arr = []
      rawByCol.set(contact.colIndex, arr)
    }
    arr.push({ layerId, contact })
  }
  return sliced.map((r) => {
    if (r.fallback === true) return r // inferred fill names no layer
    // The region's OWN gap's snap tolerance — one 1 mm cell in its fraction space,
    // exactly what the weld uses for "reaches the column".
    const tol = gapEdgeFractionTol(sectionColumns, r.gapIndex)
    const ids = [...(r.layerIds ?? [])]
    let added = false
    for (const edge of [0, 1] as const) {
      const units = rawByCol.get(r.gapIndex + edge)
      if (!units) continue
      const span = edgeElevInterval(r.polygon, edge, tol)
      if (!span) continue // the paint does not reach this column
      for (const { layerId, contact } of units) {
        if (contact.formationId !== r.formationId) continue
        // STRICT overlap (> 1 mm): a unit merely sharing a contact line with the
        // span is abutment, not coverage.
        if (Math.min(span[1], contact.topElev) - Math.max(span[0], contact.baseElev) <= ELEV_OVERLAP_M)
          continue
        if (!ids.includes(layerId)) {
          ids.push(layerId)
          added = true
        }
      }
    }
    return added ? { ...r, layerIds: ids } : r
  })
}

/**
 * Compute the identity view of one pass's PRE-merge sliced regions.
 *
 * Parameters
 * ----------
 * sliced : readonly SectionRegion[]
 *     The pass's pre-merge sliced regions (original body ids intact).
 * sectionColumns : readonly ColumnGeom[]
 *     The pass's normalised columns — supplies the same per-gap snap tolerance
 *     the display merge used, so identity and display weld on identical geometry.
 * rawLayerContacts : ReadonlyMap<string, RawLayerContact>, optional
 *     The pass's raw drilled stacks, feeding the column-edge attribution
 *     (``augmentRegionLayerIdsAtColumnEdges``). Absent → seed ids only (legacy).
 *
 * Returns
 * -------
 * FillIdentity
 *     Flag-ON: the column-edge-augmented ``excludeFallback`` weld + groups. Flag-OFF
 *     has no display merge either, so identity is the raw regions with no groups
 *     (nothing welded).
 */
export function computeFillIdentity(
  sliced: readonly SectionRegion[],
  sectionColumns: readonly ColumnGeom[],
  rawLayerContacts?: ReadonlyMap<string, RawLayerContact>,
): FillIdentity {
  if (!twoSidedTerminationsEnabled()) return { regions: [...sliced], groups: [] }
  const augmented = augmentRegionLayerIdsAtColumnEdges(sliced, sectionColumns, rawLayerContacts)
  return mergeTouchingBodiesWithGroups(augmented, sectionColumns, { excludeFallback: true })
}
