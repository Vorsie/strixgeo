// Geotechnical stage descriptor (F4/F5 — subdivide all bodies + NAD roster).
//
// F4: GeotechnicalCanvas is the 3D room for the geotech model (Geology3DViewer
//     body solids, NAD-coloured). The 2D geotech band view lives on the
//     Sections stage's axis picker — owner ruling 2026-08-26 retired the
//     stage-local 2D ⟷ 3D pill so the geotech stages mirror the litho ones
//     (Sections = 2D, Lithology / Geotechnical = 3D).
// F5: GeotechnicalInspector renders the NAD packing-unit roster.
// Toolbar: GeotechnicalToolbar carries "Build model" + "Reset camera" (the 3D
//     verbs, co-mounted with the canvas — Task 4). The 2D editing verbs
//     ("Subdivide all bodies" / "Correlate packing") stay in the SectionsToolbar
//     geotech path.

import { FlaskConical } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'
import GeotechnicalCanvas from './GeotechnicalCanvas'
import GeotechnicalInspector from './GeotechnicalInspector'
import GeotechnicalToolbar from './GeotechnicalToolbar'

/**
 * ``useStageSummary`` for the Geotechnical stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Amber ``!`` badge when the 3-D geotech solids are stale, else a plain
 *     label. Mirrors the Lithology stage: the voxel solids embed the bed and
 *     the litho stack at Build time, so a bed edit or a moved litho contact
 *     stales them and the badge is how a stage reports work without being
 *     opened (owner installer #40 — a bed edit staled Stratigraphy and Litho
 *     but NOT Geotech, because this badge never read the flag).
 */
function useGeotechnicalStageSummary(): StageSummary {
  const {
    geoModel: { hasStaleGeotechSolid },
  } = useShell()
  const t = useT()
  // Staleness outranks everything else here (mirrors the Litho stage). "!" and
  // not "stale": the spine truncates a badge over 4 characters, so the word
  // goes in the label (the button's tooltip + accessible name) instead.
  if (hasStaleGeotechSolid) {
    return { label: t('geotech.unitsStale'), badge: '!', badgeIntent: 'amber' }
  }
  return { label: t('geotech.unitsFull'), badge: null, badgeIntent: 'neutral' }
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
