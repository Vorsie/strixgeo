// desktop/src/renderer/src/utils/sectionFenceData.ts
import type { FenceColumn } from './fencePanels'
import type { PartitionColumn, PartitionUnit } from './partitionFill'

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
