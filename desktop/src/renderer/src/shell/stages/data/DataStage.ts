// Data stage descriptor.
//
// Maps to the first spine button (investigation data: CPTs + boreholes).
// The full canvas/toolbar/inspector migration from Sidebar + Toolbar.tsx
// happens in S4; S3 registers empty placeholder slots so the registry is
// complete.

import { Database } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import DataCanvas from './DataCanvas'
import DataToolbar from './DataToolbar'
import DataInspector from './DataInspector'

/**
 * ``useStageSummary`` for the Data stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Label counts visible CPTs + boreholes; badge shows the total when
 *     any exist, ``null`` when the project is empty.
 */
function useDataStageSummary(): StageSummary {
  const { visibleCpts, visibleBoreholes } = useShell()
  const cptCount = visibleCpts.length
  const bhCount = visibleBoreholes.length
  const total = cptCount + bhCount
  const label = `${cptCount} CPT${cptCount !== 1 ? 's' : ''} · ${bhCount} borehole${bhCount !== 1 ? 's' : ''}`
  const badge = total > 0 ? `${total}` : null
  return { label, badge, badgeIntent: 'neutral' }
}

const DataStage: StageDescriptor = {
  id: 'data',
  icon: Database,
  spineLabel: 'Data',
  useStageSummary: useDataStageSummary,
  CanvasComponent: DataCanvas,
  ToolbarComponent: DataToolbar,
  InspectorComponent: DataInspector,
}

export default DataStage
