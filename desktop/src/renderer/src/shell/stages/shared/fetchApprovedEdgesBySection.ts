// Per-section approved-correlation-edge fetch shared by the 3D canvases.
//
// Correlation edges are section-scoped (each edge row carries a section_id —
// owner directive 2026-06-08), so every consumer that needs the model's edges
// fans out one listContactCorrelations call per visible section and keeps only
// the user-approved edges (the band/onlap/lens classifier consumes approved
// edges exclusively). This exact fetch+filter shape used to live 4× across
// LithologyCanvas / GeotechnicalCanvas (fence effect + voxel callback in each)
// — extracted per audit 2026-07-12 FE-SHELL-CLIENTS-11.
//
// A failed per-section fetch resolves to no edges for that section so the
// fan-out completes, but the failure is NOT lost: the failed ids come back in
// ``failedSectionIds`` and every caller MUST act on them. An empty edge list is
// indistinguishable from "this section genuinely has no correlations", so a
// caller that ignores the list builds a differently-tied model and cannot tell
// (audit 2026-08-02, Class 1) — the 3-D build path refuses outright and the
// Fence view warns, naming the sections. Any new consumer either refuses or
// reports the count to the user; logging it is not enough.

import { api } from '../../../api/client'

/**
 * One approved correlation edge, WITH the contact each end joins.
 *
 * The sides are not decoration: a ``base``<->``base`` bottom tie is what lets the
 * deepest unit of a column band, and the partition engine deliberately keeps that
 * signal apart from top-keyed edges. This type carried only ``a``/``b`` until
 * 2026-07-30, which silently downgraded every base tie to a top tie on the build
 * path and cost a clay three gaps of Cross-section 1 in the 3-D model.
 */
export interface ApprovedEdgePair {
  /** Contact id on the A side of the edge. */
  a: string
  /** Contact id on the B side of the edge. */
  b: string
  /** Which contact of layer ``a`` the edge joins. Omitted ⇒ ``'top'``. */
  aSide?: 'top' | 'base'
  /** Which contact of layer ``b`` the edge joins. Omitted ⇒ ``'top'``. */
  bSide?: 'top' | 'base'
}

/** Result of the per-section approved-edge fan-out. */
export interface ApprovedEdgesFetchResult {
  /** Approved edges keyed by section id (every requested section present). */
  edgesBySectionId: Map<string, ApprovedEdgePair[]>
  /** Sections whose fetch rejected (mapped to an empty edge list). */
  failedSectionIds: string[]
  /** Total approved edges across all sections (for phase-summary logging). */
  totalApprovedEdges: number
}

/**
 * Fetch each section's correlation edges in parallel and keep the approved ones.
 *
 * Parameters
 * ----------
 * projectId : string
 *     The app project id.
 * modelId : string
 *     The litho / geotech model id the edges belong to.
 * sections : readonly { id: string }[]
 *     The visible sections to fan out over.
 *
 * Returns
 * -------
 * Promise<ApprovedEdgesFetchResult>
 *     Approved edges per section + per-section failure ids + total count.
 */
export async function fetchApprovedEdgesBySection(
  projectId: string,
  modelId: string,
  sections: readonly { id: string }[],
): Promise<ApprovedEdgesFetchResult> {
  const failedSectionIds: string[] = []
  const edgeResults = await Promise.all(
    sections.map(section =>
      api.geology
        .listContactCorrelations(projectId, modelId, section.id)
        .then(
          edges =>
            [
              section.id,
              edges
                .filter(e => e.user_approved)
                .map(e => ({
                  a: e.layer_a_id,
                  b: e.layer_b_id,
                  aSide: e.layer_a_side,
                  bSide: e.layer_b_side,
                })),
            ] as const,
        )
        .catch(() => {
          failedSectionIds.push(section.id)
          return [section.id, [] as ApprovedEdgePair[]] as const
        }),
    ),
  )
  return {
    edgesBySectionId: new Map(edgeResults),
    failedSectionIds,
    totalApprovedEdges: edgeResults.reduce((sum, [, edges]) => sum + edges.length, 0),
  }
}
