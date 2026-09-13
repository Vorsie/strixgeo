// Export stage descriptor — the workflow spine's terminal stage.
//
// The canvas (ExportCanvas) is THE export hub (installer #35, owner ruling: "the
// Export stage becomes the only export surface ... build the export hub"): every
// export the app can produce is a card here, grouped by model level. Toolbar +
// inspector stay null: exports are chosen on the canvas, and the section toolbar
// / 3-D stages jump here with a single "Export…" verb.

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
 * Reports how many export families are currently runnable so the spine
 * communicates readiness instead of looking inert. A family is runnable when its
 * prerequisites are met: section exports need a section + that axis's model;
 * Plaxis 3D needs the stratigraphic model; the litho / geotech fence need their
 * model.
 *
 * Returns
 * -------
 * StageSummary
 *     Label ``"Exports"``; neutral badge with the runnable-family count
 *     (``null`` when nothing can be exported yet).
 */
function useExportStageSummary(): StageSummary {
  const { sections, geoModel } = useShell()
  const hasSection = sections.sections.length > 0
  // ``!= null`` (not ``!== null``) so an undefined model reads as absent too.
  const hasGeo = geoModel.activeGeologicalModel != null
  const hasLitho = geoModel.activeLithoModel != null
  const hasGeotech = geoModel.activeGeotechModel != null
  const ready =
    (hasGeo ? 1 : 0) + // Plaxis 3D
    (hasLitho ? 1 : 0) + // litho fence
    (hasGeotech ? 1 : 0) + // geotech fence
    (hasSection && hasLitho ? 1 : 0) + // litho section exports
    (hasSection && hasGeotech ? 1 : 0) // geotech section exports
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
