// Geotechnical stage descriptor (F4/F5 — subdivide all bodies + NAD roster).
//
// F4: GeotechnicalCanvas is a 2D/3D surface (SectionsCanvas band view +
//     Geology3DViewer body solids), axis='geotechnical'.
// F5: GeotechnicalInspector renders the NAD packing-unit roster.
// Toolbar: GeotechnicalToolbar carries "Build model" + "Reset camera" (the 3D
//     verbs, co-mounted with the canvas — Task 4). The 2D editing verbs
//     ("Subdivide all bodies" / "Correlate packing") stay in the SectionsToolbar
//     geotech path.

import { FlaskConical } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import GeotechnicalCanvas from './GeotechnicalCanvas'
import GeotechnicalInspector from './GeotechnicalInspector'
import GeotechnicalToolbar from './GeotechnicalToolbar'

/**
 * ``useStageSummary`` for the Geotechnical stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Static placeholder — will report unit count once Phase 5 lands.
 */
function useGeotechnicalStageSummary(): StageSummary {
  return { label: 'Geotechnical units', badge: null, badgeIntent: 'neutral' }
}

const GeotechnicalStage: StageDescriptor = {
  id: 'geotechnical',
  icon: FlaskConical,
  spineLabel: 'Geotech',
  useStageSummary: useGeotechnicalStageSummary,
  CanvasComponent: GeotechnicalCanvas,
  ToolbarComponent: GeotechnicalToolbar,
  InspectorComponent: GeotechnicalInspector,
}

export default GeotechnicalStage
