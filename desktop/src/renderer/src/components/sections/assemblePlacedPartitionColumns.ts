// Assemble a model's partition columns AND their screen x-edges for one section.
//
// Extracted 2026-08-13 (the maintenance rule: extract on the second copy). The
// geotech axis now renders the geotech model's partition directly while STILL
// drawing the litho partition's envelopes on top, so ``PartitionFillOverlay``
// assembles two independent column sets per render — the same reshape twice,
// once per model. The unit-stack half is the shared
// ``assembleSectionPartitionInput`` (accepted-only, drop empty / elevation-less
// columns, along-sort, shallow→deep unit sort) that ``buildProjectFence`` and
// ``buildVoxelRequest`` also consume, so on-screen and built geometry assemble
// identical columns; only the screen x-edge derivation is overlay-local.

import type { LithoLayerResponse } from '../../api/client'
import type { PartitionColumn } from '../../utils/sectionPartition'
import {
  assembleSectionPartitionInput,
  type FenceLayerInput,
  type FenceProjectedColumn,
} from '../../utils/sectionFenceData'
import type { ColumnScreen } from './partitionFillOverlayHelpers'
import type { PlacedColumn } from './utils'

/** One model's assembled columns, keyed for the overlay's lookups. */
export interface PlacedPartitionColumns {
  /** Investigation ids left→right; only columns with units AND screen edges. */
  orderedInvs: string[]
  /** Investigation id → engine column (units shallow→deep). */
  colByInv: Map<string, PartitionColumn>
  /** Investigation id → its screen left/right edge + true along-metres. */
  screenByInv: Map<string, ColumnScreen>
}

/**
 * Build each column's gap-free unit stack plus its screen x-edges.
 *
 * Parameters
 * ----------
 * layers : readonly LithoLayerResponse[]
 *     The model's layer rows — litho layers on the litho axis, geotech packing
 *     bands on the geotech axis (same row shape, sibling models). Only
 *     ``status === 'accepted'`` rows fill.
 * placedColumns : readonly PlacedColumn[]
 *     The section's placed investigation columns (carry ``proj.along``, the
 *     collar elevation, and the nudged screen x + width).
 *
 * Returns
 * -------
 * PlacedPartitionColumns
 *     Ordered ids plus the two lookups, sharing one left→right order.
 */
export function assemblePlacedPartitionColumns(
  layers: readonly LithoLayerResponse[],
  placedColumns: readonly PlacedColumn[],
): PlacedPartitionColumns {
  const fenceLayers: FenceLayerInput[] = []
  for (const layer of layers) {
    // Canonical anchor order (``assembleLithoSectionInputs``): CPT first, then
    // borehole. A row carries exactly one, so the order only matters for the
    // two paths agreeing — which is the whole point of sharing the assembly.
    const inv = layer.cpt_id ?? layer.borehole_id
    if (!inv) continue
    fenceLayers.push({
      investigationId: inv,
      layerId: layer.id, // what correlation edges reference (the band signal)
      formationId: layer.formation_id,
      bodyId: layer.body_id ?? null,
      topDepthM: layer.depth_top_m,
      baseDepthM: layer.depth_base_m,
      accepted: layer.status === 'accepted',
    })
  }
  const placedById = new Map<string, PlacedColumn>()
  const projected: FenceProjectedColumn[] = placedColumns.map((col) => {
    placedById.set(col.proj.item.id, col)
    return {
      investigationId: col.proj.item.id,
      alongM: col.proj.along,
      surfaceElevM: col.proj.item.elevation_m ?? null,
    }
  })
  const { columns, orderedColumns } = assembleSectionPartitionInput(projected, fenceLayers)

  const colByInv = new Map<string, PartitionColumn>()
  const screenByInv = new Map<string, ColumnScreen>()
  const orderedInvs: string[] = []
  for (let i = 0; i < columns.length; i += 1) {
    const id = orderedColumns[i].investigationId
    const placed = placedById.get(id)
    if (!placed) continue // unreachable: every assembled column came from placedColumns
    const halfW = placed.width / 2
    colByInv.set(id, columns[i])
    screenByInv.set(id, {
      rightX: placed.nudgedX + halfW,
      leftX: placed.nudgedX - halfW,
      along: orderedColumns[i].alongM,
    })
    orderedInvs.push(id)
  }
  return { orderedInvs, colByInv, screenByInv }
}
