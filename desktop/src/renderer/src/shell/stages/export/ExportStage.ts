// Export stage descriptor — the workflow spine's terminal stage.
//
// The canvas (ExportCanvas) surfaces every available export target as an
// actionable card (debt #30). Toolbar + inspector stay null: exports are
// chosen on the canvas, there is no per-export inspector or extra verb set.
// DXF + Plaxis 3D ship today; Plaxis 2D / D-Stability / D-Sheet / GeoStudio
// / IFC land as additional cards.

import { Download } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import ExportCanvas from './ExportCanvas'

/** No toolbar/inspector for the Export stage — targets are picked on the
 *  canvas itself (matches the audit's agreed fix for debt #30). */
function ExportToolbar(): null { return null }
function ExportInspector(): null { return null }

/**
 * ``useStageSummary`` for the Export stage.
 *
 * Reports how many export targets are currently runnable so the spine
 * communicates readiness instead of looking inert. A target is runnable
 * when its prerequisites are met (DXF: a section + active model; Plaxis
 * 3D: an active model).
 *
 * Returns
 * -------
 * StageSummary
 *     Label ``"Exports"``; neutral badge with the runnable-target count
 *     (``null`` when nothing can be exported yet).
 */
function useExportStageSummary(): StageSummary {
  const { sections, geoModel } = useShell()
  const hasModel = geoModel.activeGeologicalModel !== null
  const dxfReady = hasModel && sections.sections.length > 0
  const plaxisReady = hasModel
  const ready = (dxfReady ? 1 : 0) + (plaxisReady ? 1 : 0)
  return {
    label: 'Exports',
    badge: ready > 0 ? `${ready}` : null,
    badgeIntent: 'neutral',
  }
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
