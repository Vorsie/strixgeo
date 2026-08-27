// Classification-follows-the-test (owner directive 2026-06-08): a section shows
// the classification of every test in its corridor, not only the contacts it was
// explicitly seeded with. This helper returns the in-corridor investigation id
// set the render + correlate gates filter contacts by.
import { investigationsOnSection } from './sectionProjection'
import type { InvestigationPoint, SectionEndpoints } from './sectionProjection'

type SectionCorridor = SectionEndpoints & {
  projection_buffer_m: number
  excluded_cpt_ids?: readonly string[]
  excluded_borehole_ids?: readonly string[]
}

/**
 * Ids of every CPT + borehole the section projects into its corridor
 * (within ``projection_buffer_m``, not excluded). A contact/layer belongs to a
 * section iff its anchor investigation is in this set.
 *
 * @param section - The section's endpoints, projection buffer, and excluded ids.
 * @param cpts - All model CPTs as projectable points.
 * @param boreholes - All model boreholes as projectable points.
 * @returns The set of investigation ids the section displays.
 */
export function inCorridorInvestigationIds(
  section: SectionCorridor,
  cpts: readonly InvestigationPoint[],
  boreholes: readonly InvestigationPoint[],
): Set<string> {
  const ids = new Set<string>()
  const exCpt = new Set(section.excluded_cpt_ids ?? [])
  const exBh = new Set(section.excluded_borehole_ids ?? [])
  for (const p of investigationsOnSection(section, cpts, exCpt)) ids.add(p.item.id)
  for (const p of investigationsOnSection(section, boreholes, exBh)) ids.add(p.item.id)
  return ids
}

/**
 * The canonical membership rule folded over every section: per-section member
 * investigation id sets, keyed by section id.
 *
 * Membership is ``inCorridorInvestigationIds``'s answer — in corridor AND
 * between the endpoints, exclusions honoured — never a re-derivation. The
 * union over the map's values is "on the sections", which is the pooling
 * population of the per-unit statistics (owner ruling 2026-08-27: "Only cpt's
 * on the sections should be in the pooling"). Callers feed the app's VISIBLE
 * lists so project-removed and manifest-gated investigations are already out.
 *
 * @param sections - Sections with ids, endpoints, buffers, and exclusions.
 * @param cpts - Visible CPTs as projectable points.
 * @param boreholes - Visible boreholes as projectable points.
 * @returns Per-section member id sets, in the sections' order.
 */
export function memberIdsBySection(
  sections: readonly (SectionCorridor & { id: string })[],
  cpts: readonly InvestigationPoint[],
  boreholes: readonly InvestigationPoint[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const section of sections) {
    out.set(section.id, inCorridorInvestigationIds(section, cpts, boreholes))
  }
  return out
}
