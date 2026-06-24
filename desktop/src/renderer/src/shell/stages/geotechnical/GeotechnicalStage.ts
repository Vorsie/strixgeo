// Geotechnical stage descriptor (F4/F5 — subdivide all bodies + NAD roster).
//
// F4: GeotechnicalCanvas reuses SectionsCanvas with axis='geotechnical'.
// F5: GeotechnicalInspector renders the NAD packing-unit roster (replaces
//     the former null stub).  Toolbar verb ("Subdivide all bodies") is wired
//     in the SectionsToolbar geotech path.

import { FlaskConical } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import GeotechnicalCanvas from './GeotechnicalCanvas'
import GeotechnicalInspector from './GeotechnicalInspector'

/** No-op placeholder — the geotech toolbar verb lives in SectionsToolbar. */
function GeotechnicalToolbar(): null { return null }

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
