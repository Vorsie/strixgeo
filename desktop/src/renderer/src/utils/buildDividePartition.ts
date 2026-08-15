import { assembleSectionPartitionFrames, toRegionInputs } from "./buildVoxelRequest";
import type { SectionPartitionInput } from "./buildVoxelRequest";
import type { FenceSectionInput } from "./buildProjectFence";
import { computeSectionFillActive } from "./partitionEngineSelect";
import { log } from "./log";

/**
 * Build the partition payload "4 · Divide boreholes" reads a borehole off.
 *
 * Owner ruling 2026-08-15: *"the borehole thing is really a geometry problem,
 * we draw half length lenses between two cpts same for onlaps. you just need to
 * check if a borehole column intersects a lens or onlap"*.  The backend does
 * exactly that — it casts each borehole's vertical line through this partition
 * and reads off what the line cuts — so what this function has to get right is
 * WHICH partition it sends.
 *
 * The boreholes are excluded from the columns
 * -------------------------------------------
 * This is the whole subtlety, and getting it wrong is silent.  A borehole that
 * a previous press already divided carries geotech bands, so the fill would
 * treat it as a COLUMN and split the gap at it.  The borehole would then stand
 * on a gap edge rather than inside a gap, there would be no geometry spanning
 * it to intersect, and the divide would have nothing to read — it would look
 * like the feature simply did not work, on the second press only.
 *
 * Excluding them makes the payload the CPT-to-CPT partition: the geometry as
 * it is *between* the tests that actually measured something, which is the
 * geometry the borehole is supposed to be a sample of.
 *
 * Parameters
 * ----------
 * section : FenceSectionInput
 *     The open section's geotech-axis inputs — geotech bands as layers, the
 *     ACCEPTED geotech packing edges, and every projected column.
 * boreholeInvestigationIds : ReadonlySet<string>
 *     The investigation ids that are boreholes.  These are dropped from the
 *     columns before the fill runs.
 *
 * Returns
 * -------
 * SectionPartitionInput | null
 *     The partition, or ``null`` when fewer than two CPT columns remain — one
 *     column has no gap, so there is no geometry for a borehole to stand in and
 *     the backend's donor rule should answer instead.
 */
export function buildDividePartition(
  section: FenceSectionInput,
  boreholeInvestigationIds: ReadonlySet<string>,
): SectionPartitionInput | null {
  const cptOnly: FenceSectionInput = {
    ...section,
    projectedColumns: section.projectedColumns.filter(
      (column) => !boreholeInvestigationIds.has(column.investigationId),
    ),
    layers: section.layers.filter(
      (layer) => !boreholeInvestigationIds.has(layer.investigationId),
    ),
  };
  if (cptOnly.projectedColumns.length < 2) {
    log.info(
      "geotech-divide",
      `divide partition: ${cptOnly.projectedColumns.length} CPT column(s) after ` +
        "dropping boreholes — no gap to read, leaving the donor rule to answer",
    );
    return null;
  }

  const frames = assembleSectionPartitionFrames([cptOnly]);
  const frame = frames[0];
  if (frame === undefined) return null;

  const engineRegions = computeSectionFillActive(
    frame.columns,
    frame.input.edges,
    frame.apexOverrides,
    frame.alongM,
  );
  const regions = toRegionInputs(engineRegions);
  log.info(
    "geotech-divide",
    `divide partition: ${frame.payloadColumns.length} CPT column(s), ${regions.length} region(s), ` +
      `${frame.input.edges.length} accepted edge(s), boreholes excluded=${boreholeInvestigationIds.size}`,
  );

  return {
    start_x: frame.input.section.start_x,
    start_y: frame.input.section.start_y,
    end_x: frame.input.section.end_x,
    end_y: frame.input.section.end_y,
    columns: frame.payloadColumns,
    regions,
  };
}
