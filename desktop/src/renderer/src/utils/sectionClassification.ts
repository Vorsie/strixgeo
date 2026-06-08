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
