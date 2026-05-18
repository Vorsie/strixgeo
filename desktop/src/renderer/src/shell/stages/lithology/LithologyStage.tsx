// Lithology stage descriptor (#55 peer-stage scaffolding — Slice D).
//
// The lithostratigraphic model refines the geological backbone and is
// itself refined into the geotechnical (NAD) model — so it sits
// between them on the spine. This stage is the model-management +
// 3D-view surface; the actual contact editing happens on the Sections
// stage scoped to the active litho model.
//
// LithologyToolbar: shows a Reset Camera button when built litho
// surfaces exist.  The button calls resetLithoCameraCallback.current
// which is populated by Geology3DViewer when mounted as the litho
// canvas — same pattern as GeologyCanvas / GeologyToolbar.

import { Rows3, RefreshCw } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import LithologyCanvas, { resetLithoCameraCallback } from './LithologyCanvas'
import LithologyInspector from './LithologyInspector'
import { ToolbarButton } from '../../ToolbarPrimitives'

/**
 * Toolbar for the Lithology stage.
 *
 * Renders a Reset Camera button when at least one built litho surface
 * exists (i.e. when ``Geology3DViewer`` is mounted as the canvas).
 * The button calls ``resetLithoCameraCallback.current`` which
 * ``Geology3DViewer`` populates via ``resetCameraRef`` when mounted.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The Reset Camera button, or null when no surfaces exist.
 */
function LithologyToolbar(): JSX.Element | null {
  const {
    geoModel: { lithoSurfacesByFormationId },
  } = useShell()

  const hasLithoSurfaces = Array.from(lithoSurfacesByFormationId.values()).some(
    s => s.vertices.length > 0,
  )

  if (!hasLithoSurfaces) return null

  return (
    <ToolbarButton
      icon={<RefreshCw size={13} />}
      label="Reset camera"
      onClick={() => resetLithoCameraCallback.current?.()}
      title="Fly the camera back to the model extent"
    />
  )
}

/**
 * ``useStageSummary`` for the Lithology stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Count of formations in the ACTIVE litho model — mirrors the
 *     Geology stage badge (``visibleFormations.length``) so every spine
 *     badge consistently counts that stage's content, not containers.
 *     An empty/new litho model (nothing drawn yet) → no badge.
 */
function useLithologyStageSummary(): StageSummary {
  const {
    geoModel: { lithoFormations },
  } = useShell()
  const count = lithoFormations.length
  return {
    label: 'Lithology units',
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
