// Lithology stage descriptor (#55 re-scope — peer stage between
// Geology and Geotechnical, like the Geotechnical stub).
//
// The lithostratigraphic model refines the geological backbone and is
// itself refined into the geotechnical (NAD) model — so it sits
// between them on the spine. This stage is the model-management +
// (future) 3D-view surface; the actual contact editing happens on
// the Sections stage scoped to the active litho model (slice 2).

import { Rows3 } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import LithologyCanvas from './LithologyCanvas'
import LithologyInspector from './LithologyInspector'

/** No-op placeholder — litho build actions live on the Sections
 * stage (cross-sections are the editing surface). */
function LithologyToolbar(): null {
  return null
}

/**
 * ``useStageSummary`` for the Lithology stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Count of lithostratigraphic models in the project (badge), or a
 *     neutral label when none exist yet.
 */
function useLithologyStageSummary(): StageSummary {
  const {
    geoModel: { models },
  } = useShell()
  const count = models.filter(m => m.kind === 'lithostratigraphic').length
  return {
    label: 'Lithology models',
    badge: count > 0 ? String(count) : null,
    badgeIntent: 'neutral',
  }
}

const LithologyStage: StageDescriptor = {
  id: 'lithology',
  // Rows3 (flat stacked beds) — deliberately a different glyph family
  // from Sections' Layers (perspective planes) + Geology's Mountain,
  // so the adjacent spine buttons are unambiguous at 20px
  // (ux-review SF-1).
  icon: Rows3,
  spineLabel: 'Litho',
  useStageSummary: useLithologyStageSummary,
  CanvasComponent: LithologyCanvas,
  ToolbarComponent: LithologyToolbar,
  InspectorComponent: LithologyInspector,
}

export default LithologyStage
