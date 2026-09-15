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
 *     Label + badge count visible sections; never a stale mark.
 *
 * The section view is cut LIVE from the current data (partition fill, DEM line
 * and bed clip all recompute every render), so the Sections stage never goes
 * stale — the badge is the plain section count. It used to borrow
 * ``geoModel.staleSurfaceCount`` (the Stratigraphy stage's count), which lit it
 * amber whenever a surface-staling edit fired; a bed edit stales the geological
 * surfaces, so the Sections badge went stale alongside them (owner installer
 * #40: "when i edit the bottom level, i get stale markers on profielen ...").
 * Only the three BUILT models (Stratigraphy / Litho / Geotech) cache their
 * geometry, so only they can be stale.
 */
function useSectionsStageSummary(): StageSummary {
  const { sections } = useShell()
  const count = sections.visibleSections.length
  const label = `${count} section${count !== 1 ? 's' : ''}`
  const badge = count > 0 ? `${count}` : null
  return { label, badge, badgeIntent: 'neutral' }
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
