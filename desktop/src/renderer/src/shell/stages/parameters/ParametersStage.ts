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

/**
 * No-op placeholders — the stage's toolbar + inspector are scoped to
 * Phase 5 work. The canvas alone is the surface this scaffold opens.
 */
function ParametersToolbar(): null {
  return null
}
function ParametersInspector(): null {
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
