// Stratigraphy stage descriptor — functional core (G1).
//
// Wires GeologyToolbar (Fill, Build, Dedupe, Reset, Delete model) and
// GeologyInspector (formation list, drag-reorder, borehole scope, crossings
// banner) into the StageDescriptor.  GeologyCanvas remains the 2D MapView
// placeholder until G2 (when the Cesium 3D viewer lands).

import { Mountain } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'
import { isGeologicalFormation } from '../../../utils/formationKind'
import GeologyCanvas from './GeologyCanvas'
import GeologyToolbar from './GeologyToolbar'
import GeologyInspector from './GeologyInspector'

/**
 * ``useStageSummary`` for the Stratigraphy stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Reports geological formation count + stale surface count.
 */
function useGeologyStageSummary(): StageSummary {
  const { geoModel } = useShell()
  const t = useT()
  // Filter to geological-kind formations only.  visibleFormations is
  // project-scoped and contains litho + geotech rows alongside geological
  // ones; without the filter the badge counted all 100+ formations instead
  // of the handful of actual geological units (dogfeed 2026-06-30).
  const count = geoModel.visibleFormations.filter(isGeologicalFormation).length
  const stale = geoModel.staleSurfaceCount
  const label = t(count === 1 ? 'geology.summaryFormationOne' : 'geology.summaryFormationMany', {
    n: count,
  })
  const badge =
    stale > 0 ? t('geology.summaryStale', { n: stale }) : count > 0 ? `${count}` : null
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
