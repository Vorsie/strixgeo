// Geotechnical stage descriptor — contract-level stub (Phase 5).
//
// Unit subdivision (formations → geotechnical units) and parameter values
// are Phase 5 work.  This stub keeps the spine populated at five stages.

import { FlaskConical } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import GeotechnicalCanvas from './GeotechnicalCanvas'

/** No-op placeholder components — replaced in Phase 5. */
function GeotechnicalToolbar(): null { return null }
function GeotechnicalInspector(): null { return null }

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
