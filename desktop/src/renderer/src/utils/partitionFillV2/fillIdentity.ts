/**
 * partitionFillV2/fillIdentity.ts — the GEOMETRIC-IDENTITY view of one fill pass
 * (slice 5, "persist geometric body identity").
 *
 * The display merge (``mergeTouchingBodies`` inside ``computeSectionFillV2``) unions
 * same-litho regions THROUGH substrate/flood fallback paint so the render reads as one
 * coherent body. The identity the backend PERSISTS must not: inferred fill is not
 * evidence that two drilled bodies are one. This module runs the same weld with
 * ``excludeFallback`` on the PRE-merge sliced regions — so the groups carry the
 * ORIGINAL body ids — and is invoked only when a caller asks
 * (``classifyOverrideOutcome``'s ``withIdentity``); the render path never pays it.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { mergeTouchingBodiesWithGroups } from './mergeTouchingBodies'
import { type ColumnGeom } from './sectionGeom'
import { twoSidedTerminationsEnabled } from './tileFlags'
import { type SectionRegion } from '../partitionFill'

/**
 * The identity view of a fill pass: the sliced regions relabelled by the
 * fallback-excluding weld, plus that weld's merge groups (original body ids
 * per connected component).
 */
export interface FillIdentity {
  regions: SectionRegion[]
  groups: string[][]
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
 *
 * Returns
 * -------
 * FillIdentity
 *     Flag-ON: the ``excludeFallback`` weld + groups. Flag-OFF has no display
 *     merge either, so identity is the raw regions with no groups (nothing welded).
 */
export function computeFillIdentity(
  sliced: readonly SectionRegion[],
  sectionColumns: readonly ColumnGeom[],
): FillIdentity {
  if (!twoSidedTerminationsEnabled()) return { regions: [...sliced], groups: [] }
  return mergeTouchingBodiesWithGroups(sliced, sectionColumns, { excludeFallback: true })
}
