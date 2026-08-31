// desktop/src/renderer/src/utils/sectionFenceData.ts
import type { FenceColumn } from './fencePanels'
import type { PartitionColumn, PartitionUnit } from './sectionPartition'
import { projectionFoot, type SectionEndpoints } from './sectionProjection'

/** A projected investigation column on a section (output of investigationsOnSection + elevation). */
export interface FenceProjectedColumn {
  investigationId: string
  alongM: number
  surfaceElevM: number | null
}

/** An accepted-or-not litho layer keyed to an investigation. */
export interface FenceLayerInput {
  investigationId: string
  layerId: string
  formationId: string
  bodyId: string | null
  topDepthM: number
  baseDepthM: number
  accepted: boolean
}

/**
 * Build the ordered ``PartitionColumn[]`` (input to ``computeSectionFill``) plus
 * the matching ``FenceColumn[]`` (investigationId + alongM) for one section.
 *
 * Mirrors the column assembly in ``PartitionFillOverlay`` but pure + reusable:
 * keeps only accepted layers, drops columns with no accepted layers or a null
 * surface elevation, sorts columns by along-position and each column's units
 * shallow→deep.
 *
 * Parameters
 * ----------
 * projectedColumns : readonly FenceProjectedColumn[]
 *     Investigations projected onto the section (any order).
 * layers : readonly FenceLayerInput[]
 *     Litho layers across the project (filtered to these columns internally).
 *
 * Returns
 * -------
 * { columns: PartitionColumn[]; orderedColumns: FenceColumn[] }
 *     ``columns`` and ``orderedColumns`` share the same order (left→right by along).
 */
export function assembleSectionPartitionInput(
  projectedColumns: readonly FenceProjectedColumn[],
  layers: readonly FenceLayerInput[],
): { columns: PartitionColumn[]; orderedColumns: FenceColumn[] } {
  const unitsByInv = new Map<string, PartitionUnit[]>()
  for (const layer of layers) {
    if (!layer.accepted) continue
    const unit: PartitionUnit = {
      topDepthM: layer.topDepthM,
      baseDepthM: layer.baseDepthM,
      formationId: layer.formationId,
      bodyId: layer.bodyId,
      layerId: layer.layerId,
    }
    const bucket = unitsByInv.get(layer.investigationId)
    if (bucket) bucket.push(unit)
    else unitsByInv.set(layer.investigationId, [unit])
  }

  const ordered = [...projectedColumns].sort((a, b) => a.alongM - b.alongM)
  const columns: PartitionColumn[] = []
  const orderedColumns: FenceColumn[] = []
  for (const col of ordered) {
    if (col.surfaceElevM === null) continue
    const units = (unitsByInv.get(col.investigationId) ?? [])
      .slice()
      .sort((a, b) => a.topDepthM - b.topDepthM)
    if (units.length === 0) continue
    columns.push({ investigationId: col.investigationId, surfaceElevM: col.surfaceElevM, units })
    orderedColumns.push({ investigationId: col.investigationId, alongM: col.alongM })
  }
  return { columns, orderedColumns }
}

/** A section paired with its assembled partition columns + ordered columns. */
export interface AssembledSection {
  section: SectionEndpoints
  columns: PartitionColumn[]
  orderedColumns: FenceColumn[]
}

/** The section fields the shared Pass-1 assembly reads (callers may carry more). */
export interface AssemblableSection {
  section: SectionEndpoints
  projectedColumns: readonly FenceProjectedColumn[]
  layers: readonly FenceLayerInput[]
}

/**
 * Shared "Pass 1" of ``buildProjectFence`` / ``buildVoxelRequest``: assemble
 * every section's partition input, keep only sections with a fillable gap
 * (>= 2 columns), and compute the canonical per-test world positions across
 * all of them (the dense cross-section owns each position; sparse ties
 * inherit it — see :func:`computeCanonicalColumnWorldPositions`).
 *
 * Parameters
 * ----------
 * sections : readonly T[]
 *     One entry per section (order irrelevant). ``T`` keeps the caller's
 *     richer input shape (e.g. correlation ``edges``) attached to each
 *     assembled entry's ``input``.
 *
 * Returns
 * -------
 * { assembled, canonical }
 *     ``assembled`` pairs each kept section's input with its partition
 *     ``columns`` + ``orderedColumns``; ``canonical`` maps investigation id
 *     to its canonical world position.
 */
export function assembleSectionsWithCanonical<T extends AssemblableSection>(
  sections: readonly T[],
): {
  assembled: { input: T; columns: PartitionColumn[]; orderedColumns: FenceColumn[] }[]
  canonical: Map<string, { x: number; y: number }>
} {
  const assembled: { input: T; columns: PartitionColumn[]; orderedColumns: FenceColumn[] }[] = []
  for (const input of sections) {
    const { columns, orderedColumns } = assembleSectionPartitionInput(
      input.projectedColumns,
      input.layers,
    )
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
  return { assembled, canonical }
}

/**
 * Compute the CANONICAL world position per test id across all sections.
 *
 * Each column is drawn at the projected position on the DENSEST section that
 * contains the test (the section with the MOST columns "owns" the canonical
 * position). A cross-section (many columns) is the densest section for its own
 * tests, so it renders unchanged; a tie (two columns) is sparse, so its two
 * ends inherit the cross-sections' column positions and the rung meets the
 * walls cleanly (dogfeed 2026-06-10). Pure view geometry — the correlation data
 * fed to the solid / voxel builder is untouched.
 *
 * Shared by ``buildProjectFence`` (3-D fence panels) and ``buildVoxelRequest``
 * (voxel-builder payload) so tie/cross-section columns agree at crossings in
 * both. Sections whose assembled ``columns.length < 2`` are skipped (no gap to
 * fill) and contribute no canonical position.
 *
 * Parameters
 * ----------
 * assembled : readonly AssembledSection[]
 *     Each section already run through ``assembleSectionPartitionInput``.
 *
 * Returns
 * -------
 * Map<string, { x: number; y: number }>
 *     Investigation id → canonical world position (project CRS).
 */
export function computeCanonicalColumnWorldPositions(
  assembled: readonly AssembledSection[],
): Map<string, { x: number; y: number }> {
  // Record, per test id, the world position from the section with the MOST
  // columns (the dense cross-section "owns" the canonical position; sparse ties
  // inherit it).
  const canonical = new Map<string, { x: number; y: number; count: number }>()
  for (const { section, columns, orderedColumns } of assembled) {
    if (columns.length < 2) continue
    const count = orderedColumns.length
    for (const col of orderedColumns) {
      const foot = projectionFoot(section, col.alongM)
      if (!foot) continue
      const prev = canonical.get(col.investigationId)
      if (!prev || count > prev.count) {
        canonical.set(col.investigationId, { x: foot.x, y: foot.y, count })
      }
    }
  }
  // Strip the bookkeeping ``count`` from the public result.
  const result = new Map<string, { x: number; y: number }>()
  for (const [id, w] of canonical) result.set(id, { x: w.x, y: w.y })
  return result
}
