// Sections stage descriptor.
//
// Maps to the second spine button (cross-section editing surface).
// S3 registers placeholder zone components; the full Sections stage
// (canvas + toolbar + inspector) is built in S5.

import { Layers } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import SectionsToolbar from './SectionsToolbar'
import SectionsInspector from './SectionsInspector'

/**
 * ``useStageSummary`` for the Sections stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Label counts visible sections; amber badge when surfaces are stale.
 */
function useSectionsStageSummary(): StageSummary {
  const { sections, geoModel } = useShell()
  const count = sections.visibleSections.length
  const stale = geoModel.staleSurfaceCount
  const label = `${count} section${count !== 1 ? 's' : ''}`
  const badge = stale > 0 ? `${stale} stale` : count > 0 ? `${count}` : null
  const badgeIntent = stale > 0 ? 'amber' : 'neutral'
  return { label, badge, badgeIntent }
}

const SectionsStage: StageDescriptor = {
  id: 'sections',
  icon: Layers,
  spineLabel: 'Sections',
  useStageSummary: useSectionsStageSummary,
  CanvasComponent: SectionsCanvas,
  ToolbarComponent: SectionsToolbar,
  InspectorComponent: SectionsInspector,
}

export default SectionsStage
