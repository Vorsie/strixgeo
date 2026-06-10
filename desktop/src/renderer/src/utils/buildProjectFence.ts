// desktop/src/renderer/src/utils/buildProjectFence.ts
import { buildFencePanels, type FencePanel, type FenceRegion } from './fencePanels'
import { computeSectionFill, type CorrelationEdge } from './partitionFill'
import { assembleSectionPartitionInput, type FenceLayerInput, type FenceProjectedColumn } from './sectionFenceData'
import type { SectionEndpoints } from './sectionProjection'

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
  const all: FencePanel[] = []
  for (const s of sections) {
    const { columns, orderedColumns } = assembleSectionPartitionInput(s.projectedColumns, s.layers)
    if (columns.length < 2) continue
    const regions = computeSectionFill(columns, s.edges)
    const fenceRegions: FenceRegion[] = regions.map((r) => ({
      formationId: r.formationId,
      bodyId: r.bodyId,
      gapIndex: r.gapIndex,
      polygon: r.polygon,
    }))
    all.push(...buildFencePanels(s.section, orderedColumns, fenceRegions))
  }
  return all
}
