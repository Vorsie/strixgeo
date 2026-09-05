// desktop/src/renderer/src/utils/buildProjectFence.ts
import { buildFencePanels, type FenceColumn, type FencePanel, type FenceRegion } from './fencePanels'
import { mergeFencePanels } from './mergeFencePanels'
import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { computeSectionFillActive } from './partitionEngineSelect'
import {
  assembleSectionsWithCanonical,
  type FenceLayerInput,
  type FenceProjectedColumn,
} from './sectionFenceData'
import { type SectionEndpoints } from './sectionProjection'

/** Everything needed to fence one section. */
export interface FenceSectionInput {
  /**
   * The cross-section's id, when the caller has it. The body-recompute wire
   * REQUIRES it (audit P1-3: the server verifies the payload covers every
   * section); the fence render does not read it.
   */
  sectionId?: string
  section: SectionEndpoints
  projectedColumns: readonly FenceProjectedColumn[]
  layers: readonly FenceLayerInput[]
  edges: readonly CorrelationEdge[]
}

/**
 * Build the whole-project fence: one set of wall panels per section, flattened.
 *
 * For each section: assemble the partition input (accepted layers + ordered
 * columns), run ``computeSectionFill`` with that section's approved edges,
 * normalise each region to a ``FenceRegion`` (carrying its gap index), and
 * project to world-space panels. Sections with <2 columns yield nothing.
 *
 * **Tie rungs snap to the cross-section walls.** Each column is drawn at a
 * CANONICAL world position per test id — the projected position on the DENSEST
 * section that contains the test. A cross-section (many columns) is the densest
 * section for its own tests, so it renders unchanged; a tie (two columns) is
 * sparse, so its two ends inherit the cross-sections' column positions and the
 * rung meets the walls cleanly (dogfeed 2026-06-10). Pure view geometry — the
 * correlation data fed to the solid builder is untouched.
 *
 * Parameters
 * ----------
 * sections : readonly FenceSectionInput[]
 *     One entry per section in the project (order is irrelevant — each section
 *     is independent).
 *
 * resolveBody : optional
 *     ``layerIds → body id | null`` — the label-independent body identity used to
 *     collapse a section's per-gap panels to ONE panel per connected body (debt
 *     #278 fence follow-on). Supplied by the scoped call site (backed by
 *     ``resolveRegionBodyId`` + the axis's ``litho_layer id → body_id`` map).
 *     When omitted, ``mergeFencePanels`` falls back to ``formationId|bodyId``
 *     label grouping — correct on the litho arm, whose labels are cross-gap
 *     consistent.
 *
 * Returns
 * -------
 * FencePanel[]
 *     All wall panels across every section, ready for 3D rendering. Each panel
 *     carries ``formationId``, ``bodyId``, world-space ``vertices`` and
 *     ``triangles``. One panel per connected body per section.
 */
export function buildProjectFence(
  sections: readonly FenceSectionInput[],
  frameSections?: readonly FenceSectionInput[],
  packingClassOf?: ReadonlyMap<string, string>,
  resolveBody?: (layerIds: readonly string[] | undefined) => string | null,
): FencePanel[] {
  // Pass 1 (shared with ``buildVoxelRequest``): assemble every section +
  // compute the canonical per-test world positions.
  const { assembled, canonical } = assembleSectionsWithCanonical(sections)

  // THE LITHO FRAME, for a GEOTECH fence (owner ruling 2026-08-18): with it the
  // panels carry the SAME hierarchical fill the geotech axis renders and the
  // voxel build posts. Without it (every litho fence) nothing changes.
  const sectionKey = (input: FenceSectionInput): string =>
    input.sectionId ??
    `${input.section.start_x},${input.section.start_y},${input.section.end_x},${input.section.end_y}`
  const frameByKey = new Map<
    string,
    { columns: PartitionColumn[]; orderedColumns: FenceColumn[]; edges: readonly CorrelationEdge[] }
  >()
  if (frameSections !== undefined) {
    for (const f of assembleSectionsWithCanonical(frameSections).assembled) {
      frameByKey.set(sectionKey(f.input), {
        columns: f.columns,
        orderedColumns: f.orderedColumns,
        edges: f.input.edges,
      })
    }
  }

  // Pass 2: build panels, stamping each column's canonical world position.
  const all: FencePanel[] = []
  for (const { input, columns, orderedColumns } of assembled) {
    const lithoFrame = frameByKey.get(sectionKey(input))
    // The frame owns the axis when it is present — its columns carry the tests
    // the packing model has not divided, and the regions are indexed on ITS gaps.
    const axisColumns = lithoFrame ? lithoFrame.orderedColumns : orderedColumns
    const worldColumns: FenceColumn[] = axisColumns.map((c) => {
      const w = canonical.get(c.investigationId)
      return w ? { ...c, worldX: w.x, worldY: w.y } : c
    })
    // ⚠ KNOWN DIVERGENCE (audit FE-UTILS-09 — deliberate, owner decision
    // pending): this call does NOT pass the per-column ``alongM`` array, so
    // the deep-to-deep substrate pass slices each gap's deep band at the
    // UNIFORM fallback spacing. The on-screen partition
    // (PartitionFillOverlay) and the voxel build (buildVoxelRequest) BOTH
    // pass the real alongM — they are the app-faithful variant. Passing
    // alongM here would change the rendered 3D fence panels, so the drift is
    // kept explicit rather than silently unified; align it deliberately (add
    // ``orderedColumns.map((c) => c.alongM)`` as the 4th arg) when the owner
    // signs off on the fence render change.
    const regions = lithoFrame
      ? computeHierarchicalGeotechFill({
          lithoColumns: lithoFrame.columns,
          lithoEdges: lithoFrame.edges,
          // The frame's own partition. Unlike the litho arm above this DOES
          // pass the real along-metres: the hierarchical fill works in absolute
          // along-section position, so a uniform fallback would put the family
          // runs on a different axis than their clip. The known divergence is
          // the litho arm's, and it stays exactly as it was.
          lithoRegions: computeSectionFillActive(
            lithoFrame.columns,
            lithoFrame.edges,
            undefined,
            lithoFrame.orderedColumns.map((c) => c.alongM),
          ),
          geotechColumns: frameAlignedColumns(
            lithoFrame.columns,
            new Map(columns.map((c) => [c.investigationId, c])),
          ),
          geotechEdges: input.edges,
          alongM: lithoFrame.orderedColumns.map((c) => c.alongM),
          // Same class identity as the render — one mass one body (2026-08-21).
          packingClassOf,
        }).regions
      : computeSectionFillActive(columns, input.edges)
    const fenceRegions: FenceRegion[] = regions.map((r) => ({
      formationId: r.formationId,
      bodyId: r.bodyId,
      // The label-independent identity: the cutout's body scope resolves a
      // panel through THESE, never through the bodyId label above (which the
      // weld mints locally / the recompute rewrites — the CS1 wall gaps).
      layerIds: r.layerIds,
      gapIndex: r.gapIndex,
      polygon: r.polygon,
    }))
    // Collapse this section's per-gap panels to one per connected body before
    // pushing — the shared column seams weld away (debt #278 fence follow-on).
    // Every wall names its section so the DXF export can split layers per
    // section (owner ruling 2026-09-05: a whole section can be switched off in CAD).
    const stamped = buildFencePanels(input.section, worldColumns, fenceRegions).map(p =>
      input.sectionId === undefined ? p : { ...p, sectionId: input.sectionId },
    )
    all.push(...mergeFencePanels(stamped, resolveBody))
  }
  return all
}
