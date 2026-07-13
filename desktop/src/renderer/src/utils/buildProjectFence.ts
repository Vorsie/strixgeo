// desktop/src/renderer/src/utils/buildProjectFence.ts
import { buildFencePanels, type FenceColumn, type FencePanel, type FenceRegion } from './fencePanels'
import { computeSectionFill, type CorrelationEdge } from './partitionFill'
import {
  assembleSectionsWithCanonical,
  type FenceLayerInput,
  type FenceProjectedColumn,
} from './sectionFenceData'
import { type SectionEndpoints } from './sectionProjection'

/** Everything needed to fence one section. */
export interface FenceSectionInput {
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
 * Returns
 * -------
 * FencePanel[]
 *     All wall panels across every section, ready for 3D rendering. Each panel
 *     carries ``formationId``, ``bodyId``, world-space ``vertices`` and
 *     ``triangles``.
 */
export function buildProjectFence(sections: readonly FenceSectionInput[]): FencePanel[] {
  // Pass 1 (shared with ``buildVoxelRequest``): assemble every section +
  // compute the canonical per-test world positions.
  const { assembled, canonical } = assembleSectionsWithCanonical(sections)

  // Pass 2: build panels, stamping each column's canonical world position.
  const all: FencePanel[] = []
  for (const { input, columns, orderedColumns } of assembled) {
    const worldColumns: FenceColumn[] = orderedColumns.map((c) => {
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
    const regions = computeSectionFill(columns, input.edges)
    const fenceRegions: FenceRegion[] = regions.map((r) => ({
      formationId: r.formationId,
      bodyId: r.bodyId,
      gapIndex: r.gapIndex,
      polygon: r.polygon,
    }))
    all.push(...buildFencePanels(input.section, worldColumns, fenceRegions))
  }
  return all
}
