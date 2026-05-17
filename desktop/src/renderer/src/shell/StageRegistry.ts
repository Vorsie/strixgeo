// Stage registry — maps every StageId to its StageDescriptor.
//
// ``AppShell`` reads from this map to configure the spine buttons and the
// three zone components.  Adding a new stage requires only a new entry here
// plus a corresponding ``StageDescriptor`` implementation.

import type { StageId, StageDescriptor } from './StageDescriptor'
import DataStage from './stages/data/DataStage'
import SectionsStage from './stages/sections/SectionsStage'
import GeologyStage from './stages/geology/GeologyStage'
import LithologyStage from './stages/lithology/LithologyStage'
import GeotechnicalStage from './stages/geotechnical/GeotechnicalStage'
import ExportStage from './stages/export/ExportStage'

/**
 * Ordered list of stage descriptors.
 *
 * Order determines the spine button order (top to bottom) and must reflect
 * the engineering workflow sequence: Data → Sections → Geology →
 * Lithology → Geotechnical → Export.
 */
export const STAGE_ORDER: readonly StageId[] = [
  'data',
  'sections',
  'geology',
  'lithology',
  'geotechnical',
  'export',
] as const

/**
 * Map from StageId to StageDescriptor.
 *
 * ``AppShell`` reads ``STAGE_REGISTRY.get(id)`` to look up the descriptor
 * for the active stage.
 */
export const STAGE_REGISTRY: ReadonlyMap<StageId, StageDescriptor> = new Map([
  ['data', DataStage],
  ['sections', SectionsStage],
  ['geology', GeologyStage],
  ['lithology', LithologyStage],
  ['geotechnical', GeotechnicalStage],
  ['export', ExportStage],
])
