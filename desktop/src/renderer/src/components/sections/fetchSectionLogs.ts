// The CPT plot + borehole detail fetches the section panel makes on open, lifted
// out of ``useSectionData.ts`` so the cross-section PDF sheet builder makes the
// exact same round-trips (same client methods, same include list, same map
// keys). Extract-on-the-second-copy: the sheet is the second caller.
//
// Split per kind so ``useSectionData`` keeps its two INDEPENDENT effects (each
// with its own cancellation + null-then-set lifecycle) byte-identical, while the
// sheet builder takes the combined ``fetchSectionLogs`` in one await.

import { api } from '../../api/client'
import type { BoreholeDetailResponse } from '../../api/clients/borehole'
import type { CptPlotResponse } from '../../api/clients/cpt'

/** The three lab families the section's sample markers preview (debt #39). */
const SECTION_LAB_INCLUDE = ['grain_size', 'organic', 'scalar'] as const

/** One ``plot-batch`` round-trip → cpt id → plot. Empty in, empty map out. */
export async function fetchCptPlots(
  projectId: string,
  cptIds: readonly string[],
): Promise<Map<string, CptPlotResponse>> {
  const m = new Map<string, CptPlotResponse>()
  if (cptIds.length === 0) return m
  const plots = await api.cpt.plotBatch([...cptIds], projectId)
  for (const p of plots) m.set(p.cpt_id, p)
  return m
}

/** One ``detail-batch`` round-trip → borehole id → detail tree. Empty in, empty map out. */
export async function fetchBoreholeDetails(
  projectId: string,
  boreholeIds: readonly string[],
): Promise<Map<string, BoreholeDetailResponse>> {
  const m = new Map<string, BoreholeDetailResponse>()
  if (boreholeIds.length === 0) return m
  const boreholes = await api.borehole.detailBatch([...boreholeIds], projectId, [
    ...SECTION_LAB_INCLUDE,
  ])
  for (const bh of boreholes) m.set(bh.id, bh)
  return m
}

/**
 * Both column-log batches for a section, as the sheet builder needs them.
 *
 * Parameters
 * ----------
 * projectId : the app project id (server-side scope guard).
 * cptIds / boreholeIds : the ids to fetch; an empty list skips its round-trip.
 *
 * Returns
 * -------
 * The two maps keyed by investigation id.
 */
export async function fetchSectionLogs(
  projectId: string,
  cptIds: readonly string[],
  boreholeIds: readonly string[],
): Promise<{
  cptPlots: Map<string, CptPlotResponse>
  boreholeDetails: Map<string, BoreholeDetailResponse>
}> {
  const [cptPlots, boreholeDetails] = await Promise.all([
    fetchCptPlots(projectId, cptIds),
    fetchBoreholeDetails(projectId, boreholeIds),
  ])
  return { cptPlots, boreholeDetails }
}
