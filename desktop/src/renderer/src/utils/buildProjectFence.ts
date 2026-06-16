// desktop/src/renderer/src/utils/buildProjectFence.ts
import { buildFencePanels, type FenceColumn, type FencePanel, type FenceRegion } from './fencePanels'
import { computeSectionFill, type CorrelationEdge, type PartitionColumn } from './partitionFill'
import {
  assembleSectionPartitionInput,
  computeCanonicalColumnWorldPositions,
  type AssembledSection,
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
  // Pass 1: assemble every section, keeping only those with a fillable gap
  // (>=2 columns), then compute the canonical per-test world positions across
  // all of them (the dense cross-section owns each position; sparse ties inherit
  // it — see ``computeCanonicalColumnWorldPositions``).
  const assembled: { input: FenceSectionInput; columns: PartitionColumn[]; orderedColumns: FenceColumn[] }[] = []
  for (const input of sections) {
    const { columns, orderedColumns } = assembleSectionPartitionInput(input.projectedColumns, input.layers)
    if (columns.length < 2) continue
    assembled.push({ input, columns, orderedColumns })
  }
  const canonical = computeCanonicalColumnWorldPositions(
    assembled.map<AssembledSection>(({ input, columns, orderedColumns }) => ({
      section: input.section,
      columns,
      orderedColumns,
    })),
  )

  // Pass 2: build panels, stamping each column's canonical world position.
  const all: FencePanel[] = []
  for (const { input, columns, orderedColumns } of assembled) {
    const worldColumns: FenceColumn[] = orderedColumns.map((c) => {
      const w = canonical.get(c.investigationId)
      return w ? { ...c, worldX: w.x, worldY: w.y } : c
    })
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
