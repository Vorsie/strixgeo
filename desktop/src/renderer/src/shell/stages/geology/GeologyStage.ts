// Geology stage descriptor — contract-level stub.
//
// The full Geology stage (formation list + surface build on a plan view) is
// Phase 4 follow-on work (S7).  This stub makes the spine show all five
// stages and routes to a placeholder canvas so the app is shippable before
// the Sections stage is complete.

import { Mountain } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import GeologyCanvas from './GeologyCanvas'

/** No-op placeholder components — replaced in S7. */
function GeologyToolbar(): null { return null }
function GeologyInspector(): null { return null }

/**
 * ``useStageSummary`` for the Geology stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Reports formation count + stale surface count.
 */
function useGeologyStageSummary(): StageSummary {
  const { geoModel } = useShell()
  const count = geoModel.formations.length
  const stale = geoModel.staleSurfaceCount
  const label = `${count} formation${count !== 1 ? 's' : ''}`
  const badge = stale > 0 ? `${stale} stale` : count > 0 ? `${count}` : null
  const badgeIntent = stale > 0 ? 'amber' : 'neutral'
  return { label, badge, badgeIntent }
}

const GeologyStage: StageDescriptor = {
  id: 'geology',
  icon: Mountain,
  spineLabel: 'Geology',
  useStageSummary: useGeologyStageSummary,
  CanvasComponent: GeologyCanvas,
  ToolbarComponent: GeologyToolbar,
  InspectorComponent: GeologyInspector,
}

export default GeologyStage
