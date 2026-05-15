// Geology stage descriptor — functional core (G1).
//
// Wires GeologyToolbar (Fill, Build, Dedupe, Reset, Delete model) and
// GeologyInspector (formation list, drag-reorder, borehole scope, crossings
// banner) into the StageDescriptor.  GeologyCanvas remains the 2D MapView
// placeholder until G2 (when the Cesium 3D viewer lands).

import { Mountain } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import GeologyCanvas from './GeologyCanvas'
import GeologyToolbar from './GeologyToolbar'
import GeologyInspector from './GeologyInspector'

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
