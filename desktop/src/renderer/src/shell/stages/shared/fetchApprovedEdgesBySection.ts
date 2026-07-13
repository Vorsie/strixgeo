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
// A failed per-section fetch degrades to no edges for that section rather than
// aborting the whole fan-out (the partition still fills, just without that
// section's correlations); the failed ids are reported so callers can log
// which sections came back empty due to error vs genuinely no edges.

import { api } from '../../../api/client'

/** One approved correlation edge as a contact-id pair. */
export interface ApprovedEdgePair {
  /** Contact id on the A side of the edge. */
  a: string
  /** Contact id on the B side of the edge. */
  b: string
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
                .map(e => ({ a: e.layer_a_id, b: e.layer_b_id })),
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
