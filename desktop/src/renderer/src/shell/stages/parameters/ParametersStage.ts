// Parameters stage descriptor (sixth spine slot).
//
// Owner directive 2026-05-21: derive design-ready values per (test ×
// parameter) and per (unit × parameter), with HARD-SEPARATED method
// surfaces (correlation formulas vs xlsx lookups), statistics +
// raincloud plots, probabilistic-distribution wiring, ML/AI hooks, and
// future-proofing for lab-test parameters and per-test comparisons.
//
// Sits between Geotechnical (NAD-class assignment) and Export (writes
// the consumed parameter set to Plaxis / D-Stability / ...). Phase 5
// fills in the per-correlation math; this descriptor opens the surface
// today with three tabs and what we can already populate.
//
// See ``memory/project_parameters_stage_architecture.md`` for the
// architectural reasoning (why a stage, not a tab; why three tabs;
// why hard-separation; how probabilistic + ML hooks slot in).

import { Calculator } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import ParametersCanvas from './ParametersCanvas'
import ParametersInspector from './ParametersInspector'

/**
 * No-op placeholder — the stage's toolbar is scoped to Phase 5 work.
 *
 * The INSPECTOR is no longer a placeholder: owner ruling (dogfeed
 * 2026-08-03) made the right-hand pane the per-CPT plot surface.
 */
function ParametersToolbar(): null {
  return null
}

/**
 * ``useStageSummary`` for the Parameters stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Static label for now; Phase 5 will report
 *     "N parameters resolved / M total" once the per-cell method
 *     selectors are wired.
 */
function useParametersStageSummary(): StageSummary {
  return { label: 'Parameters & analyses', badge: null, badgeIntent: 'neutral' }
}

const ParametersStage: StageDescriptor = {
  id: 'parameters',
  icon: Calculator,
  spineLabel: 'Parameters',
  useStageSummary: useParametersStageSummary,
  CanvasComponent: ParametersCanvas,
  ToolbarComponent: ParametersToolbar,
  InspectorComponent: ParametersInspector,
}

export default ParametersStage
