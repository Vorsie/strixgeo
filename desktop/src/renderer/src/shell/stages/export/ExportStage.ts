// Export stage descriptor — contract-level stub (Phase 4 follow-on).
//
// DXF, Plaxis 3D, Plaxis 2D, D-Stability, D-Sheet, GeoStudio, IFC exports
// land here.  This stub keeps the spine populated at five stages.

import { Download } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import ExportCanvas from './ExportCanvas'

/** No-op placeholder components — replaced in Phase 4 follow-on. */
function ExportToolbar(): null { return null }
function ExportInspector(): null { return null }

/**
 * ``useStageSummary`` for the Export stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Static placeholder — will report last export date once the stage lands.
 */
function useExportStageSummary(): StageSummary {
  return { label: 'Exports', badge: null, badgeIntent: 'neutral' }
}

const ExportStage: StageDescriptor = {
  id: 'export',
  icon: Download,
  spineLabel: 'Export',
  useStageSummary: useExportStageSummary,
  CanvasComponent: ExportCanvas,
  ToolbarComponent: ExportToolbar,
  InspectorComponent: ExportInspector,
}

export default ExportStage
