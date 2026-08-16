// Async assembly of the partition payload "4 · Divide boreholes" reads a
// borehole off — the divide sibling of ``makeVoxelRequestBuilder`` and
// ``makeBodyRecomputeBuilder``, sharing their shape on purpose: fetch the
// section-scoped approved edges fresh at fire time, refuse on partial input,
// assemble the fence inputs, and hand a pure builder the rest.
//
// Owner ruling 2026-08-15: *"the borehole thing is really a geometry problem,
// we draw half length lenses between two cpts same for onlaps. you just need to
// check if a borehole column intersects a lens or onlap"*. The backend does the
// intersecting; this decides WHICH geometry it intersects.
//
// Differences from the two siblings, each deliberate:
//   * ONE section, not every visible one — step 4 is section-scoped, and a
//     partition for a section the press does not divide is dead weight on the
//     wire.
//   * Suspended review edges are KEPT (the voxel rule, not the body-recompute
//     rule): the divide must read the geometry the engineer is looking at, and
//     that is what the 2-D overlay draws.
//   * A refusal returns null and the caller presses on with the donor rule,
//     which is strictly today's behaviour — a borehole can never come out worse
//     than it does now because the geometry failed to load.

import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type LithoLayerLike,
  type SectionLike,
} from '../../../utils/assembleLithoSectionInputs'
import { buildDividePartition } from '../../../utils/buildDividePartition'
import { DIVIDE_GEOMETRY_ENABLED } from '../../../utils/divideGeometryFlag'
import type { SectionPartitionInput } from '../../../utils/buildVoxelRequest'
import { log } from '../../../utils/log'
import { fetchApprovedEdgesBySection } from './fetchApprovedEdgesBySection'

/** Inputs the divide-partition assembly reads at fire time. */
export interface DividePartitionAssemblyParams {
  /** The app project id, or null when no project is open. */
  projectId: string | null
  /** The GEOTECH model id — the partition is of its bands, not the litho ones. */
  geotechModelId: string | null
  /** The one section being divided. */
  section: SectionLike | null
  /** All visible CPTs + boreholes in the projection shape. */
  investigations: readonly InvestigationLocation[]
  /** The geotech model's band rows. */
  layers: readonly LithoLayerLike[]
  /** Investigation ids that are boreholes — excluded from the partition columns. */
  boreholeInvestigationIds: ReadonlySet<string>
}

/**
 * Assemble the partition for one section, keyed by section id for the wire.
 *
 * Parameters
 * ----------
 * params : DividePartitionAssemblyParams
 *     The fire-time snapshot of the section's geotech inputs.
 *
 * Returns
 * -------
 * Promise<Record<string, SectionPartitionInput> | null>
 *     ``{ [sectionId]: partition }``, or ``null`` when the geometry cannot be
 *     assembled — no project / model / section, the edge fetch failed, fewer
 *     than two CPT columns remain, or the fill produced nothing. Every one of
 *     those means "let the donor rule answer", never "write nothing".
 */
export async function assembleDividePartition(
  params: DividePartitionAssemblyParams,
): Promise<Record<string, SectionPartitionInput> | null> {
  const { projectId, geotechModelId, section, investigations, layers } = params
  // Off by default — see ``divideGeometryFlag``. Returning null here (rather
  // than gating at the call site) keeps the whole path one import away from
  // being live again, and means the divide behaves EXACTLY as it did before
  // the geometry existed: the backend answers with the donor rule.
  if (!DIVIDE_GEOMETRY_ENABLED) return null
  if (!projectId || !geotechModelId || section === null) return null

  const { edgesBySectionId, failedSectionIds } = await fetchApprovedEdgesBySection(
    projectId,
    geotechModelId,
    [section],
  )
  if (failedSectionIds.length > 0) {
    log.warn(
      'geotech-divide',
      'divide partition skipped: the section correlations failed to load — reading ' +
        'a borehole off a partition built from partial ties would place bands the ' +
        'engineer never drew; the donor rule answers instead',
    )
    return null
  }

  const sectionInputs = assembleLithoSectionInputs({
    visibleSections: [section],
    investigations,
    lithoLayers: layers,
    edgesBySectionId,
  })
  const sectionInput = sectionInputs[0]
  if (sectionInput === undefined) return null

  const partition = buildDividePartition(sectionInput, params.boreholeInvestigationIds)
  if (partition === null) return null

  // Named so a divide that fell back to the donor rule is distinguishable from
  // one that read the geometry, without re-running anything.
  log.info(
    'geotech-divide',
    `divide partition ready: section=${section.id} ` +
      `${partition.columns.length} CPT column(s), ${partition.regions.length} region(s)`,
  )
  return { [section.id]: partition }
}

/** Re-exported so callers need one import for the whole divide-geometry path. */
export type { SectionPartitionInput }
